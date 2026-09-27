// Project (workspace) registry at `~/.ringko/projects.json`.
//
// A project names a workspace directory; exactly one may be active. The active
// project determines the workspace used for tools and where sessions are grouped.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { projectsPath } from "./paths.ts";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
}

export interface ProjectsFile {
  projects: ProjectEntry[];
  current?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProject(value: unknown): ProjectEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.path !== "string") return undefined;
  if (value.id.length === 0 || value.path.length === 0) return undefined;
  return { id: value.id, name: value.name, path: value.path };
}

/** Read the project registry; a missing file yields an empty list. */
export function loadProjects(env: NodeJS.ProcessEnv = process.env): ProjectsFile {
  let text: string;
  try {
    text = readFileSync(projectsPath(env), "utf8");
  } catch {
    return { projects: [] };
  }
  if (text.trim().length === 0) return { projects: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { projects: [] };
  }
  if (!isRecord(parsed)) return { projects: [] };
  const projects: ProjectEntry[] = [];
  if (Array.isArray(parsed.projects)) {
    for (const entry of parsed.projects) {
      const project = parseProject(entry);
      if (project) projects.push(project);
    }
  }
  const current = typeof parsed.current === "string" && projects.some((p) => p.id === parsed.current) ? parsed.current : undefined;
  return { projects, ...(current ? { current } : {}) };
}

export function saveProjects(file: ProjectsFile, env: NodeJS.ProcessEnv = process.env): string {
  const path = projectsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ projects: file.projects, current: file.current ?? "" }, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort (e.g. Windows)
  }
  return path;
}
