import { useTheme } from 'next-themes'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { fetchPermissionRules, removePermissionRule, setUi, type BusyEnterMode, type PermissionRule } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UpdateSettings } from '@/components/update-settings'
import { LOCALES, useI18n, type Locale, type MessageKey } from '@/i18n'
import { ConnectorsPage } from '@/pages/ConnectorsPage'
import { OAuthPage } from '@/pages/OAuthPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ProvidersPage } from '@/pages/ProvidersPage'
import { SkillsPage } from '@/pages/SkillsPage'
import { UsagePage } from '@/pages/UsagePage'
import { useApp } from '@/store'
import { site } from '@/site'
import { cn } from '@/lib/utils'

const PAGES: { slug: string; label: MessageKey }[] = [
  { slug: 'general', label: 'settings.general' },
  { slug: 'usage', label: 'settings.usage' },
  { slug: 'projects', label: 'settings.projects' },
  { slug: 'providers', label: 'settings.providers' },
  { slug: 'oauth', label: 'settings.oauth' },
  { slug: 'connectors', label: 'settings.connectors' },
  { slug: 'skills', label: 'settings.skills' },
  { slug: 'permissions', label: 'settings.permissions' },
  { slug: 'about', label: 'settings.about' },
]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
  )
}

function GeneralPage() {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const app = useApp()
  const themes: { value: string; label: MessageKey }[] = [
    { value: 'light', label: 'theme.light' },
    { value: 'dark', label: 'theme.dark' },
    { value: 'system', label: 'theme.system' },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.general')}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label={t('settings.workspace')}>
          <span className="break-all font-mono text-xs">{app.info?.workspace ?? '—'}</span>
        </Row>
        <Row label={t('settings.access')}>{app.info?.access.label ?? '—'}</Row>
        <Row label={t('settings.authRequired')}>
          <Badge variant={app.info?.auth.required ? 'default' : 'secondary'}>
            {app.info?.auth.required ? t('settings.authOn') : t('settings.authOff')}
          </Badge>
        </Row>
        <Row label={t('theme.toggle')}>
          <Select value={theme ?? 'system'} onValueChange={setTheme}>
            <SelectTrigger aria-label={t('theme.toggle')} className="h-9 w-full min-w-32 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themes.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>{t(entry.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t('language.toggle')}>
          <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <SelectTrigger aria-label={t('language.toggle')} className="h-9 w-full min-w-32 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t('settings.busyEnter')}>
          <div className="flex flex-col items-end gap-1">
            <Select
              value={app.info?.busyEnter ?? 'queue'}
              onValueChange={(value) => {
                const busyEnter = value as BusyEnterMode
                setUi({ busyEnter })
                  .then(() => app.refreshInfo())
                  .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
              }}
            >
              <SelectTrigger aria-label={t('settings.busyEnter')} className="h-9 w-full min-w-32 sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="queue">{t('settings.busyEnterQueue')}</SelectItem>
                <SelectItem value="steer">{t('settings.busyEnterSteer')}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">{t('settings.busyEnterHint')}</span>
          </div>
        </Row>
        <UpdateSettings />
      </CardContent>
    </Card>
  )
}

function PermissionsPage() {
  const { t } = useI18n()
  const workspace = useApp().info?.workspace
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [loadedWorkspace, setLoadedWorkspace] = useState<string | null>(null)
  const [pending, setPending] = useState<PermissionRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setRules([])
    setLoadedWorkspace(null)
    setPending(null)
    setError(null)
    fetchPermissionRules().then(result => { if (active) { setRules(result.rules); setLoadedWorkspace(result.workspace) } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [workspace])

  async function remove(rule: PermissionRule): Promise<void> {
    if (!loadedWorkspace || loadedWorkspace !== workspace) { setError(t('permissions.workspaceChanged')); return }
    setBusy(true)
    try {
      await removePermissionRule(loadedWorkspace, rule)
      setRules((current) => current.filter(item => !(item.tool === rule.tool && item.target === rule.target && item.behavior === rule.behavior)))
      setPending(null)
      setError(null)
      toast.success(t('permissions.removed'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.permissions')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('permissions.hint')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {loadedWorkspace && !rules.length && !error && <p className="text-sm text-muted-foreground">{t('permissions.empty')}</p>}
        {rules.map(rule => (
          <div key={`${rule.behavior}\0${rule.tool}\0${rule.target ?? ''}`} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <Badge variant="secondary">{rule.behavior}</Badge>
            <div className="min-w-0 flex-1 break-all font-mono text-xs">
              <span>{rule.tool}</span>
              {rule.target !== undefined && <div className="text-muted-foreground">{rule.target}</div>}
            </div>
            {pending?.tool === rule.tool && pending.target === rule.target && pending.behavior === rule.behavior ? (
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove(rule)}>{t('permissions.confirm')}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending(null)}>{t('permissions.cancel')}</Button>
              </div>
            ) : <Button size="sm" variant="outline" disabled={busy} onClick={() => setPending(rule)}>{t('permissions.remove')}</Button>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function AboutPage() {
  const { t } = useI18n()
  const app = useApp()
  const license = app.info?.license ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.about')}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label={t('settings.version')}>{app.info?.version ?? '—'}</Row>
        <Row label={t('settings.license')}>
          {license ? (
            <a href={`${site.repo}/blob/HEAD/LICENSE`} className="text-primary hover:underline" target="_blank" rel="noreferrer">
              {license}
            </a>
          ) : (
            '—'
          )}
        </Row>
        <Row label={t('settings.repository')}>
          <a href={site.repo} className="text-primary hover:underline" target="_blank" rel="noreferrer">
            {site.repo.replace(/^https?:\/\//, '')}
          </a>
        </Row>
      </CardContent>
    </Card>
  )
}

export function SettingsPanel({
  page,
  onNavigate,
}: {
  page: string
  onNavigate: (page: string) => void
}) {
  const { t } = useI18n()
  const workspace = useApp().info?.workspace
  const active = PAGES.some((entry) => entry.slug === page) ? page : 'general'

  const content =
    active === 'projects' ? (
      <ProjectsPage />
    ) :     active === 'providers' ? (
      <ProvidersPage />
    ) : active === 'oauth' ? (
      <OAuthPage />
    ) : active === 'usage' ? (
      <UsagePage />
    ) : active === 'connectors' ? (
      <ConnectorsPage key={workspace} />
    ) : active === 'skills' ? (
      <SkillsPage key={workspace} />
    ) : active === 'permissions' ? (
      <PermissionsPage />
    ) : active === 'about' ? (
      <AboutPage />
    ) : (
      <GeneralPage />
    )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col sm:flex-row">
      <nav aria-label={t('settings.title')} className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 pr-12 sm:w-44 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:border-r sm:border-b-0 sm:pr-2">
        {PAGES.map((entry) => (
          <Button
            key={entry.slug}
            variant="ghost"
            size="sm"
            aria-current={active === entry.slug ? 'page' : undefined}
            className={cn('shrink-0 justify-start', active === entry.slug && 'bg-accent text-accent-foreground')}
            onClick={() => onNavigate(entry.slug)}
          >
            {t(entry.label)}
          </Button>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b px-4 text-sm font-medium">
          {t('settings.title')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto w-full max-w-4xl">{content}</div>
        </div>
      </div>
    </div>
  )
}
