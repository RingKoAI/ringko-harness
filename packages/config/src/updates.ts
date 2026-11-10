import type { RingkoConfig } from "./config.ts";

export const UPDATE_DEFAULTS = Object.freeze({ checkOnStartup: true, autoUpdate: false });
export interface UpdatePreferences { checkOnStartup: boolean; autoUpdate: boolean }

/** Shared by the CLI and settings UI so displayed defaults match startup behavior. */
export function updatePolicy(config: RingkoConfig, warn: (message: string) => void): UpdatePreferences {
  const raw: unknown = config.updates;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    warn("Invalid updates configuration; using checkOnStartup=true, autoUpdate=false.");
    return { ...UPDATE_DEFAULTS };
  }
  const data = (raw ?? {}) as Record<string, unknown>;
  const read = (key: keyof UpdatePreferences): boolean => {
    if (data[key] === undefined) return UPDATE_DEFAULTS[key];
    if (typeof data[key] === "boolean") return data[key];
    warn(`Invalid updates.${key}; using ${UPDATE_DEFAULTS[key]}.`);
    return UPDATE_DEFAULTS[key];
  };
  return { checkOnStartup: read("checkOnStartup"), autoUpdate: read("autoUpdate") };
}
