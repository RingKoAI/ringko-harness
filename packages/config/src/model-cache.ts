import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import snapshot from "../models.metadata.json";
import type { ModelDefinition, ProviderDefinition } from "./config.ts";
import { writeDiagnostic } from "./diagnostics.ts";
import { findModelMetadata, MODEL_CATALOG_LIMITS, parseModelMetadata, type ModelMetadata, type ModelMetadataCatalog } from "./model-metadata.ts";
import { ringkoRoot } from "./paths.ts";
import { downloadModelCatalog } from "./model-download.ts";
import { isLoopbackHost } from "./network-address.ts";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const MODEL_CACHE_POLICY = { version: 1, ttl: 60 * 60 * 1000, retry: 5 * 60 * 1000, timeout: 10_000 } as const;

export interface ModelCatalogOptions {
  env?: NodeJS.ProcessEnv;
  url?: string;
  onRefresh?: () => void;
  onError?: (message: string) => void;
  now?: () => number;
}

let bundled: ModelMetadataCatalog | undefined;
function bundledCatalog(): ModelMetadataCatalog { return bundled ??= parseModelMetadata(snapshot); }

/** Only an explicitly configured public catalog/mirror URL is requested; no provider credentials are sent. */
export function modelCatalogUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.RINGKO_MODELS_URL?.trim();
  return catalogUrl(value || MODELS_DEV_URL);
}
function catalogUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Model catalog URL must be HTTP(S) without embedded credentials.");
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) throw new Error("Remote model catalog URLs require HTTPS; HTTP is allowed only for loopback mirrors.");
  return url.toString();
}

/** Independent, source-keyed RingKo cache. Reads never wait for a network refresh. */
export class ModelCatalogCache {
  readonly path: string;
  private readonly url: string;
  private readonly root: string;
  private readonly now: () => number;
  private readonly controller = new AbortController();
  private readonly onRefresh?: () => void;
  private readonly onError: (message: string) => void;
  private current?: ModelMetadataCatalog;
  private fetchedAt = 0;
  private retryAt = 0;
  private initialized?: Promise<void>;
  private inflight?: Promise<boolean>;

  constructor(options: ModelCatalogOptions = {}) {
    const env = options.env ?? process.env;
    this.url = options.url ? catalogUrl(options.url) : modelCatalogUrl(env);
    this.root = ringkoRoot(env);
    const key = createHash("sha256").update(this.url).digest("hex");
    this.path = join(this.root, "cache", `models-${key}.json`);
    this.now = options.now ?? Date.now;
    this.onRefresh = options.onRefresh;
    this.onError = message => {
      try { if (options.onError) options.onError(message); else writeDiagnostic("models.catalog", message); }
      catch { writeDiagnostic("models.catalog", "Model catalog diagnostic callback failed."); }
    };
  }

  private ready(): Promise<void> { return this.initialized ??= this.readCache(); }

  private async readCache(): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        for await (const chunk of file.createReadStream({ autoClose: false })) {
          bytes += chunk.length;
          if (bytes > MODEL_CATALOG_LIMITS.bytes) throw new Error("Cached model catalog exceeds the byte limit.");
          chunks.push(chunk);
        }
      } finally { await file.close(); }
      const cache = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (cache?.version !== MODEL_CACHE_POLICY.version || !Number.isSafeInteger(cache.fetchedAt) || cache.fetchedAt <= 0 || cache.fetchedAt > this.now()) throw new Error("Invalid model catalog cache header.");
      this.current = parseModelMetadata(cache.providers);
      this.fetchedAt = cache.fetchedAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.onError("Invalid model catalog cache; using the bundled snapshot.");
    }
  }

  async find(provider: ProviderDefinition, model: ModelDefinition): Promise<ModelMetadata | undefined> {
    await this.ready();
    void this.refresh();
    return (this.current ? findModelMetadata(this.current, provider, model) : undefined) ?? findModelMetadata(bundledCatalog(), provider, model);
  }

  /** Deduplicate refreshes and retain the previous directory on any network, validation or disk failure. */
  async refresh(force = false): Promise<boolean> {
    await this.ready();
    if (this.controller.signal.aborted) return false;
    if (this.inflight) return this.inflight;
    const now = this.now();
    if (!force && ((this.fetchedAt > 0 && now - this.fetchedAt < MODEL_CACHE_POLICY.ttl) || now < this.retryAt)) return false;
    const task = this.fetchAndSave();
    this.inflight = task;
    try { return await task; }
    finally { if (this.inflight === task) this.inflight = undefined; }
  }

  private async fetchAndSave(): Promise<boolean> {
    try {
      const providers = parseModelMetadata(await downloadModelCatalog(this.url, AbortSignal.any([this.controller.signal, AbortSignal.timeout(MODEL_CACHE_POLICY.timeout)])));
      const fetchedAt = this.now();
      this.controller.signal.throwIfAborted();
      await this.save({ version: MODEL_CACHE_POLICY.version, fetchedAt, providers });
      if (this.controller.signal.aborted) return false;
      this.current = providers;
      this.fetchedAt = fetchedAt;
      this.retryAt = 0;
      try { this.onRefresh?.(); }
      catch { this.onError("Model catalog updated, but its refresh notification failed."); }
      return true;
    } catch {
      this.retryAt = this.now() + MODEL_CACHE_POLICY.retry;
      if (!this.controller.signal.aborted) this.onError("Model catalog refresh failed; retaining previous metadata.");
      return false;
    }
  }

  private async save(value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MODEL_CATALOG_LIMITS.bytes) throw new Error("Normalized model catalog exceeds the byte limit.");
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const base = await realpath(this.root), parent = await realpath(directory);
    const rel = relative(base, parent);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Model catalog cache directory is outside RingKo home.");
    const temporary = join(parent, `.models-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(serialized); await file.sync(); }
      finally { await file.close(); }
      this.controller.signal.throwIfAborted();
      await rename(temporary, join(parent, basename(this.path)));
    } finally { await rm(temporary, { force: true }); }
  }

  dispose(): void { this.controller.abort(); }
}
