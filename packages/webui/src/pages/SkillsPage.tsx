import { Plus, Trash2 } from 'lucide-react'
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

  const load = useCallback(() => {
    fetchSkills()
      .then(setSkills)
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
    try {
      setSkills(await removeSkill(dir))
      toast.success(t('skills.removed'))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.skills')}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{t('skills.hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border p-3">
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
        </div>

        {skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('skills.empty')}</p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
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
                <Button size="icon" variant="ghost" onClick={() => void remove(skill.dir)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
