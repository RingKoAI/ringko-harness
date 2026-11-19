import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { IDE_LIMITS } from "./limits.ts";

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface SelectionContext {
  startLine: number;
  endLine: number;
  text?: string;
  languageId?: string;
}

export interface DiagnosticItem {
  line: number;
  column?: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
  code?: string | number;
}

export interface ParsedFileReference {
  relativePath: string;
  line?: number;
  endLine?: number;
  column?: number;
}

export interface ResolvedWorkspaceFile {
  absolutePath: string;
  relativePath: string;
  line?: number;
  endLine?: number;
  column?: number;
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizePositiveLine(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) return undefined;
  return value;
}

function isContainedWithin(baseRealPath: string, candidateRealPath: string): boolean {
  const left = process.platform === "win32" ? baseRealPath.toLowerCase() : baseRealPath;
  const right = process.platform === "win32" ? candidateRealPath.toLowerCase() : candidateRealPath;
  if (left === right) return true;
  const prefix = left.endsWith(sep) ? left : `${left}${sep}`;
  return right.startsWith(prefix);
}

/**
 * Convert an absolute file path into a workspace-relative POSIX path, or return
 * null if the target lies outside the workspace root.
 */
export function normalizeRelativePath(workspaceRoot: string, targetPath: string): string | null {
  if (!workspaceRoot || !targetPath || targetPath.includes("\0")) return null;
  const rootResolved = resolve(workspaceRoot);
  const targetResolved = resolve(rootResolved, targetPath);
  const rel = relative(rootResolved, targetResolved);
  if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) return null;
  return toPosixPath(rel);
}

/** Format a workspace-relative path and optional 1-based line range as an `@file` mention. */
export function formatFileMention(relativePath: string, range?: LineRange): string {
  const clean = toPosixPath(relativePath.trim()).replace(/^\/+/, "");
  if (!clean) return "";
  const start = normalizePositiveLine(range?.startLine);
  const end = normalizePositiveLine(range?.endLine);
  let suffix = "";
  if (start !== undefined) {
    suffix = end !== undefined && end > start ? `#L${start}-L${end}` : `#L${start}`;
  }
  const token = `${clean}${suffix}`;
  return /\s/.test(clean) ? `@"${token.replaceAll("\"", "\\\"")}"` : `@${token}`;
}

/** Build either an `@file` mention or a bounded code-explanation prompt. */
export function formatSelectionPrompt(
  action: "mention" | "explain",
  relativePath: string,
  selection?: SelectionContext,
  locale: "en" | "zh-CN" = "en",
): string {
  const mention = formatFileMention(
    relativePath,
    selection ? { startLine: selection.startLine, endLine: selection.endLine } : undefined,
  );
  if (action === "mention") return mention;
  const snippet = selection?.text?.trim() ?? "";
  const boundedSnippet = snippet.length > IDE_LIMITS.maxSelectionChars
    ? `${snippet.slice(0, IDE_LIMITS.maxSelectionChars)}\n/* ... truncated ... */`
    : snippet;
  const lang = (selection?.languageId ?? "").replace(/[^a-zA-Z0-9_+-]/g, "");
  const header = locale === "zh-CN"
    ? `请解释 ${mention} 中的这段代码，说明它的职责、关键边界条件以及潜在风险：`
    : `Explain the selected code in ${mention}, covering its purpose, key edge cases, and any potential issues:`;
  if (!boundedSnippet) return header;
  return `${header}\n\n\`\`\`${lang}\n${boundedSnippet}\n\`\`\``;
}

/** Format active file diagnostics into a bounded, actionable repair prompt. */
export function formatDiagnosticsPrompt(
  relativePath: string,
  diagnostics: ReadonlyArray<DiagnosticItem>,
  locale: "en" | "zh-CN" = "en",
): string {
  const mention = formatFileMention(relativePath);
  if (diagnostics.length === 0) {
    return locale === "zh-CN"
      ? `请检查 ${mention} 是否存在类型错误、潜在缺陷或边界问题，并在需要时修复。`
      : `Inspect ${mention} for type errors, bugs, or edge-case issues and fix any problems you find.`;
  }
  const subset = diagnostics.slice(0, IDE_LIMITS.maxDiagnosticsItems);
  const lines = subset.map((item, index) => {
    const line = Math.max(1, Math.trunc(item.line));
    const col = item.column && item.column > 0 ? `:${Math.trunc(item.column)}` : "";
    const tag = item.source
      ? `[${item.severity.toUpperCase()} ${item.source}${item.code !== undefined ? `(${item.code})` : ""}]`
      : `[${item.severity.toUpperCase()}${item.code !== undefined ? ` ${item.code}` : ""}]`;
    const msg = item.message.replace(/\s+/g, " ").trim().slice(0, IDE_LIMITS.maxDiagnosticMessageChars);
    return `${index + 1}. L${line}${col} ${tag} ${msg}`;
  });
  const overflow = diagnostics.length > subset.length
    ? (locale === "zh-CN"
      ? `\n（其余 ${diagnostics.length - subset.length} 条诊断已省略）`
      : `\n(${diagnostics.length - subset.length} additional diagnostics omitted)`)
    : "";
  const intro = locale === "zh-CN"
    ? `请修复 ${mention} 中的以下 IDE 诊断问题，保持现有功能与代码规范：`
    : `Fix the following IDE diagnostics in ${mention} while preserving existing behavior and project conventions:`;
  return `${intro}\n\n${lines.join("\n")}${overflow}`;
}

/**
 * Parse a relative file reference (`@src/a.ts#L10-L20`, `src/a.ts:10:4`, etc.)
 * while rejecting absolute paths, drive letters, URL schemes, NUL bytes, and `..` segments.
 */
export function parseFileReference(raw: string): ParsedFileReference | null {
  if (typeof raw !== "string") return null;
  let trimmed = raw.trim();
  if (!trimmed || trimmed.length > IDE_LIMITS.maxReferenceChars || trimmed.includes("\0")) return null;
  if (trimmed.startsWith("@")) trimmed = trimmed.slice(1).trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  try {
    trimmed = decodeURIComponent(trimmed);
  } catch {
    return null;
  }
  if (!trimmed || trimmed.includes("\0")) return null;
  // Reject URL schemes (`http://`, `file://`, `vscode://`) and Windows drive / UNC roots.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return null;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) return null;

  let pathPart = trimmed;
  let line: number | undefined;
  let endLine: number | undefined;
  let column: number | undefined;

  const hashMatch = pathPart.match(/^(.*?)#L(\d+)(?:-L?(\d+))?$/i);
  if (hashMatch) {
    pathPart = hashMatch[1] ?? "";
    line = normalizePositiveLine(Number(hashMatch[2]));
    endLine = hashMatch[3] ? normalizePositiveLine(Number(hashMatch[3])) : undefined;
  } else {
    const colonMatch = pathPart.match(/^(.*?):(\d+)(?::(\d+))?$/);
    if (colonMatch) {
      pathPart = colonMatch[1] ?? "";
      line = normalizePositiveLine(Number(colonMatch[2]));
      column = colonMatch[3] ? normalizePositiveLine(Number(colonMatch[3])) : undefined;
    }
  }

  const normalized = toPosixPath(pathPart.trim()).replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
  const segments = normalized.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;

  return {
    relativePath: segments.join("/"),
    ...(line !== undefined ? { line } : {}),
    ...(endLine !== undefined && line !== undefined && endLine >= line ? { endLine } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

/**
 * Resolve a relative file reference strictly inside `workspaceRoot`, verifying
 * canonical symlink containment before opening in the editor.
 */
export function resolveWorkspaceFile(workspaceRoot: string, rawReference: string): ResolvedWorkspaceFile | null {
  const parsed = parseFileReference(rawReference);
  if (!parsed || !workspaceRoot) return null;
  let canonicalBase: string;
  try {
    canonicalBase = realpathSync(resolve(workspaceRoot));
  } catch {
    return null;
  }
  const candidate = resolve(canonicalBase, parsed.relativePath);
  if (!existsSync(candidate)) return null;
  let canonicalCandidate: string;
  try {
    canonicalCandidate = realpathSync(candidate);
    if (!statSync(canonicalCandidate).isFile()) return null;
  } catch {
    return null;
  }
  if (!isContainedWithin(canonicalBase, canonicalCandidate)) return null;
  // Also verify parent directory containment for defense in depth.
  if (!isContainedWithin(canonicalBase, dirname(canonicalCandidate)) && dirname(canonicalCandidate) !== canonicalBase) {
    return null;
  }
  return {
    absolutePath: canonicalCandidate,
    relativePath: parsed.relativePath,
    ...(parsed.line !== undefined ? { line: parsed.line } : {}),
    ...(parsed.endLine !== undefined ? { endLine: parsed.endLine } : {}),
    ...(parsed.column !== undefined ? { column: parsed.column } : {}),
  };
}
