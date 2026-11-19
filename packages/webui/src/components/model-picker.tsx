import { Check, ChevronsUpDown, Cpu, Heart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { setModel, setUi } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useApp } from '@/store'

type ProviderFilter = '__all__' | '__favorites__' | string

export function ModelPicker() {
  const { t } = useI18n()
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ProviderFilter>('__all__')

  const providers = useMemo(() => app.info?.providers ?? [], [app.info?.providers])
  const currentId = app.info?.modelId ?? ''
  const favorites = useMemo(() => app.info?.favoriteModels ?? [], [app.info?.favoriteModels])
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])

  const validModelSet = useMemo(() => {
    const all = new Set<string>()
    for (const provider of providers) {
      for (const id of provider.models) {
        all.add(`${provider.name}/${id}`)
      }
    }
    return all
  }, [providers])

  const activeFavorites = useMemo(
    () => favorites.filter(fullId => validModelSet.has(fullId)),
    [favorites, validModelSet],
  )

  const query = search.trim().toLowerCase()

  const filteredProviders = useMemo(() => {
    return providers
      .filter(provider => {
        if (filter === '__all__' || filter === '__favorites__') return true
        return provider.name === filter
      })
      .map(provider => ({
        ...provider,
        models: provider.models.filter(id => {
          const fullId = `${provider.name}/${id}`
          if (filter === '__favorites__' && !favoriteSet.has(fullId)) return false
          if (!query) return true
          return id.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query)
        }),
      }))
      .filter(provider => provider.models.length > 0)
  }, [providers, filter, favoriteSet, query])

  const pinnedInAllTab = useMemo(() => {
    if (filter !== '__all__') return []
    return activeFavorites.filter(fullId => !query || fullId.toLowerCase().includes(query))
  }, [filter, activeFavorites, query])

  function choose(value: string): void {
    setOpen(false)
    if (value === currentId) return
    setModel(value)
      .then(() => {
        app.refreshInfo()
        toast.success(t('model.switched'))
      })
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  function toggleFavorite(event: React.MouseEvent, fullId: string): void {
    event.preventDefault()
    event.stopPropagation()
    const next = favoriteSet.has(fullId)
      ? favorites.filter(item => item !== fullId)
      : [...favorites, fullId]
    setUi({ favoriteModels: next })
      .then(() => app.refreshInfo())
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }

  return (
    <Popover
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-56 gap-1.5 text-muted-foreground" title={t('model.select')}>
          <Cpu className="size-3.5 shrink-0" />
          <span className="truncate">{app.info?.model ?? t('header.noModel')}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('model.search')} />

          {providers.length > 0 ? (
            <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
              <button
                type="button"
                onClick={() => setFilter('__favorites__')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  filter === '__favorites__'
                    ? 'border-primary bg-primary/15 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <Heart className={cn('size-2.5', activeFavorites.length > 0 && 'fill-rose-500 text-rose-500')} />
                <span>{t('model.favorites')}</span>
                {activeFavorites.length > 0 ? <span>({activeFavorites.length})</span> : null}
              </button>

              <button
                type="button"
                onClick={() => setFilter('__all__')}
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  filter === '__all__'
                    ? 'border-primary bg-primary/15 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t('model.allProviders')}
              </button>

              {providers
                .filter(p => p.models.length > 0)
                .map(provider => (
                  <button
                    key={provider.name}
                    type="button"
                    onClick={() => setFilter(provider.name)}
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors',
                      filter === provider.name
                        ? 'border-primary bg-primary/15 font-medium text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {provider.name}
                  </button>
                ))}
            </div>
          ) : null}

          <CommandList>
            <CommandEmpty>
              {providers.length === 0
                ? t('model.empty')
                : filter === '__favorites__' && activeFavorites.length === 0
                  ? t('model.noFavorites')
                  : t('model.noMatches')}
            </CommandEmpty>

            {pinnedInAllTab.length > 0 ? (
              <CommandGroup heading={`♥ ${t('model.favorites')}`}>
                {pinnedInAllTab.map(fullId => (
                  <CommandItem key={`fav-${fullId}`} value={`fav-${fullId}`} onSelect={() => choose(fullId)}>
                    <span className="truncate font-mono text-xs">{fullId}</span>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      {fullId === currentId ? <Check className="size-3.5" /> : null}
                      <button
                        type="button"
                        aria-label={t('model.unpinFavorite')}
                        title={t('model.unpinFavorite')}
                        onClick={event => toggleFavorite(event, fullId)}
                        className="rounded p-0.5 text-rose-500 hover:bg-accent"
                      >
                        <Heart className="size-3 fill-rose-500" />
                      </button>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {filteredProviders.map(provider => (
              <CommandGroup key={provider.name} heading={provider.name}>
                {provider.models.map(id => {
                  const value = `${provider.name}/${id}`
                  const isFav = favoriteSet.has(value)
                  return (
                    <CommandItem key={value} value={value} onSelect={() => choose(value)}>
                      <span className="truncate font-mono text-xs">{id}</span>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {value === currentId ? <Check className="size-3.5" /> : null}
                        <button
                          type="button"
                          aria-label={isFav ? t('model.unpinFavorite') : t('model.pinFavorite')}
                          title={isFav ? t('model.unpinFavorite') : t('model.pinFavorite')}
                          onClick={event => toggleFavorite(event, value)}
                          className={cn(
                            'rounded p-0.5 transition-opacity hover:bg-accent',
                            isFav ? 'text-rose-500 opacity-100' : 'text-muted-foreground opacity-50 hover:opacity-100',
                          )}
                        >
                          <Heart className={cn('size-3', isFav && 'fill-rose-500')} />
                        </button>
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
