export const KEY_ROULETTE_LIMITS = {
  maxProviders: 256,
  maxKeysPerProvider: 64,
  maxKeyLength: 4_096,
} as const;

const VISIBLE_ASCII_KEY = /^[\x21-\x7e]+$/;

const providerUsage = new Map<string, Map<string, number>>();
let usageClock = 0;

/**
 * Parse a single or multi-key string (comma or newline separated) into a
 * deduplicated list of validated printable-ASCII API keys.
 */
export function parseApiKeysInput(raw: string): string[] {
  const parts = raw
    .split(/[\r\n,]+/)
    .map(token => token.trim())
    .filter(token => token.length > 0);
  if (parts.length === 0) return [];
  if (parts.length > KEY_ROULETTE_LIMITS.maxKeysPerProvider) {
    throw new Error(`At most ${KEY_ROULETTE_LIMITS.maxKeysPerProvider} API keys may be configured per provider.`);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const key of parts) {
    if (key.length > KEY_ROULETTE_LIMITS.maxKeyLength || !VISIBLE_ASCII_KEY.test(key)) {
      throw new Error("API key must contain visible ASCII characters without spaces.");
    }
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(key);
    }
  }
  return unique;
}

/**
 * Best-effort parser used when reading existing configuration or environment
 * variables (never throws; drops invalid fragments).
 */
export function splitStoredApiKeys(raw: string | readonly string[] | undefined): string[] {
  if (!raw) return [];
  const source = typeof raw === "string" ? raw.split(/[\r\n,]+/) : raw;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of source) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > KEY_ROULETTE_LIMITS.maxKeyLength || !VISIBLE_ASCII_KEY.test(trimmed)) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= KEY_ROULETTE_LIMITS.maxKeysPerProvider) break;
    }
  }
  return out;
}

/**
 * Select the least-recently-used API key for `providerName` from `keys`
 * (modeled after RikkaHub's `LruKeyRoulette`). Single-key pools return in O(1).
 */
export function selectNextApiKey(providerName: string, keys: readonly string[]): string | undefined {
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0];

  const bucketKey = providerName.trim() || "__default__";
  let history = providerUsage.get(bucketKey);
  if (!history) {
    if (providerUsage.size >= KEY_ROULETTE_LIMITS.maxProviders) {
      const oldestProvider = providerUsage.keys().next().value;
      if (oldestProvider !== undefined) providerUsage.delete(oldestProvider);
    }
    history = new Map<string, number>();
    providerUsage.set(bucketKey, history);
  }

  // Prune stale keys no longer in the configured pool.
  if (history.size > KEY_ROULETTE_LIMITS.maxKeysPerProvider) {
    const allowed = new Set(keys);
    for (const recorded of history.keys()) {
      if (!allowed.has(recorded)) history.delete(recorded);
    }
  }

  let chosen = keys[0]!;
  let chosenSeq = history.get(chosen) ?? 0;
  for (let i = 1; i < keys.length; i += 1) {
    const candidate = keys[i]!;
    const seq = history.get(candidate) ?? 0;
    if (seq < chosenSeq) {
      chosen = candidate;
      chosenSeq = seq;
    }
  }

  usageClock += 1;
  history.set(chosen, usageClock);
  return chosen;
}

/** Clear LRU rotation state (used in unit tests). */
export function resetKeyRoulette(): void {
  providerUsage.clear();
  usageClock = 0;
}
