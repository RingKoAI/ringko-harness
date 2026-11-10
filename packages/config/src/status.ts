import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getApiKey } from "./auth.ts";
import { modelLabel, selectModel, type RingkoConfig } from "./config.ts";
import { providerPath, settingsPath } from "./paths.ts";
import { updatePolicy } from "./updates.ts";

export interface StatusEntry { label: string; value: string }
const MAX_STATUS_FIELD_CHARACTERS = 4096;

/** Show endpoint identity without URL credentials, query tokens or fragments. */
export function statusEndpoint(value: string | undefined): string {
  if (!value) return "Provider default";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "Configured (URL hidden)";
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString().slice(0, MAX_STATUS_FIELD_CHARACTERS);
  } catch { return "Configured (invalid URL hidden)"; }
}

/** A deliberately allowlisted summary: never serialize raw config or credentials. */
export function configurationStatus(config: RingkoConfig, options: { path?: string; embedded?: boolean; warn: (message: string) => void }): StatusEntry[] {
  const selection = selectModel(config);
  const provider = selection?.provider;
  const policy = updatePolicy(config, options.warn);
  const sources = options.embedded ? "Host-provided configuration" : options.path ? resolve(options.path) : [settingsPath(), providerPath()].filter(path => existsSync(path)).join(", ") || "Defaults (no settings files)";
  const storedKey = provider && !provider.apiKey ? getApiKey(provider.name) : undefined;
  const keySource = provider?.apiKey ? "Provider settings" : typeof storedKey === "string" && storedKey.length > 0 ? "Auth store" : "Provider-managed (environment / OAuth / no key)";
  const requestedPermission = config.permission ?? config.mode ?? "approval";
  const permission = ["approval", "assist", "full"].includes(requestedPermission) ? requestedPermission : "approval";
  return [
    { label: "Model", value: selection ? `${modelLabel(selection)} (${selection.model.id})` : "Offline echo (default)" },
    { label: "Provider", value: provider ? `${provider.name} (${provider.type ?? provider.vendor ?? "echo"})` : "echo" },
    { label: "Configured URL", value: statusEndpoint(provider?.baseURL ?? selection?.model.url ?? provider?.url) },
    { label: "Auth configuration", value: keySource },
    { label: "Setting sources", value: sources },
    { label: "Access mode", value: permission },
    { label: "Sandbox", value: config.sandbox?.mode ?? "workspace-write" },
    { label: "Workflow setting", value: config.workflow ?? "Default" },
    { label: "Thinking", value: config.thinking ?? "high" },
    { label: "Startup update check", value: policy.checkOnStartup ? "Enabled" : "Disabled" },
    { label: "Automatic updates", value: !policy.autoUpdate ? "Disabled" : policy.checkOnStartup ? "Enabled" : "Enabled; inactive while startup checks are disabled" },
  ].map(entry => {
    if (typeof entry.value !== "string") throw new TypeError("Invalid status configuration field.");
    return { ...entry, value: entry.value.length > MAX_STATUS_FIELD_CHARACTERS ? entry.value.slice(0, MAX_STATUS_FIELD_CHARACTERS - 1) + "…" : entry.value };
  });
}
