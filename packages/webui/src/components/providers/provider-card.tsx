import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GripVertical,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useRef } from 'react'
import type { ProviderCredentialStatus } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import type { EditableProvider } from '@/lib/model-settings'
import { isOAuthProviderType } from '@/lib/oauth'
import { cn } from '@/lib/utils'

function vendorMonogram(name: string, type?: string): { text: string; tone: string } {
  const lower = `${name} ${type ?? ''}`.toLowerCase()
  if (lower.includes('anthropic') || lower.includes('claude')) {
    return { text: 'AN', tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' }
  }
  if (lower.includes('openai') || lower.includes('codex')) {
    return { text: 'OA', tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
  }
  if (lower.includes('google') || lower.includes('gemini')) {
    return { text: 'GG', tone: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' }
  }
  if (lower.includes('deepseek')) {
    return { text: 'DS', tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' }
  }
  if (lower.includes('openrouter')) {
    return { text: 'OR', tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30' }
  }
  if (lower.includes('siliconflow')) {
    return { text: 'SF', tone: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' }
  }
  const letters = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'PR'
  return { text: letters, tone: 'bg-muted text-foreground border-border' }
}

export function ProviderCard({
  provider,
  credentialStatus,
  isBuiltin,
  isActiveProvider,
  canMoveUp,
  canMoveDown,
  testing,
  latencyMs,
  disabled,
  dragging = false,
  dropIndicator,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onEdit,
  onDuplicate,
  onTest,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  provider: EditableProvider
  credentialStatus?: ProviderCredentialStatus
  isBuiltin: boolean
  isActiveProvider: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  testing: boolean
  latencyMs?: number | 'error'
  disabled?: boolean
  /** This card is the one currently being dragged. */
  dragging?: boolean
  /** Where the dragged card would land relative to this one. */
  dropIndicator?: 'before' | 'after'
  onDragStart: () => void
  onDragOver: (after: boolean) => void
  onDragEnd: () => void
  onDrop: () => void
  onEdit: () => void
  onDuplicate: () => void
  onTest: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const cardRef = useRef<HTMLDivElement>(null)

  const isEnabled = provider.enabled !== false

  const isOAuth = isOAuthProviderType(provider.type ?? provider.vendor)
  const models = (provider.models ?? []).filter(m => m.id.trim().length > 0)
  const avatar = vendorMonogram(provider.presetId ?? provider.name, provider.type ?? provider.vendor)

  function renderCredentialLabel(): string {
    if (!credentialStatus) {
      return provider.apiKey?.trim() ? t('providers.keyConfigured') : t('providers.keyEnvOrEmpty')
    }
    if (credentialStatus.source === 'auth') {
      return credentialStatus.keyCount > 1
        ? t('providers.credAuthMulti', { count: credentialStatus.keyCount })
        : t('providers.credAuth')
    }
    if (credentialStatus.source === 'env' && credentialStatus.envVar) {
      return t('providers.credEnv', { env: credentialStatus.envVar })
    }
    if (credentialStatus.source === 'local') {
      return t('providers.credLocal')
    }
    if (credentialStatus.source === 'inline') {
      return t('providers.keyConfigured')
    }
    return t('providers.credMissing')
  }

  return (
    <div
      ref={cardRef}
      data-active-provider={isActiveProvider ? 'true' : undefined}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        onDragOver(event.clientY > rect.top + rect.height / 2)
      }}
      onDrop={event => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card p-3.5 transition-all',
        dragging && 'opacity-50',
        !isEnabled && 'opacity-65',
        isActiveProvider && isEnabled
          ? 'border-primary/60 shadow-xs'
          : 'hover:border-foreground/20',
      )}
    >
      {dropIndicator === 'before' ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-primary" />
      ) : null}
      {dropIndicator === 'after' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-primary" />
      ) : null}
      {isActiveProvider && isEnabled ? (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/[0.06] via-transparent to-transparent" />
      ) : null}

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            type="button"
            draggable={!disabled}
            aria-label={t('providers.dragToReorder')}
            title={t('providers.dragToReorder')}
            disabled={disabled}
            onDragStart={event => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', provider.name)
              if (cardRef.current) event.dataTransfer.setDragImage(cardRef.current, 24, 24)
              onDragStart()
            }}
            className={cn(
              'mt-1 flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground',
              'hover:bg-muted hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <GripVertical className="size-4" />
          </button>
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-semibold',
              avatar.tone,
            )}
          >
            {avatar.text}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{provider.name}</span>
              {!isEnabled ? (
                <Badge variant="outline" className="h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                  {t('providers.disabled')}
                </Badge>
              ) : isActiveProvider ? (
                <Badge variant="default" className="h-5 gap-1 px-1.5 text-[10px]">
                  <Check className="size-3" />
                  {t('providers.active')}
                </Badge>
              ) : null}
              <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                {isOAuth ? 'OAuth' : provider.type || 'openai-compatible'}
              </Badge>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {t('settings.providerModels', { count: models.length })}
              </Badge>
              {typeof latencyMs === 'number' ? (
                <Badge
                  variant="outline"
                  className="h-5 border-emerald-500/40 bg-emerald-500/10 px-1.5 font-mono text-[10px] text-emerald-600 dark:text-emerald-400"
                >
                  {latencyMs} ms
                </Badge>
              ) : latencyMs === 'error' ? (
                <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                  !
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {provider.baseURL ? (
                <span className="max-w-full truncate font-mono">{provider.baseURL}</span>
              ) : null}
              {!isOAuth ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1',
                    credentialStatus?.configured && 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  <KeyRound className="size-3" />
                  {renderCredentialLabel()}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">

          {!isOAuth ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || testing}
              title={t('providers.test')}
              aria-label={t('providers.test')}
              onClick={onTest}
            >
              {testing ? <LoaderCircle className="size-4 animate-spin" /> : <Activity className="size-4" />}
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil data-icon="inline-start" className="size-3.5" />
            {t('providers.edit')}
          </Button>

          {!isOAuth ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="size-3.5" />
                  {t('providers.duplicate')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
                  <ArrowUp className="size-3.5" />
                  {t('providers.moveUp')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
                  <ArrowDown className="size-3.5" />
                  {t('providers.moveDown')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  {isBuiltin ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
                  {isBuiltin ? t('providers.resetBuiltin') : t('settings.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </div>
  )
}
