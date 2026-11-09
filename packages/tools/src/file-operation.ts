import type { FileVersion } from "./file-tracker.ts";
import { FILE_LIMITS } from "./limits.ts";

export type FileOperation =
  | { kind: "write"; content: string | Uint8Array; expectAbsent?: boolean }
  | { kind: "edit"; oldString: string; newString: string; replaceAll: boolean }
  | { kind: "remove"; expectedIdentity: string };
export interface FileOperationResult extends FileVersion { bytes: number; created: boolean; replacements: number; identity: string }

export function validateFileOperation(operation: FileOperation): void {
  if (operation.kind === "write") {
    const bytes = typeof operation.content === "string" ? Buffer.byteLength(operation.content, "utf8") : operation.content.byteLength;
    if (bytes > FILE_LIMITS.outputBytes) throw new TypeError("Write content exceeds the 64 MiB output limit.");
  } else if (operation.kind === "edit") {
    if (!operation.oldString || [operation.oldString, operation.newString].some(value => Buffer.byteLength(value, "utf8") > FILE_LIMITS.editArgumentBytes)) {
      throw new TypeError("Edit arguments must fit the 1,000,000-byte limit and old_string must not be empty.");
    }
  } else if (!operation.expectedIdentity || operation.expectedIdentity.length > 256) throw new TypeError("A bounded file identity is required for removal.");
}

/** Native implementations pin directory ancestry and never follow a replacement link. */
export async function safeFileOperation(path: string, operation: FileOperation, signal?: AbortSignal): Promise<FileOperationResult> {
  validateFileOperation(operation);
  signal?.throwIfAborted();
  if (["win32", "linux", "darwin"].includes(process.platform)) return (await import("./file-operation.native.ts")).nativeFileOperation(path, operation, signal);
  throw new Error(`Safe file operations are unsupported on ${process.platform}.`);
}
