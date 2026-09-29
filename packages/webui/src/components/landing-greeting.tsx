import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n'
import { greetingPeriod } from '@/lib/greeting'

const CLOCK_REFRESH_MS = 60_000

export function LandingGreeting() {
  const { t } = useI18n()
  const [period, setPeriod] = useState(() => greetingPeriod())

  useEffect(() => {
    const refresh = () => setPeriod(greetingPeriod())
    const timer = window.setInterval(refresh, CLOCK_REFRESH_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return <h1 className="text-xl font-medium tracking-tight sm:text-2xl">{t(`chat.greeting.${period}`)}</h1>
}
