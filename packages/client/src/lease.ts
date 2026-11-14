import { CLIENT_LEASE_LIMITS, CLIENT_LIFECYCLE_VERSION, type ClientLeaseGrant, type FrontendKind } from "@ringko-ai/protocol";
import type { BackendClient } from "./index.ts";

export interface FrontendLease { readonly lost: Promise<Error>; close(): Promise<void> }
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
class LeaseIdentityError extends Error {}
function ownershipLost(error: unknown): boolean {
  if (error instanceof LeaseIdentityError) return true;
  const value = error as { status?: number; code?: string; cause?: { code?: string } } | null;
  return [400, 401, 403, 404, 409, 503].includes(value?.status ?? 0) || ["ECONNREFUSED", "ConnectionRefused"].includes(value?.code ?? value?.cause?.code ?? "");
}
function validate(value: ClientLeaseGrant): ClientLeaseGrant {
  if (!value || typeof value.id !== "string" || !UUID.test(value.id) || typeof value.instance !== "string" || !UUID.test(value.instance) || !Number.isSafeInteger(value.heartbeatMs) || !Number.isSafeInteger(value.ttlMs) || value.heartbeatMs < 1 || value.heartbeatMs >= value.ttlMs || value.ttlMs > CLIENT_LEASE_LIMITS.maxTtlMs) throw new Error("Invalid backend client lease.");
  return value;
}

/** One lease per frontend process. Failed release is bounded by the server TTL. */
export async function attachFrontend(client: BackendClient, kind: FrontendKind): Promise<FrontendLease> {
  const identity = await client.identity(AbortSignal.timeout(CLIENT_LEASE_LIMITS.requestMs));
  if (!identity || identity.lifecycle?.version !== CLIENT_LIFECYCLE_VERSION) throw new Error("This backend predates frontend lifecycle management. Stop it with 'service stop' and restart the client.");
  const grant = validate(await client.request<ClientLeaseGrant>("/api/backend/clients", { kind }, "POST", AbortSignal.timeout(CLIENT_LEASE_LIMITS.requestMs)));
  if (grant.instance !== identity.instance) {
    try { await client.request(`/api/backend/clients/${grant.id}`, undefined, "DELETE", AbortSignal.timeout(CLIENT_LEASE_LIMITS.requestMs)); }
    catch (error) { throw new Error("Backend changed while attaching; lease cleanup failed and will expire automatically. Retry the command.", { cause: error }); }
    throw new Error("Backend changed while attaching the frontend. Retry the command.");
  }
  const controller = new AbortController();
  let notifyLost!: (error: Error) => void;
  const lost = new Promise<Error>(resolve => { notifyLost = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, closing: Promise<void> | undefined;
  let deadline = performance.now() + grant.ttlMs;
  const path = `/api/backend/clients/${grant.id}`;
  const beat = async (): Promise<void> => {
    if (closed) return;
    try {
      const value = validate(await client.request<ClientLeaseGrant>(path, {}, "PUT", AbortSignal.any([controller.signal, AbortSignal.timeout(CLIENT_LEASE_LIMITS.requestMs)])));
      if (value.id !== grant.id || value.instance !== grant.instance) throw new LeaseIdentityError("Backend client lease changed.");
      deadline = performance.now() + value.ttlMs;
    } catch (error) {
      if (closed) return;
      if (ownershipLost(error) || performance.now() >= deadline) { closed = true; controller.abort(); notifyLost(new Error("Shared backend connection was lost; restart this frontend to reconnect.", { cause: error })); return; }
    }
    if (!closed) timer = setTimeout(() => { void beat(); }, grant.heartbeatMs);
  };
  timer = setTimeout(() => { void beat(); }, grant.heartbeatMs);
  return {
    lost,
    close() {
      if (closing) return closing;
      closed = true; clearTimeout(timer); controller.abort();
      closing = client.request(path, undefined, "DELETE", AbortSignal.timeout(CLIENT_LEASE_LIMITS.requestMs)).then(() => {}, error => {
        if (![404, 503].includes((error as { status?: number }).status ?? 0)) throw error;
      });
      return closing;
    },
  };
}
