import { Check, ChevronsUpDown, Cpu } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { setModel } from '@/api'
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
import { useApp } from '@/store'

export function ModelPicker() {
  const { t } = useI18n()
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const providers = app.info?.providers ?? []
  const currentId = app.info?.modelId ?? ''
  const query = search.trim().toLowerCase()
  const filteredProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((id) =>
        query.length === 0 ||
        id.toLowerCase().includes(query) ||
        provider.name.toLowerCase().includes(query),
      ),
    }))
    .filter((provider) => provider.models.length > 0)

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

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
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
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('model.search')} />
          <CommandList>
            <CommandEmpty>
              {providers.length === 0 ? t('model.empty') : t('model.noMatches')}
            </CommandEmpty>
            {filteredProviders.map((provider) => (
              <CommandGroup key={provider.name} heading={provider.name}>
                {provider.models.map((id) => {
                  const value = `${provider.name}/${id}`
                  return (
                    <CommandItem key={value} value={value} onSelect={() => choose(value)}>
                      <span className="truncate font-mono text-xs">{id}</span>
                      {value === currentId ? <Check className="ml-auto size-3.5" /> : null}
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
