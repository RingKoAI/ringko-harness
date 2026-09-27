import type { ToolRegistry } from "@ringko-ai/harness";
import {
  createListDirTool,
  createReadFileTool,
  createWriteFileTool,
  type ListDirInput,
  type ListDirOutput,
  type ReadFileInput,
  type ReadFileOutput,
  type WriteFileInput,
  type WriteFileOutput,
} from "./filesystem.ts";
import { createFetchUrlTool, type FetchUrlInput, type FetchUrlOutput, type FetchUrlOptions } from "./network.ts";
import { createRunShellTool, type RunShellInput, type RunShellOutput, type RunShellOptions } from "./shell.ts";
import { createWorkspace, type ResolvedTarget, type Workspace } from "./workspace.ts";

export { createWorkspace };
export type { ResolvedTarget, Workspace };
export {
  createListDirTool,
  createReadFileTool,
  createWriteFileTool,
};
export type { ListDirInput, ListDirOutput, ReadFileInput, ReadFileOutput, WriteFileInput, WriteFileOutput };
export { createFetchUrlTool };
export type { FetchUrlInput, FetchUrlOutput, FetchUrlOptions };
export { createRunShellTool };
export type { RunShellInput, RunShellOutput, RunShellOptions };

export interface WorkspaceToolsOptions {
  /** Root directory that reads and writes are measured against. */
  workspace: string;
}

/**
 * Register the workspace-scoped tools (`read_file`, `write_file`, `list_dir`)
 * and return the boundary they share. Network and shell tools are registered
 * separately so hosts opt into those capabilities explicitly.
 */
export function registerWorkspaceTools(registry: ToolRegistry, options: WorkspaceToolsOptions): Workspace {
  const workspace = createWorkspace(options.workspace);
  registry.register(createReadFileTool(workspace));
  registry.register(createWriteFileTool(workspace));
  registry.register(createListDirTool(workspace));
  return workspace;
}

/** Register `fetch_url` (outbound network; approval-required). */
export function registerNetworkTools(registry: ToolRegistry, options: FetchUrlOptions = {}): void {
  registry.register(createFetchUrlTool(options));
}

/** Register `run_shell` (command execution; approval-required). */
export function registerShellTools(registry: ToolRegistry, options: RunShellOptions): void {
  registry.register(createRunShellTool(options));
}
