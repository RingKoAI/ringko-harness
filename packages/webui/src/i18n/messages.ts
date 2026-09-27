import { en, type MessageKey } from './en'
import { zhCN } from './zh-CN'

export type Locale = 'en' | 'zh-CN'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
]

export const messages: Record<Locale, Record<MessageKey, string>> = {
  en,
  'zh-CN': zhCN,
}

export type { MessageKey }
