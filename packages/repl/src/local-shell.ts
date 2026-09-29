import { createShellTool, type ShellOutput } from "@ringko-ai/tools";

/** Explicit human commands are separate from model tool authorization. */
export async function runLocalShell(command: string, workspace: string, signal?: AbortSignal): Promise<ShellOutput> {
  const tool = createShellTool({ cwd: workspace });
  const input = tool.parseInput({ command });
  const result = await tool.execute(input, { signal });
  if (!("stdout" in result)) throw new Error("Unexpected background result for a foreground command.");
  return result;
}
