import { randomUUID } from "node:crypto";
import { CLIENT_LEASE_LIMITS, CLIENT_LIFECYCLE_VERSION, type ClientLeaseGrant, type ClientLifecycleStatus, type FrontendKind } from "@ringko-ai/protocol";

export class ClientCapacityError extends Error {}
export interface ClientLifecycleOptions {
  managed?: boolean;
  webui?: boolean;
  limits?: Partial<Record<"ttlMs" | "heartbeatMs" | "idleGraceMs" | "startupGraceMs", number>>;
  now?: () => number;
}

/** Explicit process leases, not API/SSE request counts. All mutations are synchronous. */
export class ClientLifecycle {
  private readonly leases = new Map<string, { kind: FrontendKind; expires: number }>();
  private readonly now: () => number;
  private readonly limits: { ttlMs: number; heartbeatMs: number; idleGraceMs: number; startupGraceMs: number };
  private readonly startupUntil: number;
  private idleSince: number;
  private everAttached = false;
  private persistent: boolean;
  private readonly baseWebui: boolean;

  constructor(private readonly instance: string, options: ClientLifecycleOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.limits = {
      ttlMs: options.limits?.ttlMs ?? CLIENT_LEASE_LIMITS.ttlMs,
      heartbeatMs: options.limits?.heartbeatMs ?? CLIENT_LEASE_LIMITS.heartbeatMs,
      idleGraceMs: options.limits?.idleGraceMs ?? CLIENT_LEASE_LIMITS.idleGraceMs,
      startupGraceMs: options.limits?.startupGraceMs ?? CLIENT_LEASE_LIMITS.startupGraceMs,
    };
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value < 1) || this.limits.heartbeatMs >= this.limits.ttlMs || this.limits.ttlMs > CLIENT_LEASE_LIMITS.maxTtlMs) throw new TypeError("Invalid client lifecycle limits.");
    this.persistent = !options.managed;
    this.baseWebui = options.webui ?? !options.managed;
    this.idleSince = this.now(); this.startupUntil = this.idleSince + this.limits.startupGraceMs;
  }
  private prune(): void {
    const now = this.now(), hadClients = this.leases.size > 0;
    for (const [id, lease] of this.leases) if (lease.expires <= now) this.leases.delete(id);
    if (hadClients && !this.leases.size) this.idleSince = now;
  }
  private grant(id: string): ClientLeaseGrant { return { id, instance: this.instance, ttlMs: this.limits.ttlMs, heartbeatMs: this.limits.heartbeatMs }; }
  acquire(kind: FrontendKind): ClientLeaseGrant {
    if (kind !== "cli" && kind !== "web") throw new TypeError("Invalid frontend kind.");
    this.prune();
    if (this.leases.size >= CLIENT_LEASE_LIMITS.clients) throw new ClientCapacityError("Too many frontend clients.");
    const id = randomUUID(); this.leases.set(id, { kind, expires: this.now() + this.limits.ttlMs }); this.everAttached = true;
    return this.grant(id);
  }
  renew(id: string): ClientLeaseGrant | undefined {
    this.prune(); const lease = this.leases.get(id);
    if (!lease) return undefined;
    lease.expires = this.now() + this.limits.ttlMs; return this.grant(id);
  }
  release(id: string): void {
    this.prune(); if (this.leases.delete(id) && !this.leases.size) this.idleSince = this.now();
  }
  pin(): void { this.persistent = true; }
  status(): ClientLifecycleStatus {
    this.prune(); let cli = 0, web = 0;
    for (const lease of this.leases.values()) if (lease.kind === "cli") cli++; else web++;
    return { version: CLIENT_LIFECYCLE_VERSION, managed: !this.persistent, clients: cli + web, cli, web, webui: this.baseWebui || web > 0 };
  }
  shouldClose(hasWork: boolean): boolean {
    this.prune(); const now = this.now();
    if (hasWork) this.idleSince = now;
    return !this.persistent && !hasWork && !this.leases.size && (this.everAttached || now >= this.startupUntil) && now - this.idleSince >= this.limits.idleGraceMs;
  }
}
