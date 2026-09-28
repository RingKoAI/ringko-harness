# Google / Gemini CLI OAuth

Open **Settings → OAuth accounts → Google (Gemini CLI OAuth)** and add an account.
The login uses a temporary localhost callback, PKCE, random state and the shared
English callback UI. Tokens remain server-side in the auth store; its writes use
an exclusive 0600 temporary file and atomic replacement.

An optional Google Cloud project ID can be supplied for accounts that require a
project. OAuth identity and Code Assist project setup must both succeed before
login is reported successful. Denial, malformed state, missing code, token/identity
failure, project ineligibility, setup failure and timeout are handled explicitly.
Wrong-state callbacks do not consume an otherwise valid login attempt.

The `google-gemini-cli` model provider refreshes expired credentials and uses the
Code Assist generate/streamGenerateContent envelope. Streaming responses are
unwrapped into the native Google AI SDK format, preserving text, reasoning and
tool calls. Concurrent credential preparation is isolated per account.

Successful Web login creates the provider entry if none exists. Its models come
from the maintained Google catalog; actual availability depends on the account,
project and Code Assist service. Unavailable models fail explicitly. Google API
Key providers remain separate and are not overwritten by this login.

The CLI also accepts `ringko auth login google-gemini-cli` (aliases: google,
gemini, google-oauth), with `GOOGLE_CLOUD_PROJECT` for account setup when needed.

Protocol reference: [Gemini CLI OAuth implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts),
[Code Assist setup](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/setup.ts),
[Code Assist requests](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts).
The upstream installed-app client secret is public application metadata, not a
user credential. User tokens and provider error bodies are not exposed in errors.

Tests cover callback success/denial, state rejection, token validation/refresh,
required-project errors, split/malformed SSE and actual AI SDK request routing
against synthetic local responses. Real Google account authorization and live
model entitlement still require a user sign-in; no real account was used in tests.
