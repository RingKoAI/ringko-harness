import { Check, FolderPlus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  addProject,
  fetchProjects,
  removeProject,
  setCurrentProject,
  type ProjectsResponse,
} from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

export function ProjectsPage() {
  const { t } = useI18n()
  const app = useApp()
  const [data, setData] = useState<ProjectsResponse | null>(null)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchProjects()
      .then(setData)
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: () => Promise<ProjectsResponse>, message: string): Promise<void> {
    setBusy(true)
    try {
      setData(await action())
      app.refreshInfo()
      app.refreshSessions()
      toast.success(message)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function add(): Promise<void> {
    const value = path.trim()
    if (value.length === 0) return
    await run(() => addProject(value, name.trim() || undefined), t('projects.added'))
    setPath('')
    setName('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.projects')}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{t('projects.hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t('projects.path')}
            className="flex-1 font-mono text-xs"
          />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('projects.name')}
            className="sm:w-40"
          />
          <Button onClick={() => void add()} disabled={busy || path.trim().length === 0}>
            <FolderPlus data-icon="inline-start" />
            {t('projects.add')}
          </Button>
        </div>

        {!data || data.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('projects.empty')}</p>
        ) : (
          <div className="space-y-2">
            {data.projects.map((project) => (
              <div key={project.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{project.name}</span>
                    {data.current === project.id ? <Badge>{t('projects.current')}</Badge> : null}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{project.path}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {data.current === project.id ? (
                    <Check className="size-4 text-primary" />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => setCurrentProject(project.id), t('projects.switched'))}
                    >
                      {t('projects.use')}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => removeProject(project.id), t('projects.removed'))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
