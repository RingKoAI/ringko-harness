import type { SubagentConfig } from "@ringko-ai/config";
import { AcpProvider } from "./providers/acp.ts";
import { CommandProvider, claudeCodeProvider, codexProvider } from "./providers/command.ts";
import { InProcessProvider } from "./providers/in-process.ts";
import { OpenAiProvider } from "./providers/openai.ts";
import type { SubagentLimits, SubagentProvider } from "./types.ts";

export interface SubagentProviderBuild {
  providers: SubagentProvider[];
  defaultProvider?: string;
  limits: Partial<SubagentLimits>;
}

function positive(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new TypeError(`subagents.${field} must be a positive integer.`);
  return value;
}

function stringField(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) throw new TypeError(`subagent ${field} must be a non-empty string.`);
  return value;
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256 || value.some(item => typeof item !== "string" || item.length > 8192)) {
    throw new TypeError(`subagent ${field} must be a bounded string array.`);
  }
  return [...value] as string[];
}

function envRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`subagent ${field} must be an object.`);
  const entries = Object.entries(value);
  if (entries.length > 256 || entries.some(([key, item]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== "string" || item.length > 8192)) {
    throw new TypeError(`subagent ${field} must map environment names to strings.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function enumField<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(`subagent ${field} is invalid.`);
  return value as T;
}

function validateProviderEntry(entry: unknown): void {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Invalid subagent provider entry.");
  const data = entry as Record<string, unknown>;
  if (data.name !== undefined && (typeof data.name !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(data.name))) throw new TypeError("Invalid subagent provider name.");
  const type = data.type;
  if (typeof type !== "string") throw new TypeError("Subagent provider type is required.");
  if (type !== "in-process" && type !== "openai" && type !== "acp" && type !== "claude-code" && type !== "codex" && type !== "command") {
    throw new TypeError(`Unknown subagent provider type "${type}".`);
  }
  if (type === "openai") {
    stringField(data.model, "openai.model", true);
    if (data.models !== undefined) {
      const models = stringList(data.models, "openai.models");
      if (!models || models.length === 0) throw new TypeError("subagent openai.models must be a non-empty string array.");
    }
    if (data.protocol !== undefined) enumField(data.protocol, "openai.protocol", ["responses", "chat"] as const);
    if (data.auth !== undefined) enumField(data.auth, "openai.auth", ["api-key", "oauth"] as const);
    if (data.oauthAccount !== undefined) stringField(data.oauthAccount, "openai.oauthAccount");
    if (data.baseURL !== undefined) stringField(data.baseURL, "openai.baseURL");
    if (data.apiKey !== undefined) stringField(data.apiKey, "openai.apiKey");
    if (data.apiKeyEnv !== undefined) stringField(data.apiKeyEnv, "openai.apiKeyEnv");
    if (data.temperature !== undefined && (typeof data.temperature !== "number" || !Number.isFinite(data.temperature))) throw new TypeError("subagent openai.temperature must be a number.");
    if (data.maxOutputTokens !== undefined) positive(data.maxOutputTokens, "openai.maxOutputTokens");
  }
  if (type === "acp" || type === "command") stringField(data.command, `${type}.command`, true);
  if (type === "claude-code" || type === "codex") stringField(data.command, `${type}.command`);
  if (data.args !== undefined) stringList(data.args, `${type}.args`);
  if (data.resumeArgs !== undefined) stringList(data.resumeArgs, `${type}.resumeArgs`);
  if (data.env !== undefined) envRecord(data.env, `${type}.env`);
  if (data.maxTurns !== undefined) positive(data.maxTurns, `${type}.maxTurns`);
  if (data.timeoutMs !== undefined) positive(data.timeoutMs, `${type}.timeoutMs`);
  if (data.permission !== undefined) enumField(data.permission, `${type}.permission`, ["allow", "reject"] as const);
  if (data.permissionMode !== undefined) {
    if (type === "codex") enumField(data.permissionMode, "codex.permissionMode", ["never", "approve-for-me", "dangerously-bypass-approvals-and-sandbox"] as const);
    else stringField(data.permissionMode, `${type}.permissionMode`);
  }
  if (data.parser !== undefined) enumField(data.parser, "command.parser", ["text", "claude-stream-json", "codex-jsonl"] as const);
  if (data.promptDelivery !== undefined) enumField(data.promptDelivery, "command.promptDelivery", ["stdin", "arg"] as const);
  if (data.continuable !== undefined && typeof data.continuable !== "boolean") throw new TypeError("subagent continuable must be boolean.");
  if (data.resume !== undefined && typeof data.resume !== "boolean") throw new TypeError("subagent resume must be boolean.");
}

/** Build the configured backend set; an empty configuration keeps the in-process default. */
export function buildSubagentProviders(config?: SubagentConfig): SubagentProviderBuild {
  if (!config) return { providers: [new InProcessProvider()], defaultProvider: "in-process", limits: {} };
  if (typeof config !== "object" || Array.isArray(config)) throw new TypeError("subagents must be an object.");
  if (config.providers !== undefined && !Array.isArray(config.providers)) throw new TypeError("subagents.providers must be an array.");
  const configured = config.providers ?? [];
  const providers: SubagentProvider[] = [];
  for (const entry of configured) {
    validateProviderEntry(entry);
    switch (entry.type) {
      case "in-process":
        providers.push(new InProcessProvider({
          ...(entry.name ? { name: entry.name } : {}),
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.maxTurns !== undefined ? { maxTurns: positive(entry.maxTurns, "maxTurns") } : {}),
          ...(entry.timeoutMs !== undefined ? { timeoutMs: positive(entry.timeoutMs, "timeoutMs") } : {}),
        }));
        break;
      case "openai":
        providers.push(new OpenAiProvider({
          ...(entry.name ? { name: entry.name } : {}),
          ...(entry.description ? { description: entry.description } : {}),
          model: entry.model,
          ...(entry.models ? { models: entry.models } : {}),
          ...(entry.protocol ? { protocol: entry.protocol } : {}),
          ...(entry.auth ? { auth: entry.auth } : {}),
          ...(entry.oauthAccount ? { oauthAccount: entry.oauthAccount } : {}),
          ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
          ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
          ...(entry.apiKeyEnv ? { apiKeyEnv: entry.apiKeyEnv } : {}),
          ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
          ...(entry.maxOutputTokens !== undefined ? { maxOutputTokens: entry.maxOutputTokens } : {}),
          ...(entry.maxTurns !== undefined ? { maxTurns: positive(entry.maxTurns, "openai.maxTurns") } : {}),
          ...(entry.timeoutMs !== undefined ? { timeoutMs: positive(entry.timeoutMs, "openai.timeoutMs") } : {}),
        }));
        break;
      case "acp":
        if (typeof entry.command !== "string" || !entry.command) throw new TypeError("ACP provider requires a command.");
        providers.push(new AcpProvider({
          ...(entry.name ? { name: entry.name } : {}),
          command: entry.command,
          ...(entry.args ? { args: entry.args } : {}),
          ...(entry.env ? { env: entry.env } : {}),
          ...(entry.permission ? { permission: entry.permission } : {}),
          ...(entry.timeoutMs !== undefined ? { timeoutMs: positive(entry.timeoutMs, "timeoutMs") } : {}),
        }));
        break;
      case "claude-code":
        providers.push(claudeCodeProvider({ ...entry }));
        break;
      case "codex":
        providers.push(codexProvider({
          ...entry,
          ...(entry.resumeArgs ? { resumeArgs: entry.resumeArgs } : {}),
        }));
        break;
      case "command":
        if (typeof entry.name !== "string" || !entry.name) throw new TypeError("A generic command provider requires an explicit name.");
        if (typeof entry.command !== "string" || !entry.command) throw new TypeError("A generic command provider requires a command.");
        providers.push(new CommandProvider({
          name: entry.name,
          command: entry.command,
          ...(entry.args ? { args: entry.args } : {}),
          ...(entry.resumeArgs ? { resumeArgs: entry.resumeArgs } : {}),
          ...(entry.parser ? { parser: entry.parser } : {}),
          ...(entry.promptDelivery ? { promptDelivery: entry.promptDelivery } : {}),
          ...(entry.model ? { model: entry.model } : {}),
          ...(entry.env ? { env: entry.env } : {}),
          capabilities: {
            continuable: entry.continuable === true,
            resume: entry.resume === true,
            modelSelection: true,
            tools: false,
            approvals: false,
          },
        }));
        break;
      default:
        throw new TypeError(`Unknown subagent provider type "${String((entry as { type?: unknown }).type)}".`);
    }
  }
  if (providers.length === 0) providers.push(new InProcessProvider());
  const defaultProvider = config.default ?? providers[0]!.name;
  return {
    providers,
    defaultProvider,
    limits: {
      ...(positive(config.maxActive, "maxActive") !== undefined ? { maxActive: positive(config.maxActive, "maxActive")! } : {}),
      ...(positive(config.maxPerRun, "maxPerRun") !== undefined ? { maxPerRun: positive(config.maxPerRun, "maxPerRun")! } : {}),
    },
  };
}
