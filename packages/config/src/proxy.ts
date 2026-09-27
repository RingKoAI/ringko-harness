// Outbound proxy resolution.
//
// Bun's fetch honors `HTTPS_PROXY`/`HTTP_PROXY`, so RingKo exposes a single
// `RINGKO_PROXY` override that is propagated onto those variables at startup.
export const PROXY_ENV = "RINGKO_PROXY";
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

/** Effective proxy URL: `RINGKO_PROXY` wins, then the standard variables. */
export function resolveProxy(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env[PROXY_ENV]?.trim();
  if (explicit) return explicit;
  for (const key of PROXY_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Fill the standard proxy variables from `RINGKO_PROXY` (when they are unset),
 * so Bun's fetch — including the AI SDK and OAuth calls — routes through it.
 */
export function applyProxyEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const proxy = resolveProxy(env);
  if (proxy) {
    for (const key of PROXY_KEYS) {
      if (!env[key]?.trim()) env[key] = proxy;
    }
  }
  return proxy;
}
