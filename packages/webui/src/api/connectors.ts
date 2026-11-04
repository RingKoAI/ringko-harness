// MCP and skill management endpoints.

import type { PluginCandidate, PluginCommandEntry, PluginEntry, PluginInventory, SkillEntry } from "@ringko-ai/client";
import { BASE, UnauthorizedError, authHeaders, getJson } from "./http";
import type { OAuthStart } from "../api";
export type { PluginCandidate, PluginCommandEntry, PluginEntry, PluginInventory, SkillEntry };

export interface McpServerEntry {
  name: string;
  source: string;
  scope: string;
  kind: string;
  authenticated: boolean;
  config: Record<string, unknown>;
}

export interface McpPayload {
  servers: McpServerEntry[];
  map: Record<string, Record<string, unknown>>;
}

export function fetchMcp(): Promise<McpPayload> {
  return getJson<McpPayload>("/api/mcp");
}

export interface McpToolInfo {
  name: string;
  description: string | null;
}

export interface McpConnected {
  servers: { name: string; serverInfo: Record<string, unknown>; tools: McpToolInfo[] }[];
  errors: { name: string; message: string }[];
}

export function fetchMcpConnected(): Promise<McpConnected> {
  return getJson<McpConnected>("/api/mcp/connected");
}

export async function testMcp(
  name: string,
  config: Record<string, unknown>,
): Promise<{ serverInfo: Record<string, unknown>; tools: McpToolInfo[] }> {
  const response = await fetch(`${BASE}/api/mcp/test`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ name, config }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Test failed (${response.status}).`);
  }
  return (await response.json()) as { serverInfo: Record<string, unknown>; tools: McpToolInfo[] };
}

export async function startMcpOAuth(name: string, url: string): Promise<OAuthStart> {
  const response = await fetch(`${BASE}/api/mcp/oauth`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ name, url }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `OAuth start failed (${response.status}).`);
  }
  return (await response.json()) as OAuthStart;
}

export async function saveMcp(
  servers: Record<string, unknown>,
  scope: "global" | "project" = "global",
): Promise<McpPayload> {
  const response = await fetch(`${BASE}/api/mcp`, {
    method: "PUT",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ servers, scope }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Save failed (${response.status}).`);
  }
  return (await response.json()) as McpPayload;
}

export function fetchSkills(): Promise<SkillEntry[]> {
  return getJson<SkillEntry[]>("/api/skills");
}

export async function createSkill(input: { name: string; description?: string; body?: string }): Promise<SkillEntry[]> {
  const response = await fetch(`${BASE}/api/skills`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Create failed (${response.status}).`);
  }
  return (await response.json()) as SkillEntry[];
}

export async function removeSkill(dir: string): Promise<SkillEntry[]> {
  const response = await fetch(`${BASE}/api/skills/remove`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ dir }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Remove failed (${response.status}).`);
  return (await response.json()) as SkillEntry[];
}

export async function installSkill(input: { source: string; scope: "global" | "project" }): Promise<SkillEntry[]> {
  const response = await fetch(`${BASE}/api/skills/install`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Install failed (${response.status}).`);
  }
  return (await response.json()) as SkillEntry[];
}

export function fetchPlugins(): Promise<PluginInventory> {
  return getJson<PluginInventory>("/api/plugins");
}

export async function setPluginTrust(name: string, trusted: boolean): Promise<PluginInventory> {
  const response = await fetch(`${BASE}/api/plugins/${trusted ? "trust" : "untrust"}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ name }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Plugin trust failed (${response.status}).`);
  }
  return (await response.json()) as PluginInventory;
}
