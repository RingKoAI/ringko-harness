import { cliCommand } from "./cli-identity.ts";

/** Quote a shell argument for the default Windows/Unix interactive shell. */
function quote(value: string, windows: boolean): string {
  return `'${value.replace(/'/g, windows ? "''" : "'\"'\"'")}'`;
}

export function resumeHint(sessionId: string, workspace: string, entry: string | undefined, windows = process.platform === "win32"): string {
  const source = entry && /\.tsx?$/.test(entry) && !entry.includes("$bunfs") ? `bun ${quote(entry, windows)}` : cliCommand(entry);
  return `Resume this session with:\n${source} --session ${quote(sessionId, windows)} --workspace ${quote(workspace, windows)}`;
}

/** Write the hint one line at a time so the shell prompt always starts on a fresh line. */
export function printResumeHint(io: { out: (line: string) => void }, sessionId: string, workspace: string, entry: string | undefined, windows = process.platform === "win32"): void {
  io.out("");
  for (const line of resumeHint(sessionId, workspace, entry, windows).split("\n")) io.out(line);
  io.out("");
}
