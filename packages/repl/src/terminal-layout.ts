/** ConPTY can wrap at the last cell; keep content inside the usable column range. */
export function terminalColumns(columns: number, windows = process.platform === "win32"): number {
  return Math.max(1, Math.floor(columns) - (windows ? 1 : 0));
}

/** Reserve a transcript viewport before allocating optional pinned panels. */
export function terminalLayout(rows: number, modal: boolean) {
  const height = Math.max(6, Math.floor(rows) - 1);
  const compact = height < 20;
  return {
    height,
    compact,
    todoRows: modal || height < 16 ? 0 : Math.min(5, Math.floor(height / 5)),
    jobRows: modal || height < 16 ? 0 : 2,
    inputRows: Math.max(1, Math.min(5, Math.floor(height / 5))),
  };
}
