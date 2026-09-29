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
