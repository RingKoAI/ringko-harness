// Codex CLI client identity.
//
// OpenAI's backend rejects clients that do not present the Codex CLI's
// originator/User-Agent pair; mirroring them keeps automated requests from
// being treated as an unknown (and potentially abusive) client. Values are
// taken from `codex-rs/login/src/auth/default_client.rs`:
//
//   User-Agent: "{originator}/{version} ({os_type} {os_version}; {arch}) {terminal}"
//   originator: "codex_cli_rs" (DEFAULT_ORIGINATOR)
import os from "node:os";

/** `DEFAULT_ORIGINATOR` from the Codex CLI. */
export const CODEX_ORIGINATOR = "codex_cli_rs";
/** Version of the Codex CLI whose identity we present by default. */
export const CODEX_CLI_VERSION_FALLBACK = "0.158.0";
/** Managed residency header (`RESIDENCY_HEADER_NAME`). */
export const CODEX_RESIDENCY_HEADER = "x-openai-internal-codex-residency";
/** Overrides the presented Codex CLI version. */
export const CODEX_VERSION_ENV = "RINGKO_CODEX_VERSION";

const OS_NAMES: Record<string, string> = {
  win32: "Windows",
  darwin: "Mac OS",
  linux: "Linux",
  freebsd: "FreeBSD",
};

const ARCH_NAMES: Record<string, string> = {
  x64: "x86_64",
  arm64: "aarch64",
  ia32: "i686",
  arm: "arm",
};

/** The Codex CLI version we present (configurable for reproducibility). */
export function codexVersion(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CODEX_VERSION_ENV]?.trim();
  return override && override.length > 0 ? override : CODEX_CLI_VERSION_FALLBACK;
}

/** The Codex CLI User-Agent string for this platform. */
export function codexUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const osType = OS_NAMES[process.platform] ?? process.platform;
  const arch = ARCH_NAMES[process.arch] ?? process.arch;
  return `${CODEX_ORIGINATOR}/${codexVersion(env)} (${osType} ${os.release()}; ${arch})`;
}

function decodeJwt(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Compute-residency claim, unless it is `no_constraint`. */
export function extractResidency(accessToken?: string): string | undefined {
  if (!accessToken) return undefined;
  const claims = decodeJwt(accessToken);
  const auth = claims?.["https://api.openai.com/auth"];
  const nested = typeof auth === "object" && auth !== null ? (auth as Record<string, unknown>) : undefined;
  const value = nested?.chatgpt_compute_residency ?? claims?.chatgpt_compute_residency;
  if (typeof value !== "string" || value.length === 0 || value === "no_constraint") return undefined;
  return value;
}
