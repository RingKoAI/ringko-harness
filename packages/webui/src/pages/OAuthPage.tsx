import { Copy, ExternalLink, Loader2, Plus, Star, Trash2, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  fetchAuth,
  fetchOAuthStatus,
  fetchQuota,
  removeAuthAccount,
  setDefaultAuth,
  startOAuth,
  type AuthAccount,
  type AuthDomain,
  type AuthStatus,
  type OAuthStart,
  type QuotaResponse,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'
import { Input } from '@/components/ui/input'

const POLL_INTERVAL_MS = 2000

const DOMAIN_LABELS: Record<string, string> = {
  'openai-oauth': 'ChatGPT (Codex OAuth)',
  'github-copilot': 'GitHub Copilot',
  'xai-oauth': 'xAI (Grok OAuth)',
  'anthropic-oauth': 'Anthropic (Claude Pro/Max)',
  'google-gemini-cli': 'Google (Gemini CLI OAuth)',
}

function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function formatReset(resetsAt: number): string {
  const diff = resetsAt - Date.now()
  if (diff <= 0) return ''
  const minutes = Math.floor(diff / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${minutes % 60}m`
  return `${minutes}m`
}

function Avatar({ account }: { account: AuthAccount }) {
  if (account.avatarUrl) {
    return <img src={account.avatarUrl} alt="" className="size-6 shrink-0 rounded-full" />
  }
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted">
      <User className="size-3.5 text-muted-foreground" />
    </span>
  )
}

export function OAuthPage() {
  const { t } = useI18n()
  const app = useApp()
  const [auth, setAuth] = useState<AuthStatus>({ domains: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [googleProject, setGoogleProject] = useState('')
  const [flow, setFlow] = useState<{ domain: string; data: OAuthStart } | null>(null)
  const [quotas, setQuotas] = useState<Record<string, QuotaResponse>>({})
  const [quotaFailed, setQuotaFailed] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    fetchAuth()
      .then(setAuth)
      .catch((cause: unknown) => toast.error(messageOf(cause, t('oauth.loadFailed'))))
  }, [t])
  useEffect(load, [load])

  // Poll the active device flow until it settles, then refresh the account list.
  useEffect(() => {
    if (!flow) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const status = await fetchOAuthStatus(flow.data.flowId)
        if (cancelled) return
        if (status.status === 'success') {
          toast.success(t('oauth.signedInToast'))
          setFlow(null)
          setAuth(await fetchAuth())
          app.refreshInfo()
        } else if (status.status === 'error') {
          toast.error(status.error ?? t('oauth.signInFailed'))
          setFlow(null)
        }
      } catch (cause) {
        if (!cancelled) {
          toast.error(messageOf(cause, t('oauth.signInFailed')))
          setFlow(null)
        }
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [flow, t, app])

  // Codex subscription windows, fetched once per OpenAI account.
  useEffect(() => {
    const targets = auth.domains
      .filter((entry) => entry.domain === 'openai-oauth' || entry.domain === 'xai-oauth')
      .flatMap((entry) => entry.accounts.map((account) => ({ domain: entry.domain, id: account.uuid })))
    for (const target of targets) {
      if (quotas[target.id] || quotaFailed[target.id]) continue
      fetchQuota(target.domain, target.id)
        .then((value) => setQuotas((prev) => ({ ...prev, [target.id]: value })))
        .catch(() => setQuotaFailed((prev) => ({ ...prev, [target.id]: true })))
    }
  }, [auth, quotas, quotaFailed])

  function tierLabel(name: string): string {
    if (name === '5_hour') return t('oauth.window5h')
    if (name === '7_day') return t('oauth.window7d')
    if (name === '30_day') return t('oauth.window30d')
    if (name === 'weekly') return t('oauth.windowWeekly')
    if (name === 'monthly') return t('oauth.windowMonthly')
    if (name === 'daily') return t('oauth.windowDaily')
    return name
  }

  async function addAccount(domain: string): Promise<void> {
    setBusy(domain)
    try {
      const started = await startOAuth(domain, domain === 'google-gemini-cli' ? googleProject.trim() || undefined : undefined)
      setFlow({ domain, data: started })
    } catch (cause) {
      toast.error(messageOf(cause, t('oauth.signInFailed')))
    } finally {
      setBusy(null)
    }
  }

  async function removeAccount(domain: string, accountId: string): Promise<void> {
    setBusy(`${domain}:${accountId}`)
    try {
      setAuth(await removeAuthAccount(domain, accountId))
      app.refreshInfo()
      toast.success(t('oauth.signedOutToast'))
    } catch (cause) {
      toast.error(messageOf(cause, t('oauth.signOutFailed')))
    } finally {
      setBusy(null)
    }
  }

  async function makeDefault(domain: string, accountId: string): Promise<void> {
    setBusy(`${domain}:${accountId}`)
    try {
      setAuth(await setDefaultAuth(domain, accountId))
      app.refreshInfo()
    } catch (cause) {
      toast.error(messageOf(cause, t('oauth.signOutFailed')))
    } finally {
      setBusy(null)
    }
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(t('oauth.copied'))
    } catch {
      toast.error(t('oauth.copyFailed'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('oauth.title')}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{t('oauth.intro')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {auth.domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('oauth.empty')}</p>
        ) : (
          auth.domains.map((entry: AuthDomain) => {
            const active = flow?.domain === entry.domain
            return (
              <div key={entry.domain} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{domainLabel(entry.domain)}</span>
                  <Badge variant="secondary">{t('oauth.accountCount', { count: entry.accounts.length })}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => void addAccount(entry.domain)}
                    disabled={busy === entry.domain || active}
                  >
                    <Plus data-icon="inline-start" />
                    {t('oauth.addAccount')}
                  </Button>
                </div>

                {entry.domain === 'google-gemini-cli' ? <label className="block space-y-1 text-xs text-muted-foreground">{t('oauth.googleProject')}<Input value={googleProject} onChange={event => setGoogleProject(event.target.value)} placeholder={t('oauth.googleProjectHint')} maxLength={63} /></label> : null}
                {entry.accounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('oauth.noAccounts')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {entry.accounts.map((account) => (
                      <li key={account.uuid} className="rounded-md border px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <Avatar account={account} />
                          <span className="min-w-0 flex-1 truncate text-sm">{account.login || t('oauth.signedIn')}</span>
                          {account.reauthRequired ? <Badge variant="destructive">{t('oauth.reauth')}</Badge> : null}
                          {account.isDefault ? (
                            <Badge variant="default">{t('oauth.default')}</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void makeDefault(entry.domain, account.uuid)}
                              disabled={busy === `${entry.domain}:${account.uuid}`}
                            >
                              <Star data-icon="inline-start" />
                              {t('oauth.setDefault')}
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t('oauth.removeAccount')}
                            onClick={() => void removeAccount(entry.domain, account.uuid)}
                            disabled={busy === `${entry.domain}:${account.uuid}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        {entry.domain === 'openai-oauth' || entry.domain === 'xai-oauth' ? (
                          <div className="mt-2 space-y-1 pl-8">
                            {quotas[account.uuid]?.plan ? (
                              <p className="text-xs text-muted-foreground">{quotas[account.uuid]?.plan}</p>
                            ) : null}
                            {quotas[account.uuid] && quotas[account.uuid].tiers.length > 0 ? (
                              quotas[account.uuid].tiers.map((tier) => (
                                <div key={tier.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="w-9 shrink-0">{tierLabel(tier.name)}</span>
                                  <div className="h-1.5 w-36 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={cn(
                                        'h-full rounded-full transition-all',
                                        tier.utilization >= 90
                                          ? 'bg-destructive'
                                          : tier.utilization >= 70
                                            ? 'bg-amber-500'
                                            : 'bg-primary',
                                      )}
                                      style={{ width: `${Math.min(100, Math.max(0, tier.utilization))}%` }}
                                    />
                                  </div>
                                  <span className="tabular-nums">{Math.round(tier.utilization)}%</span>
                                  {tier.resetsAt ? (
                                    <span>· {t('oauth.quotaResets', { time: formatReset(tier.resetsAt) })}</span>
                                  ) : null}
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {quotaFailed[account.uuid] ? t('oauth.quotaFailed') : t('oauth.quotaLoading')}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {active ? (
                  <div className="space-y-2 rounded-md border border-dashed p-3">
                    <p className="text-xs text-muted-foreground">{t('oauth.deviceHint')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="bg-muted rounded px-2 py-1 font-mono text-sm">{flow.data.userCode}</code>
                      <Button size="sm" variant="outline" onClick={() => void copyCode(flow.data.userCode)}>
                        <Copy data-icon="inline-start" />
                        {t('oauth.copyCode')}
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={flow.data.verificationUrl} target="_blank" rel="noreferrer">
                          <ExternalLink data-icon="inline-start" />
                          {t('oauth.open')}
                        </a>
                      </Button>
                    </div>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('oauth.waiting')}
                    </p>
                    <Button size="sm" variant="ghost" onClick={() => setFlow(null)}>
                      {t('oauth.cancel')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
