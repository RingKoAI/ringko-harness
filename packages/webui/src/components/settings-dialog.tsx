import { useState, type ReactNode } from 'react'
import { SettingsPanel } from '@/components/settings-panel'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'

export function SettingsDialog({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState('general')
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="h-[min(52rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)]! max-w-[72rem]! gap-0 overflow-hidden p-0 sm:max-w-[72rem]!">
        <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
        <SettingsPanel page={page} onNavigate={setPage} />
      </DialogContent>
    </Dialog>
  )
}
