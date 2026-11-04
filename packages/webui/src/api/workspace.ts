// Workspace file browsing and terminal endpoints.

import { BASE, UnauthorizedError, authHeaders, getJson } from "./http";

export interface WorkspaceEntry { name: string; path: string; directory: boolean }
export function fetchWorkspaceFiles(path = ''): Promise<{ path: string; entries: WorkspaceEntry[]; truncated: boolean }> { return getJson(`/api/workspace/files?path=${encodeURIComponent(path)}`) }
export function fetchWorkspaceFile(path: string): Promise<{ path: string; content: string; binary: boolean; truncated: boolean }> { return getJson(`/api/workspace/file?path=${encodeURIComponent(path)}`) }
export function fetchWorkspaceDiff(path = ''): Promise<{ path: string; content: string }> { return getJson(`/api/workspace/diff?path=${encodeURIComponent(path)}`) }

export async function createTerminal(cols: number, rows: number): Promise<{ id: string }> {
  const response = await fetch(`${BASE}/api/terminal`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ cols, rows }),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown }
    throw new Error(typeof body.error === 'string' ? body.error : `Terminal start failed (${response.status}).`)
  }
  return await response.json() as { id: string }
}

export async function disposeTerminal(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/terminal/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok && response.status !== 404) throw new Error(`Terminal close failed (${response.status}).`)
}

export function terminalSocketUrl(id: string): string {
  const socketUrl = new URL(`/api/terminal/${encodeURIComponent(id)}/socket`, window.location.href)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return socketUrl.toString()
}
