import { Check, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, SlidersHorizontal, Zap } from 'lucide-react'
import { useState } from 'react'
import type { ProviderCredentialStatus, ProviderPreset } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { countEnteredKeys } from '@/lib/provider-workbench'
import { cn } from '@/lib/utils'

function presetAvatar(id: string): { text: string; tone: string } {
  const lower = id.toLowerCase()
  if (lower === 'anthropic') return { text: 'AN', tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
  if (lower === 'openai') return { text: 'OA', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  if (lower === 'google') return { text: 'GG', tone: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' }
  if (lower === 'deepseek') return { text: 'DS', tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' }
  if (lower === 'openrouter') return { text: 'OR', tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30' }
  if (lower === 'siliconflow') return { text: 'SF', tone: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' }
  const code = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'PR'
  return { text: code, tone: 'bg-muted text-foreground border-border' }
}

export function BuiltinPresetCard({
  preset,
  credential,
  busy,
  onQuickActivate,
  onOpenFullEditor,
}: {
  preset: ProviderPreset
  credential?: ProviderCredentialStatus
  busy: boolean
  onQuickActivate: (preset: ProviderPreset, rawApiKey?: string) => Promise<boolean>
  onOpenFullEditor: (preset: ProviderPreset, rawApiKey?: string) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [showKey, setShowKey] = useState(false)

  const envReady = Boolean(credential?.envDetected && credential.envVar)
  const isLocal = credential?.source === 'local'
  const storedAuthReady = credential?.source === 'auth'
  const instantReady = envReady || isLocal || storedAuthReady
  const avatar = presetAvatar(preset.id)
  const enteredCount = countEnteredKeys(apiKeyDraft)
  const starterNames = (preset.defaultModels ?? []).map(m => m.id).join(', ')

  async function handleSubmitQuick(): Promise<void> {
    const ok = await onQuickActivate(preset, apiKeyDraft)
    if (ok) {
      setApiKeyDraft('')
      setExpanded(false)
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-card/70 p-3 transition-all',
        instantReady ? 'border-emerald-500/40 bg-emerald-500/[0.03]' : 'hover:border-foreground/20',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-semibold',
              avatar.tone,
            )}
          >
            {avatar.text}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium">{preset.label}</span>
              <Badge variant="outline" className="h-4.5 px-1.5 font-mono text-[10px]">
                {preset.type}
              </Badge>
              {envReady && credential?.envVar ? (
                <Badge
                  variant="outline"
                  className="h-4.5 border-emerald-500/40 bg-emerald-500/10 px-1.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400"
                >
                  <Check className="mr-0.5 size-2.5" />
                  {t('providers.credEnv', { env: credential.envVar })}
                </Badge>
              ) : isLocal ? (
                <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">
                  {t('providers.credLocal')}
                </Badge>
              ) : storedAuthReady ? (
                <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">
                  {t('providers.credAuth')}
                </Badge>
              ) : null}
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {preset.baseURL ?? preset.defaultBaseURL ?? preset.id}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {instantReady && !expanded ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void onQuickActivate(preset)}
              >
                <Zap data-icon="inline-start" className="size-3.5" />
                {envReady && credential?.envVar
                  ? t('providers.quickSetupEnv', { env: credential.envVar })
                  : t('providers.quickActivateNow')}
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                title={t('providers.quickOpenFull')}
                aria-label={t('providers.quickOpenFull')}
                onClick={() => setExpanded(true)}
              >
                <KeyRound className="size-3.5" />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant={expanded ? 'secondary' : 'outline'}
              disabled={busy}
              onClick={() => setExpanded(prev => !prev)}
            >
              <KeyRound data-icon="inline-start" className="size-3.5" />
              {t('providers.quickSetup')}
            </Button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-2.5 border-t pt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                value={apiKeyDraft}
                onChange={event => setApiKeyDraft(event.target.value)}
                placeholder={t('providers.quickKeyPlaceholder')}
                className="h-8 pr-8 font-mono text-xs"
                onKeyDown={event => {
                  if (event.key === 'Enter' && (enteredCount > 0 || instantReady)) {
                    event.preventDefault()
                    void handleSubmitQuick()
                  }
                }}
              />
              {apiKeyDraft ? (
                <button
                  type="button"
                  onClick={() => setShowKey(prev => !prev)}
                  aria-label={showKey ? t('providers.hideKey') : t('providers.showKey')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={busy || (!instantReady && enteredCount === 0)}
                onClick={() => void handleSubmitQuick()}
              >
                {busy ? (
                  <LoaderCircle data-icon="inline-start" className="size-3.5 animate-spin" />
                ) : (
                  <Zap data-icon="inline-start" className="size-3.5" />
                )}
                {t('providers.quickActivateNow')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenFullEditor(preset, apiKeyDraft)}
              >
                <SlidersHorizontal data-icon="inline-start" className="size-3.5" />
                {t('providers.quickOpenFull')}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2">
              {enteredCount > 1 ? (
                <Badge variant="secondary" className="text-[10px]">
                  {t('providers.multiKeyDetected', { count: enteredCount })}
                </Badge>
              ) : null}
              {starterNames ? (
                <span>{t('providers.quickStarterHint', { models: starterNames })}</span>
              ) : null}
            </div>

            {(preset.apiKeyUrl ?? preset.docs) ? (
              <a
                href={preset.apiKeyUrl ?? preset.docs}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {t('providers.getApiKey')}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
