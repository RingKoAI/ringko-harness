import Busboy from "@fastify/busboy";
import { randomUUID } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { acquireFileLock, createWorkspace, resolveWriteTarget, safeFileOperation } from "@ringko-ai/tools";
import { writeDiagnostic } from "@ringko-ai/config";

export interface UploadLimits {
  requestBytes: number; fileBytes: number; workspaceBytes: number; files: number; storedFiles: number;
  fields: number; fieldBytes: number; headerBytes: number; headerPairs: number; pending: number; timeoutMs: number; nameCharacters: number;
}
export const UPLOAD_LIMITS: Readonly<UploadLimits> = Object.freeze({
  requestBytes: 32 * 1024 * 1024, fileBytes: 20 * 1024 * 1024, workspaceBytes: 512 * 1024 * 1024,
  files: 16, storedFiles: 256, fields: 8, fieldBytes: 1024, headerBytes: 16 * 1024, headerPairs: 64,
  pending: 2, timeoutMs: 30_000, nameCharacters: 120,
});
export class UploadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export const UPLOAD_LOCK_NAME = ".upload.lock";
const MAX_UPLOAD_REFERENCE_CHARACTERS = 4096;
const MAX_UPLOAD_TIMEOUT_MS = 2_147_483_647;
interface UploadFile { name: string; data: Buffer }
export interface SavedUpload { name: string; path: string }

async function multipart(request: Request, limits: Readonly<UploadLimits>, signal: AbortSignal): Promise<UploadFile[]> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType) || !request.body) throw new UploadError("expected multipart/form-data.", 400);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limits.requestBytes)) throw new UploadError("Upload request exceeds its byte limit.", 413);
  const files: { name: string; chunks: Buffer[]; bytes: number }[] = [];
  let failure: Error | undefined, bytes = 0;
  let parser: InstanceType<typeof Busboy>;
  try { parser = new Busboy({ headers: { "content-type": contentType }, limits: {
    fileSize: limits.fileBytes + 1, files: limits.files, fields: limits.fields, parts: limits.files + limits.fields,
    fieldSize: limits.fieldBytes, fieldNameSize: limits.nameCharacters, headerSize: limits.headerBytes, headerPairs: limits.headerPairs,
  } }); } catch { throw new UploadError("Malformed multipart/form-data boundary.", 400); }
  const fail = (error: Error) => { if (!failure) { failure = error; parser.destroy(error); } };
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) parser.on(event, () => fail(new UploadError("Upload exceeds its multipart entry limit.", 413)));
  parser.on("field", (_name, _value, nameTruncated, valueTruncated) => { if (nameTruncated || valueTruncated) fail(new UploadError("Upload field exceeds its byte limit.", 413)); });
  parser.on("file", (field, stream, filename) => {
    stream.once("limit", () => fail(new UploadError("Upload file exceeds its byte limit.", 413)));
    stream.once("error", error => fail(error));
    if (field !== "file") { stream.resume(); return; }
    const file = { name: filename || "upload.bin", chunks: [] as Buffer[], bytes: 0 }; files.push(file);
    stream.on("data", (chunk: Buffer) => {
      file.bytes += chunk.byteLength;
      if (file.bytes > limits.fileBytes) { fail(new UploadError("Upload file exceeds its byte limit.", 413)); return; }
      file.chunks.push(chunk);
    });
  });
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.byteLength;
    callback(bytes > limits.requestBytes ? new UploadError("Upload request exceeds its byte limit.", 413) : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as unknown as Parameters<typeof Readable.fromWeb>[0]), meter, parser, { signal });
    if (failure) throw failure;
    if (!files.length) throw new UploadError("no files.", 400);
    return files.map(file => ({ name: file.name, data: Buffer.concat(file.chunks, file.bytes) }));
  } catch (error) {
    if (signal.aborted) throw new UploadError("Upload was cancelled or exceeded its deadline.", 408);
    if (failure instanceof UploadError) throw failure;
    if (error instanceof UploadError) throw error;
    throw new UploadError("Malformed multipart upload.", 400);
  }
}

/** Serialize local reservations and hold a kernel lock across quota checks/commits. */
export class UploadManager {
  private active = 0;
  private closing = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private readonly drains = new Set<Promise<void>>();
  readonly limits: Readonly<UploadLimits>;
  constructor(limits: Partial<UploadLimits> = {}, private readonly write = safeFileOperation) {
    this.limits = Object.freeze({ ...UPLOAD_LIMITS, ...limits });
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value < 1) || this.limits.fileBytes > 64 * 1024 * 1024 || this.limits.timeoutMs > MAX_UPLOAD_TIMEOUT_MS) throw new TypeError("Invalid upload limits.");
  }
  get busy(): boolean { return this.active > 0; }
  async close(): Promise<void> { this.closing.abort(); await Promise.all([...this.drains]); }

  private async usage(root: string): Promise<{ bytes: number; files: number }> {
    let bytes = 0, files = 0;
    try {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new UploadError("Upload directory changed; retry the upload.", 409);
      const directory = await opendir(root);
      for await (const entry of directory) {
        if (entry.name === UPLOAD_LOCK_NAME) continue;
        if (++files > this.limits.storedFiles) throw new UploadError("Upload storage has too many entries; remove old uploads first.", 507);
        let item;
        try { item = await lstat(join(root, entry.name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { files--; continue; } throw error; }
        if (item.isFile()) bytes += item.size;
        if (!Number.isSafeInteger(bytes) || bytes > this.limits.workspaceBytes) throw new UploadError("Upload storage quota is full; remove old uploads first.", 507);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { bytes, files };
  }

  async receive(request: Request, workspace: string): Promise<SavedUpload[]> {
    if (this.closing.signal.aborted) throw new UploadError("Backend is closing.", 503);
    if (this.active >= this.limits.pending) throw new UploadError("Too many uploads; wait for an active upload to finish.", 429);
    const signal = AbortSignal.any([request.signal, this.closing.signal, AbortSignal.timeout(this.limits.timeoutMs)]);
    this.active++;
    let settled!: () => void;
    const drain = new Promise<void>(resolve => { settled = resolve; }); this.drains.add(drain);
    let release: (() => void) | undefined;
    let releaseStorage: (() => Promise<void>) | undefined;
    let failed = false;
    try {
      const files = await multipart(request, this.limits, signal);
      const previous = this.tail;
      this.tail = new Promise<void>(resolve => { release = resolve; });
      await previous; signal.throwIfAborted();
      const target = await resolveWriteTarget(createWorkspace(workspace), ".ringko/uploads");
      if (!target.insideWorkspace) throw new UploadError("Upload storage must remain inside the workspace.", 403);
      try { releaseStorage = await acquireFileLock(join(target.absolute, UPLOAD_LOCK_NAME), signal); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EBUSY") throw new UploadError("Upload storage is busy in another backend; retry shortly.", 429);
        throw error;
      }
      const usage = await this.usage(target.absolute);
      const total = files.reduce((sum, file) => sum + file.data.byteLength, 0);
      if (files.length > this.limits.storedFiles - usage.files || total > this.limits.workspaceBytes - usage.bytes) throw new UploadError("Upload storage quota is full; remove old uploads first.", 507);
      const committed: { name: string; absolute: string; relative: string; identity: string }[] = [];
      const unknownPartial: string[] = [];
      try {
        for (const file of files) {
          signal.throwIfAborted();
          let safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
          if (safe.length > this.limits.nameCharacters) safe = safe.slice(0, this.limits.nameCharacters / 2) + safe.slice(-Math.floor(this.limits.nameCharacters / 2));
          const stored = `${randomUUID()}-${safe || "upload.bin"}`, absolute = join(target.absolute, stored);
          const relative = `${target.relative ? target.relative.replace(/\\/g, "/") + "/" : ""}${stored}`;
          if (relative.length > MAX_UPLOAD_REFERENCE_CHARACTERS) throw new UploadError("Upload storage path is too long for attachment references.", 400);
          let result;
          try { result = await this.write(absolute, { kind: "write", content: file.data, expectAbsent: true }, signal); }
          catch (error) {
            const partial = error && typeof error === "object" ? error as { committed?: boolean; result?: { identity?: string } } : undefined;
            if (partial?.committed) {
              if (typeof partial.result?.identity === "string" && partial.result.identity.length <= 128) committed.push({ name: file.name, absolute, relative, identity: partial.result.identity });
              else unknownPartial.push(relative);
            }
            throw error;
          }
          committed.push({ name: file.name, absolute, relative, identity: result.identity });
        }
        return committed.map(file => ({ name: file.name, path: file.relative }));
      } catch (error) {
        const cleanup: { path: string; code: string }[] = [];
        for (const file of committed.reverse()) {
          try { await safeFileOperation(file.absolute, { kind: "remove", expectedIdentity: file.identity }); }
          catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") cleanup.push({ path: file.relative, code: (failure as NodeJS.ErrnoException).code ?? "UNKNOWN" }); }
        }
        if (cleanup.length || unknownPartial.length) {
          writeDiagnostic("upload.rollback", JSON.stringify({ message: "Upload rollback failed.", failures: cleanup, unknownPartial }));
          throw new UploadError("Upload failed and some files could not be removed; inspect backend diagnostics.", 500);
        }
        throw error;
      }
    } catch (error) {
      failed = true;
      if (error instanceof UploadError) throw error;
      if (signal.aborted) throw new UploadError("Upload was cancelled or exceeded its deadline.", 408);
      writeDiagnostic("upload.save", String(error));
      throw new UploadError("Could not save uploaded files.", (error as NodeJS.ErrnoException).code === "ENOSPC" ? 507 : 500);
    } finally {
      try { await releaseStorage?.(); }
      catch (error) {
        writeDiagnostic("upload.lock.close", String(error));
        throw new UploadError(failed ? "Upload failed and storage lock cleanup failed; inspect diagnostics." : "Upload committed but storage lock cleanup failed; inspect diagnostics before retrying.", 500);
      } finally { release?.(); this.active--; this.drains.delete(drain); settled(); }
    }
  }
}
