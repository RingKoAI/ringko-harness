import { NPM_PACKAGE_NAME } from "../cli-identity.ts";
import { UPDATE_LIMITS, UPDATE_REGISTRY, releaseVersion } from "./policy.ts";

export type UpdateFetch = (url: string, options: RequestInit) => Promise<Response>;

export async function download(url: string, limit: number, fetcher: UpdateFetch = fetch, timeout: number = UPDATE_LIMITS.installMs): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetcher(url, { signal, headers: { "user-agent": "ringko-updater" } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Update request failed (HTTP ${response.status}).`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Update source returned an empty body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Update download exceeds the size limit.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function checkForUpdate(current: string, fetcher: UpdateFetch = fetch): Promise<{ current: string; latest: string; available: boolean }> {
  releaseVersion(current);
  const bytes = await download(`${UPDATE_REGISTRY}/${encodeURIComponent(NPM_PACKAGE_NAME)}/latest`, UPDATE_LIMITS.metadataBytes, fetcher, UPDATE_LIMITS.checkMs);
  const metadata: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const latest = releaseVersion(metadata && typeof metadata === "object" ? (metadata as { version?: unknown }).version : undefined);
  return { current, latest, available: !latest.split("+")[0]!.includes("-") && Bun.semver.order(latest, current) > 0 };
}
