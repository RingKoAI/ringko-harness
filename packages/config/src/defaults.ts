import type { ProviderFile, RingkoConfig } from "./config.ts";
import { INSTRUCTION_SCAN_DEFAULTS } from "./instruction-policy.ts";
import { UPDATE_DEFAULTS } from "./updates.ts";

/** Persistent, non-sensitive defaults; workspace selection remains launch/project-owned. */
export const DEFAULT_SETTINGS = {
  updates: { ...UPDATE_DEFAULTS },
  capabilities: { network: false, privateNetwork: false, websearchProvider: "exa", shell: false },
  sandbox: { mode: "workspace-write", additionalWritableRoots: [], mcp: {} },
  permission: "approval",
  permissionPreset: "default",
  workflow: "agent",
  thinking: "high",
  expandThinking: false,
  expandTools: false,
  maxTurns: 50,
  compaction: { enabled: true, ratio: 0.8, keepRecent: 6, margin: 2000 },
  plugins: { trusted: [] },
  subagents: { default: "in-process", maxActive: 2, maxPerRun: 8, providers: [] },
  instructionScan: { ...INSTRUCTION_SCAN_DEFAULTS, excludeDirectories: [...INSTRUCTION_SCAN_DEFAULTS.excludeDirectories] },
} satisfies RingkoConfig;

export const DEFAULT_PROVIDER_FILE = { model: "", small_model: "", providers: [] } satisfies ProviderFile;

export function defaultSettings(): RingkoConfig { return structuredClone(DEFAULT_SETTINGS); }
export function defaultProviderFile(): ProviderFile { return structuredClone(DEFAULT_PROVIDER_FILE); }
