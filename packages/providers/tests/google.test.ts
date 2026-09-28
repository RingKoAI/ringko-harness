import { expect, it } from 'bun:test';
import { unwrapGoogleStream } from '../src/google';
import { createProviderClient } from '../src/index';
import { setOAuthAccount } from '@ringko-ai/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('unwraps split Code Assist SSE frames and rejects truncated or malformed frames', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('data: {"res')); controller.enqueue(encoder.encode('ponse":{"candidates":[]}}\r\n\r\n')); controller.close() } });
  expect(await new Response(unwrapGoogleStream(body)).text()).toBe('data: {"candidates":[]}\n\n');
  const truncated = new Response('data: {"response":').body!;
  await expect(new Response(unwrapGoogleStream(truncated)).text()).rejects.toThrow('interrupted');
  const error = new Response('data: {"error":{}}\n\n').body!;
  await expect(new Response(unwrapGoogleStream(error)).text()).rejects.toThrow('invalid response');
});

it('routes Google OAuth inference through Code Assist and emits native reasoning/text', async () => {
  const original = globalThis.fetch; const previousHome = process.env.RINGKO_HOME;
  const root = mkdtempSync(join(tmpdir(), 'rkh-google-provider-')); process.env.RINGKO_HOME = root;
  try {
    setOAuthAccount('google-gemini-cli', { id: 'fixture-account', authenticatedAt: 1, credential: { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: Date.now() + 3600000, projectId: 'fixture-project' } });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: 'gemini-fixture', project: 'fixture-project' });
      expect(body.request.contents).toBeArray();
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-access');
      return new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: 'model', parts: [{ text: 'thought', thought: true }, { text: 'answer' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const chunks: string[] = [];
    const result = await createProviderClient({ provider: 'google-gemini-cli', model: 'gemini-fixture' })({ messages: [{ role: 'user', content: 'test' }], tools: [], onDelta: delta => chunks.push(`${delta.kind}:${delta.text}`) });
    expect(result.content).toBe('answer'); expect(chunks).toContain('reasoning:thought'); expect(chunks).toContain('text:answer');
  } finally { globalThis.fetch = original; if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome; rmSync(root, { recursive: true, force: true }) }
});
