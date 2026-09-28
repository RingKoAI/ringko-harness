// Installed-app OAuth parameters from google-gemini/gemini-cli (Apache-2.0).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { applyProxyEnv, type OAuthCredential } from '@ringko-ai/config';
import { OAUTH_CALLBACK_HEADERS, renderOAuthCallbackPage } from './callback-page.ts';

export const GOOGLE_OAUTH_DOMAIN = 'google-gemini-cli';
export const GOOGLE_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
// Public installed-application parameter, not a user credential (see upstream oauth2.ts).
const GOOGLE_CLIENT_SECRET = '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';
export const GOOGLE_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LOGIN_TIMEOUT = 300000;
const REQUEST_TIMEOUT = 30000;
const metadata = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };

interface Tokens { access_token?: string; refresh_token?: string; expires_in?: number }
export async function readGoogleJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Google returned an empty response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 262144) { await reader.cancel(); throw new Error('Google response exceeds its size limit.'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
export function googleCredential(tokens: Tokens, previous?: OAuthCredential): OAuthCredential {
  const refresh = tokens.refresh_token ?? previous?.refresh;
  if (!tokens.access_token || !refresh || !Number.isFinite(tokens.expires_in) || tokens.expires_in! <= 0 || tokens.expires_in! > 86400) throw new Error('Google returned an invalid token response. Sign in again.');
  return { ...previous, type: 'oauth', access: tokens.access_token, refresh, expires: Date.now() + tokens.expires_in! * 1000 };
}
async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  applyProxyEnv();
  const response = await fetch(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, ...body }), signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}). Sign in again.`);
  return await readGoogleJson(response) as Tokens;
}
export async function refreshGoogle(previous: OAuthCredential): Promise<OAuthCredential> {
  return googleCredential(await tokenRequest({ grant_type: 'refresh_token', refresh_token: previous.refresh }), previous);
}
/** Code Assist setup is separate from identity; unavailable accounts fail before saving success. */
export async function googleProject(access: string, project?: string): Promise<string> {
  if (project && !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('Enter a valid Google Cloud project ID.');
  const signal = AbortSignal.timeout(120000);
  const headers = { authorization: `Bearer ${access}`, 'content-type': 'application/json' };
  const post = async (method: string, body: unknown) => {
    const response = await fetch(`${GOOGLE_CODE_ASSIST_URL}:${method}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) throw new Error(`Google Code Assist setup failed (${response.status}). Check account eligibility and Google Cloud project access.`);
    return await readGoogleJson(response) as Record<string, unknown>;
  };
  const loaded = await post('loadCodeAssist', { metadata, ...(project ? { cloudaicompanionProject: project } : {}) });
  if (typeof loaded.cloudaicompanionProject === 'string' && loaded.cloudaicompanionProject) return loaded.cloudaicompanionProject;
  if (loaded.currentTier && project) return project;
  if (loaded.currentTier) throw new Error('This Google account requires a Google Cloud project ID. Enter it and sign in again.');
  const tiers = Array.isArray(loaded.allowedTiers) ? loaded.allowedTiers as { id?: string; isDefault?: boolean }[] : [];
  const tier = tiers.find(item => item.isDefault);
  if (!tier?.id) throw new Error('Google did not return an eligible Code Assist tier. Check account eligibility.');
  if (tier.id !== 'free-tier' && !project) throw new Error('This Google account requires a Google Cloud project ID. Enter it and sign in again.');
  let operation = await post('onboardUser', { tierId: tier.id, metadata, ...(tier.id !== 'free-tier' && project ? { cloudaicompanionProject: project } : {}) });
  for (let attempt = 0; !operation.done && attempt < 20; attempt++) {
    const name = operation.name;
    if (typeof name !== 'string' || !/^operations\/[a-zA-Z0-9_/-]+$/.test(name)) throw new Error('Invalid Google setup operation.');
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 3000); const cancel = () => { clearTimeout(timer); reject(signal.reason) }; signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel() });
    const response = await fetch(`${GOOGLE_CODE_ASSIST_URL}/${name}`, { headers, signal });
    if (!response.ok) throw new Error(`Google project setup failed (${response.status}).`);
    operation = await readGoogleJson(response) as Record<string, unknown>;
  }
  const value = operation.response as { cloudaicompanionProject?: { id?: string } } | undefined;
  if (!operation.done || operation.error || !value?.cloudaicompanionProject?.id) throw new Error('Google project setup did not complete. Check account eligibility and retry.');
  return value.cloudaicompanionProject.id;
}

export async function loginGoogle(onUrl: (url: string) => void, project?: string): Promise<OAuthCredential> {
  applyProxyEnv();
  const verifier = randomBytes(32).toString('base64url'); const state = randomBytes(32).toString('base64url');
  return await new Promise((resolve, reject) => {
    let settled = false; let exchanging = false; let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, credential?: OAuthCredential) => { if (settled) return; settled = true; clearTimeout(timer); server.close(); server.closeIdleConnections(); if (error) reject(error); else resolve(credential!) };
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || (request.url?.length ?? 0) > 8192) { response.writeHead(400); response.end(); return }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/oauth2callback') { response.writeHead(404); response.end(); return }
      const returned = url.searchParams.get('state') ?? '';
      const returnedBytes = Buffer.from(returned); const stateBytes = Buffer.from(state);
      const validState = returnedBytes.length === stateBytes.length && timingSafeEqual(returnedBytes, stateBytes);
      if (!validState) { response.writeHead(400, OAUTH_CALLBACK_HEADERS); response.end(renderOAuthCallbackPage('Google', { status: 'error', reason: 'invalid-state' })); return }
      const code = url.searchParams.get('code');
      if (url.searchParams.has('error') || !code) { response.writeHead(400, OAUTH_CALLBACK_HEADERS); response.end(renderOAuthCallbackPage('Google', { status: 'error', reason: url.searchParams.has('error') ? 'denied' : 'missing-code' })); finish(new Error('Google authorization was denied or cancelled.')); return }
      if (exchanging || settled) { response.writeHead(409); response.end(); return } exchanging = true;
      const address = server.address(); if (!address || typeof address === 'string') { finish(new Error('Google callback server is unavailable.')); return }
      void (async () => {
        try {
          const tokens = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: `http://localhost:${address.port}/oauth2callback` });
          const credential = googleCredential(tokens);
          const identity = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: `Bearer ${credential.access}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
          if (!identity.ok) throw new Error(`Google identity lookup failed (${identity.status}).`);
          const user = await readGoogleJson(identity) as { id?: string; email?: string };
          if (!user.id || !user.email) throw new Error('Google did not return an account identity.');
          credential.accountId = user.id; credential.login = user.email;
          credential.projectId = await googleProject(credential.access, project);
          if (settled) return;
          response.writeHead(200, OAUTH_CALLBACK_HEADERS); response.end(renderOAuthCallbackPage('Google', { status: 'success' })); finish(undefined, credential);
        } catch (error) { if (!settled) { response.writeHead(502, OAUTH_CALLBACK_HEADERS); response.end(renderOAuthCallbackPage('Google', { status: 'error', reason: 'token-exchange' })); finish(error instanceof Error ? error : new Error('Google sign-in failed.')) } }
      })();
    });
    server.once('error', error => finish(error));
    timer = setTimeout(() => { server.closeAllConnections(); finish(new Error('Google sign-in timed out. Retry from settings.')) }, LOGIN_TIMEOUT); timer.unref?.();
    server.listen(0, 'localhost', () => {
      const address = server.address(); if (!address || typeof address === 'string') { finish(new Error('Cannot start Google callback server.')); return }
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [key, value] of Object.entries({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `http://localhost:${address.port}/oauth2callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile' })) url.searchParams.set(key, value);
      try { onUrl(url.toString()) } catch { finish(new Error('Cannot present the Google authorization URL.')) }
    });
  });
}
