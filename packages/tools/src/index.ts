import type { ToolRegistry } from "@ringko-ai/harness";
import { createEditTool, type EditInput, type EditOutput } from "./edit.ts";
import { FileTracker, type FileVersion } from "./file-tracker.ts";
import { createGlobTool, type GlobInput, type GlobOutput } from "./glob.ts";
import { createGrepTool, type GrepInput, type GrepMatch, type GrepOutput } from "./grep.ts";
import { createReadTool, type ReadInput, type ReadOutput } from "./read.ts";
import { createShellTool, type ShellInput, type ShellOptions, type ShellOutput } from "./shell.ts";
import { createTodoStore, createTodoTool, type TodoInput, type TodoItem, type TodoOutput, type TodoStatus, type TodoStore } from "./todo.ts";
import { createWebFetchTool, type WebFetchInput, type WebFetchOptions, type WebFetchOutput } from "./webfetch.ts";
import { createWriteTool, type WriteInput, type WriteOutput } from "./write.ts";
import { createWorkspace, type ResolvedTarget, type Workspace } from "./workspace.ts";

export { createWorkspace, FileTracker };
export type { FileVersion, ResolvedTarget, Workspace };
export {
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createShellTool,
  createTodoStore,
  createTodoTool,
  createWebFetchTool,
  createWriteTool,
};
export type {
  EditInput,
  EditOutput,
  GlobInput,
  GlobOutput,
  GrepInput,
  GrepMatch,
  GrepOutput,
  ReadInput,
  ReadOutput,
  ShellInput,
  ShellOptions,
  ShellOutput,
  TodoInput,
  TodoItem,
  TodoOutput,
  TodoStatus,
  TodoStore,
  WebFetchInput,
  WebFetchOptions,
  WebFetchOutput,
  WriteInput,
  WriteOutput,
};

export interface WorkspaceToolsOptions {
  /** Root directory that reads and writes are measured against. */
  workspace: string;
}

/**
 * Register the workspace-scoped tools (`read`, `write`, `edit`, `glob`, `grep`)
 * and return the boundary they share. Network and shell tools are registered
 * separately so hosts opt into those capabilities explicitly.
 */
export function registerWorkspaceTools(registry: ToolRegistry, options: WorkspaceToolsOptions): Workspace {
  const workspace = createWorkspace(options.workspace);
  const tracker = new FileTracker();
  registry.register(createReadTool(workspace, tracker));
  registry.register(createWriteTool(workspace, tracker));
  registry.register(createEditTool(workspace, tracker));
  registry.register(createGlobTool(workspace));
  registry.register(createGrepTool(workspace));
  return workspace;
}

/** Register `webfetch` (outbound network; approval-required). */
export function registerNetworkTools(registry: ToolRegistry, options: WebFetchOptions = {}): void {
  registry.register(createWebFetchTool(options));
}

/** Register `shell` (command execution; approval-required). */
export function registerShellTools(registry: ToolRegistry, options: ShellOptions): void {
  registry.register(createShellTool(options));
}
