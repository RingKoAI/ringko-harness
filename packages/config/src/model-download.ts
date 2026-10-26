import { MODEL_CATALOG_LIMITS } from "./model-metadata.ts";

/** Download public metadata with no credentials, redirects, or unbounded response buffering. */
export async function downloadModelCatalog(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Model catalog download failed (HTTP ${response.status}).`); }
  if (Number(response.headers.get("content-length")) > MODEL_CATALOG_LIMITS.bytes) { await response.body.cancel(); throw new Error("Model catalog exceeds the byte limit."); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MODEL_CATALOG_LIMITS.bytes) throw new Error("Model catalog exceeds the byte limit.");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
