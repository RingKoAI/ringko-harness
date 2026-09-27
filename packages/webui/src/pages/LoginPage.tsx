import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken, verifyToken } from '@/api'
import { LanguageToggle } from '@/components/language-toggle'
import { ModeToggle } from '@/components/mode-toggle'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { useApp } from '@/store'

export function LoginPage() {
  const { t } = useI18n()
  const app = useApp()
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const required = app.info?.auth.required ?? false

  async function submit(): Promise<void> {
    const token = value.trim()
    if (token.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const ok = await verifyToken(token).catch(() => false);
    setBusy(false);
    if (!ok) {
      setError(t('login.error'));
      return;
    }
    setToken(token);
    app.refreshInfo();
    navigate('/');
  }

  return (
    <div className="grid h-svh place-items-center bg-background p-6">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageToggle />
        <ModeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('login.title')}</CardTitle>
          <CardDescription>{required ? t('login.description') : t('login.disabled')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {required ? (
            <>
              <Input
                type="password"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit()
                }}
                placeholder={t('login.token')}
                autoFocus
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <Button className="w-full" onClick={() => void submit()} disabled={busy || value.trim().length === 0}>
                {t('login.submit')}
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={() => navigate('/')}>
              {t('nav.chat')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
