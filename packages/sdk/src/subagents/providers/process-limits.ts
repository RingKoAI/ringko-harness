export const SUBAGENT_PROCESS_LIMITS = Object.freeze({
  stdoutBytes: 2 * 1024 * 1024,
  stderrBytes: 2 * 1024 * 1024,
  lineBytes: 256 * 1024,
  frames: 2048,
  stderrTailCharacters: 8192,
  timeoutMs: 120_000,
  terminateMs: 2_000,
  killCommandMs: 5_000,
});
