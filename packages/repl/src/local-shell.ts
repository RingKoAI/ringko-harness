import { Sandbox, createShellTool, type ShellOutput } from "@ringko-ai/tools";
import type { RingkoConfig } from "@ringko-ai/config";

/** Human commands bypass model approval prompts, but never the sandbox policy. */
export async function runLocalShell(command: string, workspace: string, signal?: AbortSignal, policy?: RingkoConfig["sandbox"]): Promise<ShellOutput> {
  signal?.throwIfAborted();
  const sandbox = new Sandbox({ workspace, mode: policy?.mode, additionalWritableRoots: policy?.additionalWritableRoots });
  const tool = createShellTool({ cwd: workspace, sandbox });
  const input = tool.parseInput({ command });
  const result = await tool.execute(input, { signal });
  if (!("stdout" in result)) throw new Error("Unexpected background result for a foreground command.");
  return result;
}
