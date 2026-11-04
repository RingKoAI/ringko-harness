import {
  getOAuthDomain,
  loadAuth,
  removeOAuthAccount,
  setApiKey,
  setDefaultOAuthAccount,
  setOAuthAccount,
} from "@ringko-ai/config";
import {
  loginAnthropic,
  loginGitHubCopilot,
  loginOpenAiBrowser,
  loginOpenAiDevice,
  loginXaiDevice,
  openBrowser,
} from "@ringko-ai/auth";
import { syncModels } from "./models.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

export function normalizeAuthDomain(value: string): string {
  if (value === "openai" || value === "chatgpt" || value === "oauth") return "openai-oauth";
  if (value === "copilot") return "github-copilot";
  if (value === "xai" || value === "grok" || value === "grok-oauth") return "xai-oauth";
  if (value === "anthropic" || value === "claude" || value === "claude-oauth") return "anthropic-oauth";
  return value;
}

export async function authCommand(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const [sub, domainArg, ...flags] = parsed.positionals;
  switch (sub) {
    case undefined:
    case "list":
    case "status": {
      const state = loadAuth();
      let shown = false;
      for (const [domain, entry] of Object.entries(state.oauth)) {
        for (const account of entry.accounts) {
          shown = true;
          const label = account.credential.login ?? account.credential.accountId ?? account.id;
          const isDefault = entry.defaultAccountId === account.id ? " (default)" : "";
          io.out(`${domain}\t${label}${isDefault}`);
        }
      }
      for (const id of Object.keys(state.apikeys)) {
        shown = true;
        io.out(`${id}\tapikey\tkey=***`);
      }
      if (!shown) io.out("no credentials stored.");
      return 0;
    }
    case "set": {
      const id = domainArg;
      const key = flags[0];
      if (!id || !key) {
        io.err("auth set requires <provider> <api-key>.");
        return 2;
      }
      setApiKey(id, key);
      io.out(`stored API key for ${id}.`);
      return 0;
    }
    case "default": {
      const domain = normalizeAuthDomain(domainArg ?? "");
      const accountId = flags[0];
      if (!domain || !accountId) {
        io.err("auth default requires <domain> <account-id>.");
        return 2;
      }
      setDefaultOAuthAccount(domain, accountId);
      io.out(`default account for ${domain} set to ${accountId}.`);
      return 0;
    }
    case "logout": {
      const domain = normalizeAuthDomain(domainArg ?? "openai");
      const accountId = flags[0];
      const entry = getOAuthDomain(domain);
      const targets = accountId ? entry.accounts.filter((account) => account.id === accountId) : entry.accounts;
      if (targets.length === 0) {
        io.out(`no account to remove for ${domain}.`);
        return 0;
      }
      for (const account of targets) removeOAuthAccount(domain, account.id);
      io.out(`removed ${targets.length} account(s) for ${domain}.`);
      return 0;
    }
    case "login": {
      const domain = normalizeAuthDomain(domainArg ?? "openai");
      if (domain !== "openai-oauth" && domain !== "github-copilot" && domain !== "xai-oauth" && domain !== "anthropic-oauth") {
        io.err(`Unsupported OAuth domain "${domain}" (supported: openai-oauth, github-copilot, xai-oauth, anthropic-oauth).`);
        return 2;
      }
      try {
        const credential =
          domain === "github-copilot"
            ? await loginGitHubCopilot((url, code) => {
                io.out(`open ${url} and enter code ${code}`);
              })
            : domain === "xai-oauth"
              ? await loginXaiDevice((url, code) => {
                  io.out(`open ${url} and enter code ${code}`);
                })
              : domain === "anthropic-oauth"
                ? await loginAnthropic((url) => {
                    io.out("open this URL to sign in:");
                    io.out(url);
                    openBrowser(url);
                  })
                : flags.includes("--device")
                  ? await loginOpenAiDevice((url, code) => {
                      io.out(`open ${url} and enter code ${code}`);
                    })
                  : await loginOpenAiBrowser((url) => {
                      io.out("open this URL to sign in:");
                      io.out(url);
                      openBrowser(url);
                    });
        const accountId = credential.accountId ?? credential.login ?? `account-${Date.now().toString(36)}`;
        setOAuthAccount(domain, { id: accountId, credential, authenticatedAt: Date.now() });
        io.out(`signed in to ${domain} as ${credential.login ?? accountId}.`);
        await syncModels(domain === "github-copilot" ? "github-copilot" : domain === "xai-oauth" ? "xai" : domain === "anthropic-oauth" ? "anthropic" : "openai", domain, io);
        return 0;
      } catch (error) {
        io.err(error instanceof Error ? error.message : "login failed.");
        return 1;
      }
    }
    default:
      io.err(`Unknown auth subcommand: ${sub}`);
      return 2;
  }
}
