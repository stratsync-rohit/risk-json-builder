'use client'

import { useState } from 'react'
import { AlertTriangle, ListChecks, Radio } from 'lucide-react'
import type { Risk, RiskMetric } from '@/types/risk'

const severityBadge: Record<string, string> = {
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  high: 'border-red-200 bg-red-50 text-red-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
}

function textValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function metricValue(metric: RiskMetric) {
  const value = textValue(metric.value)
  return value || textValue(metric.raw_value) || '—'
}

function severityLabel(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : 'Risk'
}

function ReplyThread({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>
}

function ReplyLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Reply • {children}</p>
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 mt-5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 first:mt-0">{children}</h3>
}

function ActionButton({ children, active = false, onClick, expanded, title }: { children: React.ReactNode; active?: boolean; onClick?: () => void; expanded?: boolean; title?: string }) {
  return <button type="button" aria-expanded={expanded} title={title} onClick={onClick} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${active ? 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100' : 'border-slate-300 bg-white text-slate-700'}`}>{children}</button>
}

function Metrics({ metrics }: { metrics: RiskMetric[] }) {
  if (!metrics.length) return null
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {metrics.map((metric, index) => <div key={`${textValue(metric.key) || 'metric'}-${index}`} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{textValue(metric.label) || 'Metric'}</p>
      <p className={`mt-1 break-words text-[17px] font-bold leading-5 ${metric.highlight && metric.type === 'currency' ? 'text-red-600' : 'text-slate-900'}`}>{metricValue(metric)}</p>
    </div>)}
  </div>
}

export function Preview({ risk }: { risk: Risk }) {
  const [showDetails, setShowDetails] = useState(false)
  const [showMitigation, setShowMitigation] = useState(false)
  const metrics = Array.isArray(risk.metrics) ? risk.metrics.filter(isRecord) as RiskMetric[] : []
  const mitigation = Array.isArray(risk.mitigation) ? risk.mitigation.filter(isRecord) as Risk['mitigation'] : []
  const impact = Array.isArray(risk.impact) ? risk.impact.filter(item => textValue(item)) : []
  const details = isRecord(risk.details) ? risk.details : null
  const sections = Array.isArray(details?.sections) ? details.sections.filter(isRecord).map(section => ({ key: textValue(section.key), title: textValue(section.title), items: Array.isArray(section.items) ? section.items.filter(item => textValue(item)) : [] })).filter(section => section.title || section.items.length > 0) : []
  const sender = textValue(risk.sender?.name) || 'StratSync RRM'
  const timestamp = textValue(risk.detected_time)
  const updated = textValue(risk.updated_at) || timestamp

  return <div className="min-w-0 rounded-lg bg-slate-50/80 p-3 sm:p-4 lg:p-5">
    <div className="flex flex-col gap-3">
      <article className="relative overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-1 size-[18px] shrink-0 text-red-500" />
              <div className="min-w-0">
                <h2 className="break-words text-[19px] font-bold leading-6 tracking-[-0.01em] text-slate-950 sm:text-[21px]">{textValue(risk.title) || 'Risk notification'}</h2>
                {textValue(risk.subtitle) && <p className="mt-1 break-words text-[13px] leading-5 text-slate-500">{textValue(risk.subtitle)}</p>}
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${severityBadge[risk.severity] || severityBadge.high}`}>{severityLabel(textValue(risk.severity))}</span>
          </div>

          {textValue(risk.summary) && <p className="mt-5 break-words text-[13px] leading-5 text-slate-700"><span className="font-bold text-slate-900">Summary.</span>{' '}{textValue(risk.summary)}</p>}

          <div className="mt-5">
            <Metrics metrics={metrics} />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <ActionButton active={showDetails} expanded={showDetails} onClick={() => setShowDetails(value => { const next = !value; if (next) setShowMitigation(false); return next })}><AlertTriangle className="size-3.5 text-red-500" />View Details</ActionButton>
            <ActionButton active={showMitigation} expanded={showMitigation} onClick={() => setShowMitigation(value => { const next = !value; if (next) setShowDetails(false); return next })}><ListChecks className="size-3.5" />Mitigation Plan</ActionButton>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500 sm:px-5">
          <div className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full bg-violet-500" /><span className="truncate font-semibold text-slate-600">{sender}</span><span className="truncate">Risk ID {textValue(risk.risk_id) || '—'}</span></div>
          <span className="shrink-0">Detected {timestamp || '—'}</span>
        </div>
      </article>

      {showDetails && <ReplyThread>
        <article className="rounded-[10px] border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="p-4 sm:p-5">
            <ReplyLabel>Risk Details</ReplyLabel>
            {sections.map((section, sectionIndex) => <section key={`${section.key}-${sectionIndex}`} className={sectionIndex > 0 ? 'mt-5' : ''}><SectionHeading>{section.title || 'Risk details'}</SectionHeading>{section.items.length > 0 && <ul className="space-y-2 text-[13px] leading-5 text-slate-700">{section.items.map((item, itemIndex) => <li key={`${section.key}-${itemIndex}`} className="flex items-start gap-3"><span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-500" /><span>{textValue(item)}</span></li>)}</ul>}</section>)}
            {impact.length > 0 && <>
              <SectionHeading>Impact</SectionHeading>
              <ul className="space-y-2 text-[13px] leading-5 text-slate-700">{impact.map((item, index) => <li key={`${textValue(item)}-${index}`} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-red-400" />{textValue(item)}</li>)}</ul>
            </>}
          </div>
        </article>
      </ReplyThread>}

      {showMitigation && <ReplyThread>
        <article className="rounded-[10px] border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <div className="p-4 sm:p-5">
            <ReplyLabel>Mitigation Plan</ReplyLabel>
            <h2 className="text-[18px] font-bold text-slate-950">Mitigation Plan</h2>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">Recommended actions to reduce the risk and protect impacted customers.</p>
            {mitigation.length > 0 && <div className="mt-5 divide-y divide-slate-100">{mitigation.map((step, index) => <div key={`${textValue(step.title) || 'step'}-${index}`} className="flex gap-3 py-3 first:pt-0 last:pb-0"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-[10px] font-bold text-violet-700">{textValue(step.step) || index + 1}</span><div className="min-w-0"><p className="break-words text-[13px] font-bold text-slate-900">{textValue(step.title) || 'Untitled step'}</p>{textValue(step.description) && <p className="mt-0.5 break-words text-[12px] leading-5 text-slate-600">{textValue(step.description)}</p>}<p className="mt-1 text-[11px] text-slate-400">Owner: {textValue(step.owner) || 'Unassigned'}</p></div></div>)}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-5"><span className="text-[11px] text-slate-400">Last updated: {updated || textValue(risk.created_at) || '—'}</span><button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-violet-600 px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"><Radio className="size-3.5" />Open in Command Center</button></div>
        </article>
      </ReplyThread>}
    </div>
  </div>
}
