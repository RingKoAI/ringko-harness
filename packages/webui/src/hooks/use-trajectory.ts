import { useEffect, useRef, useState } from 'react'
import { fetchTrajectory, UnauthorizedError, type TrajectoryRecord } from '@/api'

export const TRAJECTORY_WINDOW_LIMIT = 1000
const POLL_INTERVAL_MS = 3000

function merge(previous: TrajectoryRecord[], incoming: TrajectoryRecord[]): TrajectoryRecord[] {
  return [...new Map([...previous, ...incoming].map(record => [record.seq, record])).values()]
    .sort((a, b) => a.seq - b.seq).slice(-TRAJECTORY_WINDOW_LIMIT)
}

/** Mounted only for the active session's trajectory; requests stop on navigation. */
export function useTrajectory(sessionId?: string) {
  const [records, setRecords] = useState<TrajectoryRecord[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [revision, setRevision] = useState(0)
  const latestSeq = useRef(-1)
  const controller = useRef<AbortController | null>(null)
  const olderPending = useRef(false)

  useEffect(() => {
    if (!sessionId) return
    const id: string = sessionId
    const abort = new AbortController()
    controller.current = abort
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll(): Promise<void> {
      let delay = POLL_INTERVAL_MS
      try {
        const initial = latestSeq.current < 0
        const page = await fetchTrajectory(id, initial ? {} : { after: latestSeq.current }, abort.signal)
        if (abort.signal.aborted) return
        const last = page.records.at(-1)
        if (last) {
          latestSeq.current = last.seq
          setRecords(previous => merge(previous, page.records))
        }
        if (initial) setHasOlder(page.hasOlder)
        setReady(true)
        setError(false)
        if (page.hasNewer) delay = 0
      } catch (cause) {
        if (abort.signal.aborted) return
        setError(true)
        if (cause instanceof UnauthorizedError) return
      }
      if (!abort.signal.aborted) timer = setTimeout(() => { void poll() }, delay)
    }
    void poll()
    return () => {
      abort.abort()
      clearTimeout(timer)
      controller.current = null
    }
  }, [sessionId, revision])

  async function loadOlder(): Promise<void> {
    const abort = controller.current
    const first = records[0]
    if (!sessionId || !first || !abort || olderPending.current || records.length >= TRAJECTORY_WINDOW_LIMIT) return
    olderPending.current = true
    setLoadingOlder(true)
    try {
      const page = await fetchTrajectory(sessionId, { before: first.seq }, abort.signal)
      if (abort.signal.aborted) return
      setRecords(previous => merge(previous, page.records))
      setHasOlder(page.hasOlder)
      setError(false)
    } catch {
      if (!abort.signal.aborted) setError(true)
    } finally {
      olderPending.current = false
      setLoadingOlder(false)
    }
  }

  return { records, ready, error, hasOlder, loadingOlder, loadOlder, refresh: () => setRevision(value => value + 1) }
}
