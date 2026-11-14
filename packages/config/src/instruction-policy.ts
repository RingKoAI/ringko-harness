import { isAbsolute } from "node:path";
import { isRecord } from "./util.ts";

export interface InstructionScanConfig {
  recursive?: boolean;
  excludeDirectories?: readonly string[];
  excludeNestedRepositories?: boolean;
  maxDepth?: number;
  maxDirectories?: number;
}
export interface InstructionScanPolicy {
  recursive: boolean;
  excludeDirectories: readonly string[];
  excludeNestedRepositories: boolean;
  maxDepth: number;
  maxDirectories: number;
}

export const INSTRUCTION_SCAN_DEFAULTS: Readonly<InstructionScanPolicy> = Object.freeze({
  recursive: true,
  excludeDirectories: Object.freeze([".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage", ".next", "target", "vendor", "venv", "__pycache__", "bower_components"]),
  excludeNestedRepositories: true,
  maxDepth: 12,
  maxDirectories: 4096,
});
export const INSTRUCTION_SCAN_CONFIG_LIMITS = Object.freeze({ depth: 64, directories: 65_536, excludes: 256, excludeCharacters: 512 });

/** Directory names match at any depth; slash-separated paths are workspace-relative. */
export function normalizeInstructionExclude(value: string): string | undefined {
  const path = value.trim().replace(/\\/g, "/");
  if (!path || path.length > INSTRUCTION_SCAN_CONFIG_LIMITS.excludeCharacters || /[\u0000-\u001f\u007f-\u009f*?]/.test(path) || isAbsolute(path) || /^[a-z]:/i.test(path)) return undefined;
  const components = path.replace(/\/+$/, "").split("/");
  if (components.some(component => !component || component === "." || component === "..")) return undefined;
  return components.join("/");
}

/** Optional, non-sensitive scan settings fall back per field and report invalid values. */
export function instructionScanPolicy(value: unknown, warn: (message: string) => void): InstructionScanPolicy {
  const result: InstructionScanPolicy = { ...INSTRUCTION_SCAN_DEFAULTS, excludeDirectories: [...INSTRUCTION_SCAN_DEFAULTS.excludeDirectories] };
  if (value === undefined) return result;
  if (!isRecord(value)) { warn("Invalid instructionScan configuration; using built-in scan defaults."); return result; }
  for (const key of ["recursive", "excludeNestedRepositories"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] === "boolean") result[key] = value[key]; else warn(`Invalid instructionScan.${key}; using ${result[key]}.`);
  }
  for (const [key, minimum, maximum] of [["maxDepth", 0, INSTRUCTION_SCAN_CONFIG_LIMITS.depth], ["maxDirectories", 1, INSTRUCTION_SCAN_CONFIG_LIMITS.directories]] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= minimum && value[key] <= maximum) result[key] = value[key];
    else warn(`Invalid instructionScan.${key}; using ${result[key]}.`);
  }
  if (value.excludeDirectories !== undefined) {
    if (Array.isArray(value.excludeDirectories) && value.excludeDirectories.length <= INSTRUCTION_SCAN_CONFIG_LIMITS.excludes && value.excludeDirectories.every(entry => typeof entry === "string" && normalizeInstructionExclude(entry) !== undefined)) {
      result.excludeDirectories = [...new Set((value.excludeDirectories as string[]).map(entry => normalizeInstructionExclude(entry)!))];
    } else warn("Invalid instructionScan.excludeDirectories; using built-in exclusions. Use directory names or relative directory paths.");
  }
  return result;
}
