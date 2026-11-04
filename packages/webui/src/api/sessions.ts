// Session, trajectory, feedback and permission endpoints.

import { BASE, UnauthorizedError, authHeaders, backendClient, getJson } from "./http";
import type { SessionSnapshot, TodoItem } from "@ringko-ai/client";
import type {
  ContextUsage,
  JobSummary,
  PermissionRule,
  ServerMessage,
  SessionMeta,
  TaskSummary,
  ToolLogPage,
  TrajectoryPage,
} from "../api";

export function fetchTrajectory(id: string, cursor: { before?: number; after?: number } = {}, signal?: AbortSignal): Promise<TrajectoryPage> {
  const query = new URLSearchParams();
  if (cursor.before !== undefined) query.set('before', String(cursor.before));
  if (cursor.after !== undefined) query.set('after', String(cursor.after));
  return fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/trajectory?${query}`, { headers: authHeaders(), signal })
    .then(async response => {
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) throw new Error(`Trajectory request failed (${response.status}).`);
      return await response.json() as TrajectoryPage;
    });
}

export function fetchPermissionRules(): Promise<{ workspace: string; rules: PermissionRule[] }> {
  return getJson('/api/permissions');
}

export async function removePermissionRule(workspace: string, rule: PermissionRule): Promise<void> {
  const response = await fetch(`${BASE}/api/permissions`, {
    method: 'DELETE',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ workspace, ...rule }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(typeof body.error === 'string' ? body.error : `Permission update failed (${response.status}).`);
  }
}

export function fetchContext(id: string): Promise<ContextUsage> {
  return getJson<ContextUsage>(`/api/sessions/${encodeURIComponent(id)}/context`);
}

export async function forkSession(id: string, index?: number, before = false): Promise<{ sessionId: string }> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/fork`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ ...(index === undefined ? {} : { index }), ...(before ? { before: true } : {}) }),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) throw new Error(`Branch failed (${response.status}).`)
  return (await response.json()) as { sessionId: string }
}

export function fetchFeedback(id: string): Promise<Record<number, 'up' | 'down'>> {
  return getJson<Record<number, 'up' | 'down'>>(`/api/sessions/${encodeURIComponent(id)}/feedback`)
}

export async function sendFeedback(id: string, index: number, value: 'up' | 'down' | null): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/feedback`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ index, value }),
  })
  if (response.status === 401) throw new UnauthorizedError()
  if (!response.ok) throw new Error(`Feedback failed (${response.status}).`)
}

export function fetchSessions(): Promise<SessionMeta[]> {
  return getJson<SessionMeta[]>("/api/sessions");
}

export function fetchSession(id: string): Promise<{ id: string; messages: ServerMessage[]; tasks?: TaskSummary[]; todos?: TodoItem[]; jobs?: JobSummary[] }> {
  return getJson<{ id: string; messages: ServerMessage[] }>(`/api/sessions/${encodeURIComponent(id)}`);
}

export function fetchSnapshot(id: string): Promise<SessionSnapshot> { return backendClient.snapshot(id); }

export function fetchToolLog(id: string, offset = 0): Promise<ToolLogPage> {
  return getJson<ToolLogPage>(`/api/sessions/${encodeURIComponent(id)}/tool-log?offset=${offset}`);
}

export async function createSession(): Promise<SessionMeta> {
  const response = await fetch(`${BASE}/api/sessions`, { method: "POST", headers: authHeaders() });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Create session failed (${response.status}).`);
  return (await response.json()) as SessionMeta;
}

async function sessionAction(id: string, action: string, body?: unknown): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`${action} failed (${response.status}).`);
}

export function renameSession(id: string, title: string): Promise<void> {
  return sessionAction(id, "title", { title });
}

export function archiveSession(id: string, archived: boolean): Promise<void> {
  return sessionAction(id, "archive", { archived });
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`${BASE}/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Delete failed (${response.status}).`);
}

export async function respondApproval(id: string, approved: boolean, scope?: 'session' | 'saved'): Promise<void> {
  const response = await fetch(`${BASE}/api/approval`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ id, approved, scope }),
  });
  if (!response.ok) throw new Error(`Approval failed (${response.status}).`);
}

