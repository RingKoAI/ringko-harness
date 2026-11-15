// Provider OAuth failures without reflecting untrusted response bodies.
//
// Token endpoints may echo credentials in error descriptions, HTML or debug
// payloads. Public errors keep the HTTP status and, when present, one bounded
// protocol error code; everything else is replaced with fixed text.

const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** A bounded protocol error identifier, or undefined for arbitrary provider text. */
export function safeOAuthErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ERROR_CODE.test(value) ? value : undefined;
}

export function oauthFailureMessage(label: string, status: number, body: string): string {
  let code: string | undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      code = safeOAuthErrorCode((parsed as { error?: unknown }).error);
    }
  } catch {
    // Non-JSON bodies are not safe to reflect.
  }
  return `${label} request failed: ${status}${code ? ` (${code})` : ""}`;
}
