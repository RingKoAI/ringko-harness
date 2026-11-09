import { readFile, readdir, stat } from "node:fs/promises";
import { defineTool, type ToolDefinition } from "@ringko-ai/harness";
import { FileTracker } from "./file-tracker.ts";
import { pathRisk } from "./path-access.ts";
import { resolvePathTarget, type Workspace } from "./workspace.ts";
import { FILE_LIMITS } from "./limits.ts";

/** Maximum text characters returned in one read. */
const MAX_BYTES = 1_000_000;
/** Hard cap on a source file, so a huge file cannot exhaust memory. */
const MAX_SOURCE_BYTES = FILE_LIMITS.sourceBytes;
/** Vision providers receive the bytes inline; larger images are rejected. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Raw PDF size; extraction happens in memory, so keep it well below the source cap. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const DEFAULT_LIMIT = 2000;
const MAX_NOTEBOOK_OUTPUT_CHARACTERS = 10_000;

export interface ReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadImage {
  mediaType: string;
  /** Base64-encoded file bytes. */
  data: string;
  bytes: number;
}

export interface ReadPdf {
  pages: number;
  bytes: number;
}

export interface ReadOutput {
  path: string;
  content?: string;
  entries?: string[];
  /** Present when the target is a supported raster image. */
  image?: ReadImage;
  /** Present when the target is a PDF whose text was extracted. */
  pdf?: ReadPdf;
  truncated?: boolean;
  /** Set when the file changed on disk since it was last read. */
  notice?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object input.");
  }
  return value as Record<string, unknown>;
}

function parseRead(value: unknown): ReadInput {
  const record = asRecord(value);
  if (typeof record.path !== "string" || record.path.trim().length === 0) {
    throw new TypeError("Expected a non-empty string 'path'.");
  }
  const input: ReadInput = { path: record.path };
  if (record.offset !== undefined) {
    if (typeof record.offset !== "number" || !Number.isSafeInteger(record.offset) || record.offset < 0) {
      throw new TypeError("'offset' must be a non-negative integer.");
    }
    input.offset = record.offset;
  }
  if (record.limit !== undefined) {
    if (typeof record.limit !== "number" || !Number.isSafeInteger(record.limit) || record.limit < 1) {
      throw new TypeError("'limit' must be a positive integer.");
    }
    input.limit = record.limit;
  }
  return input;
}

function addLineNumbers(lines: readonly string[], start: number): string {
  return lines.map((line, index) => `${String(start + index + 1).padStart(6, " ")}→${line}`).join("\n");
}

/** Identify a supported raster image from its magic bytes, never its name. */
function imageMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

/** A NUL byte in the leading window is a reliable binary signal for text tools. */
function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join("");
  }
  return "";
}

function clampText(text: string, limit = MAX_NOTEBOOK_OUTPUT_CHARACTERS): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… [output truncated]` : text;
}

/** Render a Jupyter notebook as readable text, including text outputs. */
function formatNotebook(raw: string, shown: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError(`Notebook ${shown} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !Array.isArray((parsed as { cells?: unknown }).cells)) {
    throw new TypeError(`Notebook ${shown} does not contain a cells array.`);
  }
  const cells = (parsed as { cells: unknown[] }).cells;
  const lines: string[] = [];
  cells.forEach((cell, index) => {
    if (typeof cell !== "object" || cell === null || Array.isArray(cell)) return;
    const record = cell as Record<string, unknown>;
    const kind = typeof record.cell_type === "string" ? record.cell_type : "unknown";
    lines.push(`# cell ${index + 1} (${kind})`);
    lines.push(textOf(record.source));
    if (Array.isArray(record.outputs)) {
      for (const output of record.outputs) {
        if (typeof output !== "object" || output === null || Array.isArray(output)) continue;
        const entry = output as Record<string, unknown>;
        const text = textOf(entry.text);
        if (text.length > 0) {
          lines.push("[output]");
          lines.push(clampText(text));
          continue;
        }
        const data = entry.data;
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          const plain = textOf((data as Record<string, unknown>)["text/plain"]);
          if (plain.length > 0) {
            lines.push("[output]");
            lines.push(clampText(plain));
          }
        }
      }
    }
    lines.push("");
  });
  const text = lines.join("\n");
  return text.length > MAX_BYTES ? `${text.slice(0, MAX_BYTES)}\n… [notebook truncated]` : text;
}

/**
 * Extract per-page text from a PDF. `unpdf` is imported dynamically so the
 * PDF engine is only loaded when a PDF is actually read, keeping CLI startup
 * light. Scanned PDFs have no text layer; OCR is deliberately not attempted.
 */
async function extractPdf(buffer: Buffer, shown: string): Promise<{ content: string; pages: number; truncated: boolean }> {
  const extracted = await (async () => {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      // Errors only: a recoverable but noisy PDF should not spam the CLI.
      const document = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
      return await extractText(document, { mergePages: false });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "invalid PDF";
      throw new TypeError(`Could not read PDF ${shown}: ${message}`);
    }
  })();
  const pageTexts = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const lines: string[] = [];
  let size = 0;
  let truncated = false;
  for (let index = 0; index < pageTexts.length; index += 1) {
    const page = pageTexts[index]?.replace(/\r\n/g, "\n").trimEnd() ?? "";
    if (page.trim().length === 0) continue;
    const chunk = `--- page ${String(index + 1)} ---\n${page}\n`;
    if (size + chunk.length > MAX_BYTES) {
      const room = MAX_BYTES - size;
      if (room > 0) lines.push(chunk.slice(0, room));
      truncated = true;
      break;
    }
    lines.push(chunk);
    size += chunk.length;
  }
  const content = lines.join("\n");
  if (content.trim().length === 0) {
    throw new TypeError(`PDF ${shown} has no extractable text (it may be scanned); OCR is not supported.`);
  }
  return { content, pages: pageTexts.length, truncated };
}

/** Read a text file, a supported image, a PDF, a Jupyter notebook, or a directory. */
export function createReadTool(workspace: Workspace, tracker: FileTracker = new FileTracker()): ToolDefinition<ReadInput, ReadOutput> {
  return defineTool<ReadInput, ReadOutput>({
    name: "read",
    taskAccess: "read",
    description:
      "Read a UTF-8 text file with line numbers, or list a directory. PNG, JPEG, GIF and WebP images are returned as image content for vision models; PDFs are text-extracted per page (scanned PDFs without a text layer are refused); .ipynb notebooks are rendered as text with their text outputs. Binary files are refused. Targets outside the workspace require approval.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parseInput: parseRead,
    async assessRisk({ path }) {
      return pathRisk(await resolvePathTarget(workspace, path), "Read");
    },
    async execute({ path, offset, limit }, context) {
      const target = await resolvePathTarget(workspace, path);
      if (!target.resolved) throw new TypeError(`Cannot resolve ${target.absolute} safely; retry the call.`);
      if (context?.approvedTarget && context.approvedTarget !== target.absolute) throw new Error("Read target changed after approval; retry the call.");
      const shown = target.insideWorkspace ? (target.relative || ".") : target.absolute;
      const info = await stat(target.absolute);
      context?.signal?.throwIfAborted();

      if (info.isDirectory()) {
        const all = (await readdir(target.absolute)).sort();
        context?.signal?.throwIfAborted();
        if ((await resolvePathTarget(workspace, path)).absolute !== target.absolute) throw new Error("Read target changed while listing; retry the call.");
        return {
          path: shown,
          entries: all.slice(0, MAX_ENTRIES),
          ...(all.length > MAX_ENTRIES ? { truncated: true } : {}),
        };
      }

      const changed = tracker.changedSinceLastRead(target.absolute, info);
      if (info.size > MAX_SOURCE_BYTES) {
        throw new TypeError(`File ${shown} is too large to read (${String(info.size)} bytes; limit ${String(MAX_SOURCE_BYTES)}).`);
      }
      const buffer = await readFile(target.absolute, { signal: context?.signal });
      context?.signal?.throwIfAborted();
      if ((await resolvePathTarget(workspace, path)).absolute !== target.absolute) throw new Error("Read target changed while reading; retry the call.");
      tracker.record(target.absolute, info);

      const mediaType = imageMediaType(buffer);
      if (mediaType) {
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
          throw new TypeError(`Image ${shown} is too large to send to a model (${String(buffer.byteLength)} bytes; limit ${String(MAX_IMAGE_BYTES)}).`);
        }
        return {
          path: shown,
          image: { mediaType, data: buffer.toString("base64"), bytes: buffer.byteLength },
          ...(changed ? { notice: `${shown} changed since it was last read.` } : {}),
        };
      }

      if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
        if (buffer.byteLength > MAX_PDF_BYTES) {
          throw new TypeError(`PDF ${shown} is too large to read (${String(buffer.byteLength)} bytes; limit ${String(MAX_PDF_BYTES)}).`);
        }
        const pdf = await extractPdf(buffer, shown);
        context?.signal?.throwIfAborted();
        return {
          path: shown,
          content: pdf.content,
          pdf: { pages: pdf.pages, bytes: buffer.byteLength },
          ...(pdf.truncated ? { truncated: true } : {}),
          ...(changed ? { notice: `${shown} changed since it was last read.` } : {}),
        };
      }

      if (looksBinary(buffer)) {
        throw new TypeError(`File ${shown} appears to be binary; only UTF-8 text, PNG/JPEG/GIF/WebP images, PDFs with a text layer and .ipynb notebooks are supported.`);
      }

      const raw = buffer.toString("utf8");
      if (shown.toLowerCase().endsWith(".ipynb")) {
        return {
          path: shown,
          content: formatNotebook(raw, shown),
          ...(changed ? { notice: `${shown} changed since it was last read; re-read before editing.` } : {}),
        };
      }

      const start = offset ?? 0;
      const count = limit ?? DEFAULT_LIMIT;
      // Locate the requested page before applying the output budget. A bounded
      // source scan avoids allocating an array for every line of a large file.
      let position = 0, skipped = 0;
      while (skipped < start && position <= raw.length) {
        const newline = raw.indexOf("\n", position);
        position = newline < 0 ? raw.length + 1 : newline + 1;
        skipped++;
      }
      const slice: string[] = [];
      let characters = 0, truncated = false;
      while (position <= raw.length && slice.length < count) {
        const newline = raw.indexOf("\n", position);
        const end = newline < 0 ? raw.length : newline;
        const prefixCharacters = String(start + slice.length + 1).padStart(6, " ").length + "→".length;
        const room = MAX_BYTES - characters - prefixCharacters;
        const length = end - position;
        if (room <= 0) { truncated = true; break; }
        slice.push(raw.slice(position, Math.min(end, position + room)));
        characters += Math.min(length, room) + prefixCharacters + 1;
        if (length > room) { truncated = true; break; }
        position = newline < 0 ? raw.length + 1 : newline + 1;
      }
      truncated ||= position <= raw.length;
      return {
        path: shown,
        content: addLineNumbers(slice, start),
        ...(truncated ? { truncated } : {}),
        ...(changed ? { notice: `${shown} changed since it was last read; re-read before editing.` } : {}),
      };
    },
    toMessage(output) {
      if (output.image) {
        const summary = `Image ${output.path} (${output.image.mediaType}, ${String(output.image.bytes)} bytes).`;
        return {
          content: summary,
          parts: [
            { type: "text", text: summary },
            { type: "image", mediaType: output.image.mediaType, data: output.image.data },
          ],
        };
      }
      const notice = output.notice ? `\n\n${output.notice}` : "";
      if (output.pdf) {
        return { content: `PDF: ${output.path} (${String(output.pdf.pages)} pages${output.truncated ? ", truncated" : ""})\n${output.content ?? ""}${notice}` };
      }
      if (output.entries) {
        return { content: `Directory: ${output.path}${output.truncated ? " (truncated)" : ""}\n${output.entries.join("\n")}${notice}` };
      }
      if (output.content !== undefined) {
        const kind = output.path.toLowerCase().endsWith(".ipynb") ? "Notebook" : "File";
        return { content: `${kind}: ${output.path}${output.truncated ? " (truncated)" : ""}\n${output.content}${notice}` };
      }
      return { content: JSON.stringify(output) };
    },
  });
}
