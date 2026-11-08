import type { RingkoConfig } from "@ringko-ai/config";

export const UPDATE_DEFAULTS = Object.freeze({ checkOnStartup: true, autoUpdate: false });
export const UPDATE_LIMITS = Object.freeze({
  checkMs: 5_000, installMs: 180_000, metadataBytes: 64 * 1024,
  archiveBytes: 256 * 1024 * 1024, extractedBytes: 512 * 1024 * 1024, files: 20_000,
});
export const UPDATE_REGISTRY = "https://registry.npmjs.org";
export const UPDATE_RELEASES = "https://github.com/RingKoAI/ringko-harness/releases";

export function updatePolicy(config: RingkoConfig, warn: (message: string) => void): { checkOnStartup: boolean; autoUpdate: boolean } {
  const raw: unknown = config.updates;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    warn("Invalid updates configuration; using checkOnStartup=true, autoUpdate=false.");
    return { ...UPDATE_DEFAULTS };
  }
  const data = (raw ?? {}) as Record<string, unknown>;
  const read = (key: keyof typeof UPDATE_DEFAULTS): boolean => {
    if (data[key] === undefined) return UPDATE_DEFAULTS[key];
    if (typeof data[key] === "boolean") return data[key];
    warn(`Invalid updates.${key}; using ${UPDATE_DEFAULTS[key]}.`);
    return UPDATE_DEFAULTS[key];
  };
  return { checkOnStartup: read("checkOnStartup"), autoUpdate: read("autoUpdate") };
}

/** Strict SemVer input; never interpolate registry text into a command unchecked. */
export function releaseVersion(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.test(value)) {
    throw new TypeError("Update source returned an invalid version.");
  }
  return value;
}
