// Project, workspace and directory endpoints.

import { BASE, UnauthorizedError, authHeaders, getJson } from "./http";
import type { Info, ProjectsResponse } from "../api";

export function fetchInfo(): Promise<Info> {
  // `/api/info` is unauthenticated so the client can learn whether auth is on.
  return getJson<Info>("/api/info");
}

export interface ContextUsage {
  used: number;
  limit: number;
  ratio: number;
}

export function fetchProjects(): Promise<ProjectsResponse> {
  return getJson<ProjectsResponse>("/api/projects");
}

async function projectRequest(init: RequestInit): Promise<ProjectsResponse> {
  const response = await fetch(`${BASE}/api/projects`, init);
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  return (await response.json()) as ProjectsResponse;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface DirectoryListing {
  path: string;
  home: string;
  separator: string;
  crumbs: { name: string; path: string }[];
  entries: DirectoryEntry[];
  truncated: boolean;
}

/** List the child directories of a level (default: the user home directory). */
export function listDirectory(path?: string): Promise<DirectoryListing> {
  const query = path && path.trim().length > 0 ? `?path=${encodeURIComponent(path)}` : "";
  return getJson<DirectoryListing>(`/api/fs/list${query}`);
}

export async function createDirectory(path: string, name: string): Promise<string> {
  const response = await fetch(`${BASE}/api/fs/mkdir`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ path, name }),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Create failed (${response.status}).`);
  }
  return ((await response.json()) as { path: string }).path;
}

export function addProject(path: string, name?: string): Promise<ProjectsResponse> {
  return projectRequest({
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ path, ...(name ? { name } : {}) }),
  });
}

export async function removeProject(id: string): Promise<ProjectsResponse> {
  const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Remove failed (${response.status}).`);
  return (await response.json()) as ProjectsResponse;
}

export async function setCurrentProject(id: string): Promise<ProjectsResponse> {
  const response = await fetch(`${BASE}/api/projects/${encodeURIComponent(id)}/current`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Switch failed (${response.status}).`);
  return (await response.json()) as ProjectsResponse;
}
