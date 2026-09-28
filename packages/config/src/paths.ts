// User-level resource locations.
//
// RingKo reads user configuration, skills, and MCP servers from two roots:
//   ~/.ringko/                ringko-specific (takes precedence)
//   ~/.agents/                shared agent resources
//
// `RINGKO_HOME` and `AGENTS_HOME` override the home directories (used by tests
// and portable installs).
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const RINGKO_DIR_NAME = ".ringko";
export const AGENTS_DIR_NAME = ".agents";

/** Provider/model definitions. */
export const PROVIDER_FILE_NAME = "provider.json";
/** Local, non-shared settings (workspace, capabilities, mode, ...). */
export const SETTINGS_FILE_NAME = "settings.local.json";
/** Legacy single-file config (still read when present). */
export const CONFIG_FILE_NAME = "config";
export const MCP_FILE_NAME = ".mcp.json";
/** Project-level alternative that may also carry a `mcpServers` map. */
export const PROJECT_CONFIG_FILE_NAME = "ringko.json";
/** Provider credentials (OAuth tokens / API keys). */
export const AUTH_DIR_NAME = "auth";
export const AUTH_FILE_NAME = "auth.json";
/** Tool/connector credentials (MCP OAuth tokens / keys / headers). */
export const TOOL_AUTH_FILE_NAME = "tool.auth.json";
/** Registered projects (workspaces) and the active one. */
export const PROJECTS_FILE_NAME = "projects.json";
/** Workflow (mode) definitions. */
export const WORKFLOWS_FILE_NAME = "workflows.json";
/** Aggregated token/cache usage. */
export const USAGE_FILE_NAME = "usage.json";

/** Supported skills directory names, in precedence order. */
export const SKILLS_DIR_NAMES = ["skills", "skill"] as const;

/** Markers that identify a project root when walking up from a workspace. */
const PROJECT_MARKERS = [".git", ".mcp.json", PROJECT_CONFIG_FILE_NAME, AGENTS_DIR_NAME];

function homeOf(env: NodeJS.ProcessEnv, key: string): string {
  const override = env[key];
  return override && override.trim().length > 0 ? override : homedir();
}

/** `~/.ringko` (or `$RINGKO_HOME/.ringko`). */
export function ringkoRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeOf(env, "RINGKO_HOME"), RINGKO_DIR_NAME);
}

/** `~/.agents` (or `$AGENTS_HOME/.agents`). */
export function agentsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeOf(env, "AGENTS_HOME"), AGENTS_DIR_NAME);
}

/** Provider file: `~/.ringko/provider.json`. */
export function providerPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), PROVIDER_FILE_NAME);
}

/** Settings file: `~/.ringko/settings.local.json`. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), SETTINGS_FILE_NAME);
}

/** Legacy config file: `~/.ringko/config`. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), CONFIG_FILE_NAME);
}

/** Credentials file: `~/.ringko/auth/auth.json`. */
export function authPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), AUTH_DIR_NAME, AUTH_FILE_NAME);
}

/** Tool/connector credentials: `~/.ringko/tool.auth.json`. */
export function toolAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), TOOL_AUTH_FILE_NAME);
}

/** Project registry file: `~/.ringko/projects.json`. */
export function projectsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), PROJECTS_FILE_NAME);
}

/** Workflow definitions: `~/.ringko/workflows.json`. */
export function workflowsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), WORKFLOWS_FILE_NAME);
}

/** Aggregated usage: `~/.ringko/usage.json`. */
export function usagePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ringkoRoot(env), USAGE_FILE_NAME);
}

/** MCP files, precedence order (ringko first). */
export function mcpPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return [join(ringkoRoot(env), MCP_FILE_NAME), join(agentsRoot(env), MCP_FILE_NAME)];
}

/** Skills directories, precedence order (ringko first). */
export function skillsDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = [];
  for (const root of [ringkoRoot(env), agentsRoot(env)]) {
    for (const name of SKILLS_DIR_NAMES) {
      dirs.push(join(root, name));
    }
  }
  return dirs;
}

/** Walk up from `cwd` for a project marker, stopping before the home directory. */
export function findProjectRoot(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = resolve(homeOf(env, "RINGKO_HOME"));
  let dir = resolve(cwd);
  for (;;) {
    if (dir === home) return undefined;
    for (const marker of PROJECT_MARKERS) {
      try {
        if (statSync(join(dir, marker))) return dir;
      } catch {
        // marker absent
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Project-level MCP config files (`.mcp.json`, `ringko.json`), when a project root exists. */
export function projectMcpPaths(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  const root = findProjectRoot(cwd, env);
  if (!root) return [];
  return [join(root, MCP_FILE_NAME), join(root, PROJECT_CONFIG_FILE_NAME)];
}

/** Project-level skills directories, when a project root exists. */
export function projectSkillsDirs(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  const root = findProjectRoot(cwd, env);
  if (!root) return [];
  const dirs: string[] = [];
  for (const base of [AGENTS_DIR_NAME, RINGKO_DIR_NAME]) {
    for (const name of SKILLS_DIR_NAMES) {
      dirs.push(join(root, base, name));
    }
  }
  return dirs;
}
