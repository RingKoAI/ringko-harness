import { LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createSkill, fetchSkills, removeSkill, type SkillEntry } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'

export function SkillsPage() {
  const { t } = useI18n()
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      setSkills(await fetchSkills())
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function create(): Promise<void> {
    const value = name.trim()
    if (value.length === 0) return
    setBusy(true)
    try {
      const next = await createSkill({
        name: value,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        ...(body.length > 0 ? { body } : {}),
      })
      setSkills(next)
      setName('')
      setDescription('')
      setBody('')
      toast.success(t('skills.created'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function remove(dir: string): Promise<void> {
    setBusy(true)
    try {
      setSkills(await removeSkill(dir))
      toast.success(t('skills.removed'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function section(scope: 'project' | 'global'): React.ReactNode {
    const list = skills.filter((skill) => skill.scope === scope)
    return (
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <CardTitle className="text-sm">{t(scope === 'project' ? 'skills.project' : 'skills.global')}</CardTitle>
          <Badge variant="outline">{list.length}</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && skills.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {t('skills.loading')}
            </p>
          ) : loadError && skills.length === 0 ? (
            <p className="text-xs text-destructive">{t('skills.loadFailed')}</p>
          ) : list.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('skills.empty')}</p>
          ) : (
            list.map((skill) => (
              <div key={skill.dir} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{skill.name}</span>
                    <Badge variant="outline">{skill.source}</Badge>
                  </div>
                  {skill.description ? (
                    <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                  ) : null}
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{skill.dir}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => void remove(skill.dir)} disabled={busy}>
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('settings.skills')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('skills.hint')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} data-icon="inline-start" />
          {t('workspace.refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('skills.create')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('skills.name')} />
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('skills.description')}
          />
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('skills.body')}
            className="min-h-24 font-mono text-xs"
          />
          <Button size="sm" onClick={() => void create()} disabled={busy || name.trim().length === 0}>
            <Plus data-icon="inline-start" />
            {t('skills.create')}
          </Button>
        </CardContent>
      </Card>

      {section('project')}
      {section('global')}
    </div>
  )
}
