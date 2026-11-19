export const CLIENT_LIFECYCLE_VERSION = 1;
export const CLIENT_LEASE_LIMITS = {
  ttlMs: 15_000,
  maxTtlMs: 60_000,
  heartbeatMs: 3_000,
  requestMs: 2_000,
  sweepMs: 500,
  idleGraceMs: 1_000,
  startupGraceMs: 30_000,
  clients: 128,
} as const;
export type FrontendKind = "cli" | "web" | "ide";
export interface ClientLeaseGrant { id: string; instance: string; ttlMs: number; heartbeatMs: number }
export interface ClientLifecycleStatus { version: number; managed: boolean; clients: number; cli: number; web: number; ide?: number; webui: boolean }
