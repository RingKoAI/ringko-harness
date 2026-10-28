export type McpSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export interface McpPermissions {
  readonly url?: string;
  readonly readOnlyTools: readonly string[];
  readonly allowedTools: readonly string[];
}

const MAX_TOOLS = 512;
const MAX_TOOL_NAME = 128;
const MAX_ENDPOINT_CHARACTERS = 16_384;
const EMPTY_PERMISSIONS: McpPermissions = Object.freeze({ readOnlyTools: Object.freeze([]), allowedTools: Object.freeze([]) });

export function mcpEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT_CHARACTERS) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Remote hints are untrusted; only operator-owned configuration grants authority. */
export function mcpPermissions(value: unknown): McpPermissions {
  if (value === undefined) return EMPTY_PERMISSIONS;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("MCP permissions must be an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(name => name !== "url" && name !== "readOnlyTools" && name !== "allowedTools")) throw new TypeError("Unknown MCP permissions field.");
  const url = mcpEndpoint(record.url);
  if (!url) throw new TypeError("MCP permissions require an exact HTTP(S) endpoint without embedded credentials.");
  const list = (field: string): readonly string[] => {
    const items = record[field];
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.length > MAX_TOOLS || items.some(item => typeof item !== "string" || !item || item.length > MAX_TOOL_NAME || !/^[A-Za-z0-9_.-]+$/.test(item))) {
      throw new TypeError(`MCP ${field} must contain bounded exact tool names.`);
    }
    return Object.freeze([...new Set(items as string[])]);
  };
  return Object.freeze({ url, readOnlyTools: list("readOnlyTools"), allowedTools: list("allowedTools") });
}

export function mcpToolAuthorized(connection: { local: boolean; endpoint?: string; sandboxMode?: McpSandboxMode }, name: string, mode: McpSandboxMode, permissions?: McpPermissions): boolean {
  if (mode === "danger-full-access") return true;
  if (connection.local) {
    return connection.sandboxMode === "read-only" || (mode === "workspace-write" && connection.sandboxMode === "workspace-write");
  }
  if (!permissions?.url || permissions.url !== connection.endpoint) return false;
  return permissions.readOnlyTools.includes(name) || (mode === "workspace-write" && permissions.allowedTools.includes(name));
}
