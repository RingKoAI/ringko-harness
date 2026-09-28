export type OAuthFailure = "denied" | "invalid-state" | "missing-code" | "token-exchange" | "timed-out";
export type OAuthCallbackResult = { status: "success" } | { status: "error"; reason: OAuthFailure };

export const OAUTH_CALLBACK_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const FAILURE_TEXT: Record<OAuthFailure, string> = {
  denied: "Authorization was cancelled or denied.",
  "invalid-state": "This sign-in attempt could not be verified.",
  "missing-code": "The authorization response did not include a code.",
  "token-exchange": "RingKo could not complete the token exchange.",
  "timed-out": "Sign-in took too long to complete.",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

/** Render a provider-neutral browser callback page after an OAuth result. */
export function renderOAuthCallbackPage(provider: string, result: OAuthCallbackResult): string {
  const success = result.status === "success";
  const providerName = escapeHtml(provider.trim().slice(0, 80) || "Provider");
  const description = success
    ? `${providerName} is connected to RingKo.`
    : `${providerName}: ${FAILURE_TEXT[result.reason]}`;
  const title = success ? "Sign-in complete" : "Sign-in failed";
  const next = success
    ? "Return to your terminal to continue using RingKo. You can close this browser tab."
    : "Return to your terminal and start sign-in again. You can close this browser tab.";
  const icon = success
    ? '<path d="M9 19.5L16 26.5L29 12.5" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M19 10V21M19 27H19.01" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${title} · RingKo</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 50% 0%, #362314 0%, #18191d 42%, #111216 100%); color: #f6f5f2; }
    main { width: min(100%, 440px); padding: 40px; border: 1px solid #383a40; border-radius: 20px; background: #202126; box-shadow: 0 24px 80px #0006; text-align: center; }
    .brand { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 38px; font-size: 18px; font-weight: 700; letter-spacing: -.02em; }
    .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #ff7a1a; color: #18191d; font-size: 20px; font-weight: 800; }
    .status-icon { display: grid; place-items: center; width: 72px; height: 72px; margin: 0 auto 24px; border: 1px solid ${success ? "#3f7252" : "#8d4a46"}; border-radius: 50%; background: ${success ? "#193625" : "#3a2223"}; color: ${success ? "#80d9a0" : "#f3a6a0"}; }
    h1 { margin: 0 0 12px; font-size: clamp(26px, 6vw, 32px); line-height: 1.25; letter-spacing: -.03em; }
    p { margin: 0; color: #b9bbc2; font-size: 15px; line-height: 1.7; }
    .next { margin-top: 32px; padding: 16px; border: 1px solid #3a3c42; border-radius: 12px; background: #282a30; text-align: left; }
    .next strong { display: block; margin-bottom: 4px; color: #f6f5f2; font-size: 14px; }
    .next p { font-size: 14px; }
    @media (max-width: 480px) { main { padding: 30px 24px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="brand-mark" aria-hidden="true">R</span><span>RingKo</span></div>
    <div class="status-icon" aria-hidden="true"><svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">${icon}</svg></div>
    <h1>${title}</h1>
    <p>${description}</p>
    <div class="next"><strong>What's next</strong><p>${next}</p></div>
  </main>
</body>
</html>`;
}
