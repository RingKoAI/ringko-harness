import type { RingkoConfig } from "./config.ts";

export type PermissionPreset = "read-only" | "default" | "full-access";
export const PERMISSION_PRESETS = Object.freeze({
  "read-only": Object.freeze({ label: "Read only", permission: "approval", sandbox: "read-only", description: "Read workspace files. Writes and network access require approval; approved exceptions apply only to that invocation." }),
  default: Object.freeze({ label: "Default", permission: "approval", sandbox: "workspace-write", description: "Read and edit workspace files. Network, shell and external-file actions require approval." }),
  "full-access": Object.freeze({ label: "Full access", permission: "full", sandbox: "danger-full-access", description: "Disable sandbox confinement and ordinary approval prompts. Explicit deny/ask rules and disabled capabilities remain enforced." }),
} as const);

export function isPermissionPreset(value: unknown): value is PermissionPreset {
  return typeof value === "string" && Object.hasOwn(PERMISSION_PRESETS, value);
}

/** Explicit user selection changes the two knobs in one persisted config value. */
export function applyPermissionPreset(config: RingkoConfig, preset: PermissionPreset): RingkoConfig {
  if (!isPermissionPreset(preset)) throw new TypeError("Invalid permission preset.");
  const selected = PERMISSION_PRESETS[preset];
  return { ...config, permissionPreset: preset, permission: selected.permission, mode: selected.permission,
    sandbox: { ...config.sandbox, mode: selected.sandbox } };
}

/** Derive from actual knobs, so a legacy/custom config never masquerades as full access. */
export function permissionPresetFor(config: RingkoConfig): PermissionPreset | "custom" {
  const permission = config.permission ?? config.mode ?? "approval";
  const sandbox = config.sandbox?.mode ?? "workspace-write";
  for (const [key, value] of Object.entries(PERMISSION_PRESETS)) if (value.permission === permission && value.sandbox === sandbox) return key as PermissionPreset;
  return "custom";
}
