/** Stable sandbox policy failures surfaced to tool callers. */
export class SandboxDeniedError extends Error {
  constructor(message: string) { super(message); this.name = "SandboxDeniedError"; }
}
export class SandboxUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "SandboxUnavailableError"; }
}
