/** Quote a shell argument for the default Windows/Unix interactive shell. */
function quote(value: string, windows: boolean): string {
  return `'${value.replace(/'/g, windows ? "''" : "'\"'\"'")}'`;
}

export function resumeHint(sessionId: string, workspace: string, entry: string | undefined, windows = process.platform === "win32"): string {
  const source = entry && /\.tsx?$/.test(entry) && !entry.includes("$bunfs") ? `bun ${quote(entry, windows)}` : "ringko";
  return `\nResume this session with:\n${source} tui --session ${quote(sessionId, windows)} --workspace ${quote(workspace, windows)}`;
}
