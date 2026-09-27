import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { messages, type Locale, type MessageKey } from './messages'

export { LOCALES, type Locale, type MessageKey } from './messages'

const STORAGE_KEY = 'ringko.locale'

type Params = Record<string, string | number>

export interface I18n {
  locale: Locale
  setLocale(locale: Locale): void
  t(key: MessageKey, params?: Params): string
}

const I18nContext = createContext<I18n | null>(null)

function detectLocale(): Locale {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'zh-CN') return stored
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage may be unavailable; keep the in-memory locale.
    }
  }, [])

  const t = useCallback(
    (key: MessageKey, params?: Params) => {
      let text = messages[locale][key] ?? messages.en[key] ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, String(value))
        }
      }
      return text
    },
    [locale],
  )

  const value = useMemo<I18n>(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within an I18nProvider')
  return context
}
