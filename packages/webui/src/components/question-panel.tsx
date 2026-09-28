import { useState } from 'react'
import { useApp } from '@/store'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { QuestionRequest, QuestionOutput } from '@/api'

function Questions({ request }: { request: QuestionRequest }) {
  const app = useApp()
  const { t } = useI18n()
  const [answers, setAnswers] = useState<QuestionOutput['answers']>(request.input.questions.map(question => ({ id: question.id, selected: [] })))
  const ready = answers.every(answer => answer.selected.length > 0 || Boolean(answer.custom?.trim()))
  return <section aria-label={t('ask.title')} className="mx-auto mb-3 max-h-[50vh] max-w-3xl space-y-4 overflow-auto rounded-xl border bg-card p-4">
    <h3 className="text-sm font-semibold">{t('ask.title')}</h3>
    {request.input.questions.map((question, index) => <fieldset key={question.id} className="space-y-2">
      <legend className="text-sm font-medium">{question.header ? `${question.header} · ` : ''}{question.question}</legend>
      {question.detail ? <p className="text-xs text-muted-foreground whitespace-pre-wrap">{question.detail}</p> : null}
      {question.options?.map(option => <label key={option.label} className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm">
        <input type={question.multiSelect ? 'checkbox' : 'radio'} name={`${request.id}-${question.id}`} className="mt-1" checked={answers[index].selected.includes(option.label)} onChange={event => setAnswers(previous => previous.map((answer, at) => at !== index ? answer : { ...answer, selected: question.multiSelect ? event.target.checked ? [...answer.selected, option.label] : answer.selected.filter(value => value !== option.label) : [option.label] }))} />
        <span>{option.label}{option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}</span>
      </label>)}
      <Textarea aria-label={`${question.question} · ${t('ask.custom')}`} placeholder={t('ask.custom')} maxLength={8192} value={answers[index].custom ?? ''} onChange={event => setAnswers(previous => previous.map((answer, at) => at === index ? { ...answer, custom: event.target.value } : answer))} />
    </fieldset>)}
    <div className="flex gap-2"><Button size="sm" disabled={!ready} onClick={() => app.answer({ answers })}>{t('ask.submit')}</Button><Button size="sm" variant="outline" onClick={() => app.answer()}>{t('ask.cancel')}</Button></div>
  </section>
}
export function QuestionPanel() {
  const { question } = useApp()
  return question ? <Questions key={question.id} request={question} /> : null
}
