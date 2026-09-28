import type { ToolRegistry } from "@ringko-ai/harness";
import { createAskTool, type AskAnswer, type AskHandler, type AskInput, type AskOption, type AskOutput, type AskQuestion } from "./ask.ts";
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
  createAskTool,
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
  AskAnswer,
  AskHandler,
  AskInput,
  AskOption,
  AskOutput,
  AskQuestion,
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

export interface SessionToolsOptions {
  /** Shared list the `todowrite` tool replaces. Created when omitted. */
  todos?: TodoStore;
  /** Notified whenever the todo list changes. Ignored when `todos` is set. */
  onTodosChange?: (todos: TodoItem[]) => void;
  /**
   * Answers `ask`. Omit it and the tool is not registered, so a host with no
   * question UI never exposes a call that would only fail.
   */
  ask?: AskHandler;
}

/**
 * Register the in-session tools: `todowrite`, and `ask` when an answerer is
 * supplied. Returns the store the host UI can read.
 */
export function registerSessionTools(registry: ToolRegistry, options: SessionToolsOptions = {}): TodoStore {
  const store = options.todos ?? createTodoStore(options.onTodosChange);
  registry.register(createTodoTool(store));
  if (options.ask) {
    registry.register(createAskTool(options.ask));
  }
  return store;
}
