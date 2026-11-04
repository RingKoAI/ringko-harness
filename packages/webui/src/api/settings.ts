// Runtime settings and session-control endpoints.

import { BASE, UnauthorizedError, authHeaders } from "./http";
import type { AccessMode, Info, UploadedFile } from "../api";

export async function setMode(workflow: string): Promise<Info> {
  const response = await fetch(`${BASE}/api/mode`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ workflow }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Switch failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

export async function setAccess(mode: AccessMode): Promise<Info> {
  const response = await fetch(`${BASE}/api/access`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ mode }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Switch failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${BASE}/api/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  const data = (await response.json()) as { files: UploadedFile[] };
  return data.files[0];
}

export async function setThinking(level: string): Promise<Info> {
  const response = await fetch(`${BASE}/api/thinking`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ level }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Set thinking failed (${response.status}).`);
  return (await response.json()) as Info;
}

export async function setUi(patch: { expandThinking?: boolean; expandTools?: boolean }): Promise<Info> {
  const response = await fetch(`${BASE}/api/ui`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Set UI failed (${response.status}).`);
  return (await response.json()) as Info;
}

export async function compact(sessionId: string, instructions?: string): Promise<{ compacted: boolean; summary: string | null; tokens: number }> {
  const response = await fetch(`${BASE}/api/compact`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ sessionId, ...(instructions ? { instructions } : {}) }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Compaction failed (${response.status}).`);
  }
  return (await response.json()) as { compacted: boolean; summary: string | null; tokens: number };
}

export async function setModel(model: string): Promise<Info> {
  const response = await fetch(`${BASE}/api/model`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ model }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Switch failed (${response.status}).`);
  }
  return (await response.json()) as Info;
}

/** Re-read config from disk and return fresh server info. */
export async function reload(): Promise<Info> {
  const response = await fetch(`${BASE}/api/reload`, { method: "POST", headers: authHeaders() });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Reload failed (${response.status}).`);
  return (await response.json()) as Info;
}

/** Verify a token by calling an authenticated endpoint. */
export async function verifyToken(token: string): Promise<boolean> {
  const response = await fetch(`${BASE}/api/sessions`, { headers: { authorization: `Bearer ${token}` } });
  return response.ok;
}
