/** Resource budgets are independent of the approval and sandbox policies. */
export const FILE_LIMITS = Object.freeze({
  sourceBytes: 64 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  editArgumentBytes: 1_000_000,
  replacements: 1_000_000,
  ioChunkBytes: 64 * 1024,
  operationMs: 30_000,
});

export const SEARCH_LIMITS = Object.freeze({
  patternCharacters: 4096,
  fileBytes: 1_000_000,
  totalBytes: 64 * 1024 * 1024,
  files: 20_000,
  totalMs: 15_000,
  matchMs: 1_000,
  results: 1_000,
  lineCharacters: 2_000,
});
