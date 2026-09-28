import { expect, it } from 'bun:test';
import { googleCredential, googleProject, loginGoogle, refreshGoogle } from '../src/google';

it('validates Google tokens and retains account/project identity on refresh', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ access_token: 'new-access', expires_in: 3600 })) as unknown as typeof fetch;
    const credential = await refreshGoogle({ type: 'oauth', access: 'old', refresh: 'refresh', expires: 1, accountId: 'id', projectId: 'project', login: 'fixture@example.test' });
    expect(credential).toMatchObject({ access: 'new-access', refresh: 'refresh', accountId: 'id', projectId: 'project' });
    expect(() => googleCredential({ access_token: 'a', expires_in: 3600 })).toThrow();
    expect(() => googleCredential({ access_token: 'a', refresh_token: 'r', expires_in: -1 })).toThrow();
  } finally { globalThis.fetch = original }
});
it('completes Google callback only after account and Code Assist project setup', async () => {
  const original = globalThis.fetch; let issued!: (url: string) => void;
  const urlReady = new Promise<string>(resolve => { issued = resolve });
  const requests: string[] = [];
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); requests.push(url);
      if (url.startsWith('http://localhost')) return original(input, init);
      if (url.includes('/token')) { expect(String(init?.body)).toContain('code_verifier='); return Response.json({ access_token: 'fixture', refresh_token: 'fixture-r', expires_in: 3600 }) }
      if (url.includes('/userinfo')) return Response.json({ id: 'fixture-id', email: 'fixture@example.test' });
      if (url.includes('loadCodeAssist')) return Response.json({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'fixture-project' });
      throw new Error('Unexpected fixture request');
    }) as unknown as typeof fetch;
    const login = loginGoogle(issued); const authorize = new URL(await urlReady);
    const callback = new URL(authorize.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', '错'.repeat(64)); callback.searchParams.set('code', 'fixture-code');
    expect((await original(callback)).status).toBe(400);
    callback.searchParams.set('state', authorize.searchParams.get('state')!);
    const response = await original(callback);
    expect(response.status).toBe(200); expect(await response.text()).toContain('Google');
    expect(await login).toMatchObject({ accountId: 'fixture-id', projectId: 'fixture-project', login: 'fixture@example.test' });
    expect(requests.some(url => url.includes('loadCodeAssist'))).toBe(true);
  } finally { globalThis.fetch = original }
});
it('rejects Google denial and unavailable project access without exposing tokens', async () => {
  let issued!: (url: string) => void; const ready = new Promise<string>(resolve => { issued = resolve });
  const login = loginGoogle(issued).then(() => new Error('Unexpected success'), error => error as Error);
  const authorize = new URL(await ready); const callback = new URL(authorize.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorize.searchParams.get('state')!); callback.searchParams.set('error', 'access_denied');
  expect((await fetch(callback)).status).toBe(400); expect((await login).message).toContain('denied');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ currentTier: { id: 'standard-tier' } })) as unknown as typeof fetch;
    await expect(googleProject('fixture')).rejects.toThrow('project ID');
  } finally { globalThis.fetch = original }
});
