import { randomUUID } from 'node:crypto';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getOAuthAccount, updateOAuthCredential, applyProxyEnv, type OAuthCredential } from '@ringko-ai/config';
import { GOOGLE_CODE_ASSIST_URL, GOOGLE_OAUTH_DOMAIN, refreshGoogle, googleProject, readGoogleJson } from '@ringko-ai/auth';

const MAX_FRAME = 1048576;
/** Unwrap the Code Assist envelope into the Google SDK's native SSE protocol. */
export function unwrapGoogleStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder(); const encoder = new TextEncoder(); let buffer = '';
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > MAX_FRAME) throw new Error('Google response frame exceeds its size limit.');
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (data && data !== '[DONE]') {
          const envelope = JSON.parse(data) as { response?: unknown; error?: unknown };
          if (envelope.error || !envelope.response) throw new Error('Google Code Assist returned an invalid response.');
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope.response)}\n\n`));
        }
        index = buffer.indexOf('\n\n');
      }
    },
    flush() { if (buffer.trim()) throw new Error('Google response stream was interrupted.'); },
  }));
}
export function createGoogleOauthFetch(accountId?: string): typeof fetch {
  const pending = new Map<string, Promise<OAuthCredential>>();
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    applyProxyEnv();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const match = /^\/v1beta\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(url.pathname);
    if (url.origin !== 'https://generativelanguage.googleapis.com' || !match || typeof init?.body !== 'string') throw new Error('Unsupported Google OAuth model request.');
    const account = getOAuthAccount(GOOGLE_OAUTH_DOMAIN, accountId);
    if (!account) throw new Error('Sign in to Google (Gemini CLI) in OAuth settings first.');
    const accountKey = account.uuid ?? account.id;
    let preparing = pending.get(accountKey);
    if (!preparing) {
      preparing = (async () => {
      let credential = account.credential;
      if (credential.expires <= Date.now() + 60000) credential = await refreshGoogle(credential);
      if (!credential.projectId) credential = { ...credential, projectId: await googleProject(credential.access, process.env.GOOGLE_CLOUD_PROJECT) };
      if (credential !== account.credential) updateOAuthCredential(GOOGLE_OAUTH_DOMAIN, account.id, credential);
      return credential;
      })().finally(() => { pending.delete(accountKey); });
      pending.set(accountKey, preparing);
    }
    const credential = await preparing;
    init.signal?.throwIfAborted();
    const streaming = match[2] === 'streamGenerateContent';
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000);
    const response = await fetch(`${GOOGLE_CODE_ASSIST_URL}:${match[2]}${streaming ? '?alt=sse' : ''}`, {
      method: 'POST', headers: { authorization: `Bearer ${credential.access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: decodeURIComponent(match[1]!), project: credential.projectId, user_prompt_id: randomUUID(), request: JSON.parse(init.body) }), signal,
    });
    if (!response.ok) { await response.body?.cancel(); return Response.json({ error: { code: response.status, message: `Google Code Assist request failed (${response.status}). Check your account, project and model access.` } }, { status: response.status }); }
    if (streaming) {
      if (!response.body) throw new Error('Google returned an empty response stream.');
      return new Response(unwrapGoogleStream(response.body), { headers: { 'content-type': 'text/event-stream' } });
    }
    const envelope = await readGoogleJson(response) as { response?: unknown };
    if (!envelope.response) throw new Error('Google returned an invalid response.');
    return Response.json(envelope.response);
  };
  return send as typeof fetch;
}
export function resolveGoogleOauthModel(model: string) {
  return createGoogleGenerativeAI({ apiKey: 'ringko-oauth', fetch: createGoogleOauthFetch() })(model);
}
