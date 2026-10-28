import { useId, useState } from 'react'
import type { UsageStatistics } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'

export function UsageTrend({ data }: { data: UsageStatistics }) {
  const { t, locale } = useI18n()
  const [metric, setMetric] = useState<'tokens' | 'calls'>('tokens')
  const titleId = useId()
  const points = data.trend.map(bucket => ({ key: bucket.key, value: metric === 'calls' ? bucket.usage?.calls ?? 0 : bucket.usage?.totalTokens ?? 0 }))
  const maximum = Math.max(1, ...points.map(point => point.value))
  const width = 800, height = 150, step = width / Math.max(1, points.length)
  const number = new Intl.NumberFormat(locale)
  return <Card className="gap-3">
    <CardHeader className="flex flex-wrap items-center justify-between gap-2">
      <CardTitle>{t('usage.trend')}</CardTitle>
      <div className="flex gap-1">
        <Button size="sm" variant={metric === 'tokens' ? 'secondary' : 'ghost'} aria-pressed={metric === 'tokens'} onClick={() => setMetric('tokens')}>Tokens</Button>
        <Button size="sm" variant={metric === 'calls' ? 'secondary' : 'ghost'} aria-pressed={metric === 'calls'} onClick={() => setMetric('calls')}>{t('usage.requests')}</Button>
      </div>
    </CardHeader>
    <CardContent>
      <div className="mb-2 text-xs text-muted-foreground">{t(data.grain === 'month' ? 'usage.monthly' : 'usage.daily')} · {t('usage.peak', { count: number.format(Math.max(0, ...points.map(point => point.value))) })}</div>
      <svg role="img" aria-labelledby={titleId} viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" preserveAspectRatio="none">
        <title id={titleId}>{`${t('usage.trend')} · ${metric === 'tokens' ? 'Tokens' : t('usage.requests')}`}</title>
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="stroke-border" />
        {points.map((point, index) => {
          const barHeight = point.value / maximum * (height - 8)
          return <rect key={point.key} x={index * step + 1} y={height - barHeight - 1} width={Math.max(0.5, step - 2)} height={barHeight} rx="1" className="fill-primary"><title>{`${point.key}: ${number.format(point.value)}`}</title></rect>
        })}
      </svg>
      <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground"><span>{points[0]?.key}</span><span>{points.at(-1)?.key}</span></div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">{t('usage.trendData')}</summary>
        <div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-left">
          <thead><tr><th className="py-1 font-medium">{t('usage.time')}</th><th className="py-1 text-right font-medium">{metric === 'calls' ? t('usage.requests') : 'Tokens'}</th></tr></thead>
          <tbody>{points.map(point => <tr key={point.key}><td className="py-1">{point.key}</td><td className="py-1 text-right tabular-nums">{number.format(point.value)}</td></tr>)}</tbody>
        </table></div>
      </details>
    </CardContent>
  </Card>
}
