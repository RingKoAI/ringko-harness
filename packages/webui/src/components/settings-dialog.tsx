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
      <DialogContent className="h-[min(34rem,calc(100vh-6rem))] w-[46rem] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 sm:max-w-[46rem]">
        <DialogTitle className="sr-only">{t('settings.title')}</DialogTitle>
        <SettingsPanel page={page} onNavigate={setPage} />
      </DialogContent>
    </Dialog>
  )
}
