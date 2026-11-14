import { afterEach, expect, it, spyOn } from 'bun:test'
import { stopSessionAndWait } from '../src/api/chat'

const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout.bind(AbortSignal)
afterEach(() => { globalThis.fetch = originalFetch })

it('waits past cancellation acknowledgement until the session is actually idle', async () => {
  const paths: string[] = []; let reads = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = String(input); paths.push(path)
    return Response.json(path.endsWith('/stop') ? { ok: true } : { busy: ++reads < 2 })
  }) as typeof fetch
  await stopSessionAndWait('session fixture', new AbortController().signal)
  expect(paths).toEqual(['/api/sessions/session%20fixture/stop', '/api/sessions/session%20fixture/snapshot', '/api/sessions/session%20fixture/snapshot'])
})

it('accepts an already finished run but rejects failed cancellation and malformed session state', async () => {
  for (const status of [200, 404, 500, 401]) {
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).endsWith('/stop') ? Response.json({}, { status }) : Response.json({ busy: false })) as typeof fetch
    if (status === 200 || status === 404) await stopSessionAndWait('a', new AbortController().signal)
    else await expect(stopSessionAndWait('a', new AbortController().signal)).rejects.toThrow(status === 401 ? 'unauthorized' : 'Stop failed')
  }
  for (const value of [{}, null, { busy: 'false' }]) {
    globalThis.fetch = (async () => Response.json(value)) as typeof fetch
    await expect(stopSessionAndWait('a', new AbortController().signal)).rejects.toThrow('Invalid session state')
  }
})

it('honors cancellation before a request and during polling without another snapshot', async () => {
  const cancelled = new AbortController(); cancelled.abort(); let calls = 0
  globalThis.fetch = (async () => { calls++; return Response.json({ busy: true }) }) as typeof fetch
  await expect(stopSessionAndWait('a', cancelled.signal)).rejects.toThrow(); expect(calls).toBe(0)
  const controller = new AbortController()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls++; if (String(input).endsWith('/snapshot')) setTimeout(() => controller.abort(), 5)
    return Response.json({ busy: true })
  }) as typeof fetch
  await expect(stopSessionAndWait('a', controller.signal)).rejects.toThrow(); expect(calls).toBe(2)
})

it('times out a run that never settles with a retryable, message-preserving error', async () => {
  const clock = spyOn(AbortSignal, 'timeout').mockImplementation(() => originalTimeout(20))
  try {
    globalThis.fetch = (async () => Response.json({ busy: true })) as typeof fetch
    await expect(stopSessionAndWait('a', new AbortController().signal)).rejects.toThrow('queued message was kept')
  } finally { clock.mockRestore() }
})
