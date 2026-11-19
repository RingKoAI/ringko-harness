import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DiscoveredProviderModel } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/i18n'

/**
 * New models up to this count start checked. A short curated list is almost
 * always wanted whole, while a long directory would arrive almost fully
 * unselected; this keeps the common case one click away.
 */
const PRESELECT_LIMIT = 6

/**
 * Floating picker over the models an endpoint just reported. It only adds:
 * rows already configured are shown disabled so the dialog never hides what
 * the provider returned, but removing a model stays a decision for the list
 * behind the dialog.
 *
 * The dialog sits above the settings dialog that normally opens it, so its
 * overlay and surface carry a higher layer than the default one; equal layers
 * would let whichever portal mounted last paint over the picker.
 */
export function FetchedModelPicker({
  discovered,
  existingIds,
  onAddSelected,
  onClose,
}: {
  discovered: readonly DiscoveredProviderModel[]
  existingIds: ReadonlySet<string>
  onAddSelected: (models: DiscoveredProviderModel[]) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    const fresh = discovered.filter(item => item.id && !existingIds.has(item.id))
    if (fresh.length > 0 && fresh.length <= PRESELECT_LIMIT) {
      for (const item of fresh) initial.add(item.id)
    }
    return initial
  })

  const selectable = useMemo(
    () => discovered.filter(item => item.id && !existingIds.has(item.id)),
    [discovered, existingIds],
  )

  function toggleOne(id: string, checked: boolean): void {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function selectAll(): void {
    setSelected(new Set(selectable.map(item => item.id)))
  }

  function commit(): void {
    const chosen = discovered.filter(item => selected.has(item.id) && !existingIds.has(item.id))
    if (chosen.length === 0) return
    onAddSelected(chosen)
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[60]"
        className="z-[60] flex w-[30rem] max-w-[calc(100%-2rem)]! flex-col gap-0 p-0 sm:max-w-[30rem]!"
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">
            {t('providers.pickerTitle', { count: discovered.length })}
          </DialogTitle>
        </DialogHeader>

        <div className="p-3">
          <div className="overflow-hidden rounded-lg border">
            <ScrollArea className="max-h-[min(55dvh,24rem)] [&_[data-slot=scroll-area-viewport]]:max-h-[min(55dvh,24rem)]">
              <div className="divide-y">
                {discovered.map(item => {
                  const already = existingIds.has(item.id)
                  const isChecked = already || selected.has(item.id)
                  return (
                    <label
                      key={item.id}
                      className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${
                        already ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          checked={isChecked}
                          disabled={already}
                          onCheckedChange={value => toggleOne(item.id, value === true)}
                        />
                        <span className="truncate font-mono">{item.id}</span>
                        {item.name && item.name !== item.id ? (
                          <span className="truncate text-muted-foreground">({item.name})</span>
                        ) : null}
                      </div>
                      {already ? (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {t('providers.pickerAlreadyAdded')}
                        </Badge>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t px-3 py-3 sm:justify-between">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              {t('providers.pickerDeselectAll')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectable.length === 0}
              onClick={selectAll}
            >
              {t('providers.pickerSelectAll')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" disabled={selected.size === 0} onClick={commit}>
              <Check data-icon="inline-start" className="size-3.5" />
              {t('providers.pickerConfirm', { count: selected.size })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
