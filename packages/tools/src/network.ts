import { isIP } from "node:net";

export const WEB_LIMITS = Object.freeze({
  urlCharacters: 2048,
  queryCharacters: 1000,
  responseBytes: 5 * 1024 * 1024,
  timeoutSeconds: 30,
  maxTimeoutSeconds: 120,
  maxResponseChunks: 65_536,
});

function privateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host) === 4) {
    const [first, second] = host.split(".").map(Number);
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 168 || second === 0)) ||
      (first === 198 && (second === 18 || second === 19));
  }
  if (isIP(host) === 6) {
    if (host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice(7);
      if (isIP(mapped) === 4) return privateHost(mapped);
      const pair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
      if (pair) {
        const number = (Number.parseInt(pair[1]!, 16) * 65536 + Number.parseInt(pair[2]!, 16)) >>> 0;
        return privateHost([number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join("."));
      }
    }
  }
  return false;
}

/** Validate literal private targets before approval; redirects are never followed automatically. */
export function networkUrl(value: string, allowPrivateHosts = false): URL {
  if (!value || value.length > WEB_LIMITS.urlCharacters || value.includes("\0")) throw new TypeError("Invalid web URL length or format.");
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("Invalid web URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Unsupported URL scheme (only http and https are allowed).");
  if (url.username || url.password) throw new TypeError("Credentials in web URLs are not allowed.");
  if (!allowPrivateHosts && privateHost(url.hostname)) throw new TypeError("Private network addresses require an explicit host setting.");
  return url;
}

export function timeoutSignal(seconds: number | undefined, signal?: AbortSignal): AbortSignal {
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0 || seconds > WEB_LIMITS.maxTimeoutSeconds)) throw new TypeError("Web timeout must be between 0 and 120 seconds.");
  const timer = AbortSignal.timeout((seconds ?? WEB_LIMITS.timeoutSeconds) * 1000);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

export async function readBounded(response: Response, limit: number, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WEB_LIMITS.responseBytes) throw new TypeError("Invalid web response size limit.");
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  let complete = false;
  let chunksRead = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      if (++chunksRead > WEB_LIMITS.maxResponseChunks) throw new Error("Web response exceeded the chunk limit.");
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) { complete = true; break; }
      const take = Math.min(value.byteLength, limit - bytes);
      if (take) chunks.push(value.slice(0, take));
      bytes += take;
      if (value.byteLength > take) { truncated = true; break; }
    }
    return { text: new TextDecoder().decode(Buffer.concat(chunks, bytes)), truncated };
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
