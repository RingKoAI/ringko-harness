import { useTheme } from 'next-themes'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { setModel } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LOCALES, useI18n, type Locale, type MessageKey } from '@/i18n'
import { ConnectorsPage } from '@/pages/ConnectorsPage'
import { OAuthPage } from '@/pages/OAuthPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { ProvidersPage } from '@/pages/ProvidersPage'
import { SkillsPage } from '@/pages/SkillsPage'
import { useApp } from '@/store'
import { site } from '@/site'
import { cn } from '@/lib/utils'

const PAGES: { slug: string; label: MessageKey }[] = [
  { slug: 'general', label: 'settings.general' },
  { slug: 'projects', label: 'settings.projects' },
  { slug: 'providers', label: 'settings.providers' },
  { slug: 'oauth', label: 'settings.oauth' },
  { slug: 'models', label: 'settings.models' },
  { slug: 'connectors', label: 'settings.connectors' },
  { slug: 'skills', label: 'settings.skills' },
  { slug: 'about', label: 'settings.about' },
]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
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
          <span className="font-mono text-xs">{app.info?.workspace ?? '—'}</span>
        </Row>
        <Row label={t('settings.access')}>{app.info?.access.label ?? '—'}</Row>
        <Row label={t('settings.authRequired')}>
          <Badge variant={app.info?.auth.required ? 'default' : 'secondary'}>
            {app.info?.auth.required ? t('settings.authOn') : t('settings.authOff')}
          </Badge>
        </Row>
        <Row label={t('theme.toggle')}>
          <div className="flex gap-2">
            {themes.map((entry) => (
              <Button
                key={entry.value}
                size="sm"
                variant={theme === entry.value ? 'default' : 'outline'}
                onClick={() => setTheme(entry.value)}
              >
                {t(entry.label)}
              </Button>
            ))}
          </div>
        </Row>
        <Row label={t('language.toggle')}>
          <div className="flex gap-2">
            {LOCALES.map((entry) => (
              <Button
                key={entry.value}
                size="sm"
                variant={locale === entry.value ? 'default' : 'outline'}
                onClick={() => setLocale(entry.value as Locale)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </Row>
      </CardContent>
    </Card>
  )
}

function ModelsPage() {
  const { t } = useI18n()
  const app = useApp()
  const providers = app.info?.providers ?? []
  const current = app.info?.modelId ?? ''

  function choose(value: string): void {
    if (value === current) return
    setModel(value)
      .then(() => {
        app.refreshInfo()
        toast.success(t('model.switched'))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.models')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.noProviders')}</p>
        ) : (
          providers.map((provider) => (
            <div key={provider.name} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{provider.name}</span>
                <Badge variant="secondary">{provider.type ?? '—'}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {provider.models.map((id) => {
                  const value = `${provider.name}/${id}`
                  const active = value === current
                  return (
                    <Button
                      key={value}
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      className="font-mono text-xs"
                      onClick={() => choose(value)}
                    >
                      {id}
                    </Button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function AboutPage() {
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.about')}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        <Row label={t('settings.version')}>{site.version}</Row>
        <Row label={t('nav.settings')}>
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
  const active = PAGES.some((entry) => entry.slug === page) ? page : 'general'

  const content =
    active === 'projects' ? (
      <ProjectsPage />
    ) :     active === 'providers' ? (
      <ProvidersPage />
    ) : active === 'oauth' ? (
      <OAuthPage />
    ) : active === 'models' ? (
      <ModelsPage />
    ) : active === 'connectors' ? (
      <ConnectorsPage />
    ) : active === 'skills' ? (
      <SkillsPage />
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
