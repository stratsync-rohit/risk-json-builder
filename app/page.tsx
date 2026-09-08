'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import Image from 'next/image'
import { Check, ChevronDown, ChevronUp, Copy, Download, GripVertical, LogOut, Plus, RotateCcw, Save, Trash2, Upload, UserRound, X } from 'lucide-react'
import type { User } from 'firebase/auth'
import type { MitigationStep, Risk, RiskDetailSection, RiskMetric } from '@/types/risk'
import { normalizeRisk, riskSchema, sampleRisk, toJson } from '@/lib/risk-utils'
import { Preview } from '@/components/risk-preview'
import { AuthGate, useAuth } from '@/components/auth/AuthGate'

type SectionProps = { title: string; children: React.ReactNode; open?: boolean; badge?: string }
type ResizeHandleId = 'form-json' | 'json-preview'
type PanelWidths = { form: number; json: number; preview: number }
const defaultPanelWidths: PanelWidths = { form: 34, json: 28, preview: 38 }
const severityTone: Record<string, string> = { low: 'bg-emerald-50 text-emerald-700 border-emerald-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', high: 'bg-orange-50 text-orange-700 border-orange-200', critical: 'bg-red-50 text-red-700 border-red-200' }
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
const readOnlyFieldClass = '!cursor-not-allowed !border-slate-200 !bg-slate-100 !text-slate-500 shadow-none placeholder:!text-slate-400 hover:!bg-slate-100 focus:!border-slate-200 focus:!bg-slate-100 focus:outline-none focus:ring-0 disabled:!cursor-not-allowed disabled:!border-slate-200 disabled:!bg-slate-100 disabled:!text-slate-500'
const fixedSenderName = 'StratSync Risk Monitor'
const savedRiskStorageKey = 'risk-json-builder-current-risk'
const savedJsonStorageKey = 'risk-json-builder-current-json'
const savedRiskTimestampKey = 'risk-json-builder-saved-at'

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createSenderContext(title: string) {
  const cleanedTitle = title
    .trim()
    .replace(/\s+risk\s+discovered$/i, '')
    .replace(/\s+alert$/i, '')
    .trim()

  return cleanedTitle ? `${cleanedTitle} Alert` : ''
}

function formatAlertSeverity(value: string) {
  const cleaned = value
    .trim()
    .replace(/\s+severity$/i, '')
    .toLowerCase()

  if (!cleaned) return ''

  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} severity`
}

function syncAlertFromBasic(nextRisk: Risk): Risk {
  return {
    ...nextRisk,
    alert: {
      ...nextRisk.alert,
      risk_id: nextRisk.risk_id,
      sku: nextRisk.sku,
      product: nextRisk.product,
      severity: formatAlertSeverity(nextRisk.severity_label || nextRisk.severity),
      summary: nextRisk.summary,
    },
  }
}

function toMetricKey(label: string) {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function createUniqueMetricKey(label: string, metrics: RiskMetric[], currentIndex: number) {
  const baseKey = toMetricKey(label)
  if (!baseKey) return ''

  const usedKeys = new Set(metrics.filter((_, index) => index !== currentIndex).map(metric => metric.key))
  if (!usedKeys.has(baseKey)) return baseKey

  let suffix = 2
  while (usedKeys.has(`${baseKey}_${suffix}`)) suffix += 1
  return `${baseKey}_${suffix}`
}

function formatMetricDisplayValue(rawValue: unknown, type: string): string {
  if (rawValue === null || rawValue === undefined || rawValue === '') return ''

  if (type === 'currency') {
    const numberValue = Number(String(rawValue).replace(/[$,\s]/g, ''))
    if (!Number.isFinite(numberValue)) return ''
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(numberValue)
  }

  if (type === 'number') {
    const numberValue = Number(String(rawValue).replace(/[,\s]/g, ''))
    if (!Number.isFinite(numberValue)) return ''
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numberValue)
  }

  if (type === 'percentage') {
    const numberValue = Number(String(rawValue).replace(/[%\s,]/g, ''))
    if (!Number.isFinite(numberValue)) return ''
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(numberValue)}%`
  }

  return String(rawValue)
}

function normalizeMetricRawValue(rawValue: string, type: RiskMetric['type']): string | number {
  if (rawValue.trim() === '') return ''
  if (type === 'text') return rawValue

  const cleaned = rawValue.replace(type === 'currency' ? /[$,\s]/g : type === 'percentage' ? /[%\s,]/g : /[,\s]/g, '')
  const numberValue = Number(cleaned)
  return Number.isFinite(numberValue) ? numberValue : rawValue
}

function metricRawValueError(rawValue: RiskMetric['raw_value'], type: RiskMetric['type']) {
  if (rawValue === '' || type === 'text') return ''
  const cleaned = String(rawValue).replace(type === 'currency' ? /[$,\s]/g : type === 'percentage' ? /[%\s,]/g : /[,\s]/g, '')
  return Number.isFinite(Number(cleaned)) ? '' : `Enter a valid ${type} value.`
}

function toSectionKey(title: string) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function createUniqueSectionKey(title: string, sections: RiskDetailSection[], currentIndex: number) {
  const baseKey = toSectionKey(title)
  if (!baseKey) return ''
  const usedKeys = new Set(sections.filter((_, index) => index !== currentIndex).map(section => section.key))
  if (!usedKeys.has(baseKey)) return baseKey
  let suffix = 2
  while (usedKeys.has(`${baseKey}_${suffix}`)) suffix += 1
  return `${baseKey}_${suffix}`
}

function Section({ title, children, open = true, badge }: SectionProps) {
  const [expanded, setExpanded] = useState(open)
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-slate-50"><span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{title}{badge && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{badge}</span>}</span>{expanded ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}</button>{expanded && <div className="border-t border-slate-100 p-5">{children}</div>}</section>
}
function Field({ label, value, onChange, type = 'text', placeholder, readOnly = false, autoGenerated = false, fixed = false }: { label: string; value: string | number | boolean; onChange?: (v: string) => void; type?: string; placeholder?: string; readOnly?: boolean; autoGenerated?: boolean; fixed?: boolean }) { const isReadOnly = readOnly || autoGenerated || fixed; return <label className="flex flex-col gap-1.5"><span className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{autoGenerated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Auto-generated</span>}{fixed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">System-defined</span>}</span><input className={`${inputClass} ${isReadOnly ? readOnlyFieldClass : ''}`} type={type} value={String(value)} placeholder={placeholder} readOnly={isReadOnly} aria-readonly={isReadOnly ? 'true' : undefined} onChange={isReadOnly ? undefined : onChange ? e => onChange(e.target.value) : undefined} /></label> }
function SelectField({ label, value, options, onChange, disabled = false, className = '' }: { label: string; value: string; options: string[]; onChange?: (v: string) => void; disabled?: boolean; className?: string }) { return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">{label}</span><select className={`${inputClass} ${disabled ? readOnlyFieldClass : ''} ${className}`} value={value} onChange={disabled || !onChange ? undefined : e => onChange(e.target.value)} disabled={disabled} aria-disabled={disabled ? 'true' : undefined}>{options.map(o => <option key={o}>{o}</option>)}</select></label> }
function TextArea({ label, value, onChange, readOnly = false, autoGenerated = false }: { label: string; value: string; onChange?: (v: string) => void; readOnly?: boolean; autoGenerated?: boolean }) { const isReadOnly = readOnly || autoGenerated; return <label className="flex flex-col gap-1.5"><span className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{autoGenerated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Auto-generated</span>}</span><textarea className={`${inputClass} min-h-24 resize-y ${isReadOnly ? readOnlyFieldClass : ''}`} value={value} readOnly={isReadOnly} aria-readonly={isReadOnly ? 'true' : undefined} onChange={isReadOnly ? undefined : onChange ? e => onChange(e.target.value) : undefined} /></label> }
function Button({ children, onClick, primary = false, danger = false, className = '' }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; className?: string }) { return <button onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${primary ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700' : danger ? 'border-red-100 text-red-600 hover:bg-red-50' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'} ${className}`}>{children}</button> }

function ProfileMenu({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const signOut = async () => {
    setOpen(false)
    await onSignOut()
  }

  return <div ref={wrapperRef} className="relative">
    <button type="button" aria-label="User menu" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)} className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
      <UserRound className="size-4" />
    </button>
    {open && <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
      <div className="px-3 py-2">
        <p className="truncate text-sm font-semibold text-slate-900">{user.displayName || 'User'}</p>
        <p className="truncate text-xs text-slate-500">{user.email || 'No email available'}</p>
      </div>
      <div className="my-1 border-t border-slate-100" />
      <button type="button" role="menuitem" onClick={() => { void signOut() }} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">
        <LogOut className="size-3.5" />Sign out
      </button>
    </div>}
  </div>
}

function ResizeHandle({ label, active, onPointerDown, onDoubleClick, onKeyDown }: { label: string; active: boolean; onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void; onDoubleClick: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void }) {
  return <div role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} className={`group relative hidden min-h-[400px] cursor-col-resize touch-none items-stretch justify-center outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-inset xl:flex ${active ? 'bg-violet-50' : ''}`}><span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-violet-500 group-focus-visible:bg-violet-500 ${active ? 'bg-violet-500' : 'bg-slate-300'}`} /></div>
}

function parseRiskText(value: string): { risk: Risk | null; error: string } {
  try {
    return { risk: normalizeRisk(JSON.parse(value)), error: '' }
  } catch (error) {
    return { risk: null, error: error instanceof Error ? error.message : 'Invalid risk JSON' }
  }
}

function RiskJsonBuilder() {
  const { register } = useForm()
  const { user, signOut } = useAuth()
  const [risk, setRisk] = useState<Risk>(sampleRisk)
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [devMode, setDevMode] = useState(false)
  const [jsonText, setJsonText] = useState(toJson(sampleRisk))
  const [jsonError, setJsonError] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(defaultPanelWidths)
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandleId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const riskRef = useRef(risk)
  riskRef.current = risk
  const json = useMemo(() => toJson(risk), [risk])
  const commitFormRisk = (nextRisk: Risk) => {
    const synchronizedRisk = syncAlertFromBasic(nextRisk)
    setRisk(synchronizedRisk)
    setJsonText(toJson(synchronizedRisk))
    setJsonError('')
    setDirty(true)
    setSaveState('idle')
  }
  const update = (path: string, value: unknown) => {
    const nextRisk = structuredClone(risk)
    const parts = path.split('.')
    let target: Record<string, unknown> = nextRisk as unknown as Record<string, unknown>
    parts.slice(0, -1).forEach(part => { target = target[part] as Record<string, unknown> })
    target[parts.at(-1)!] = value
    commitFormRisk(nextRisk)
  }
  const handleSeverityChange = (value: Risk['severity']) => {
    commitFormRisk({ ...risk, severity: value, severity_label: value })
  }
  const handleIndustryNameChange = (value: string) => {
    commitFormRisk({ ...risk, industry_name: value, industry_slug: slugify(value) })
  }
  const handleTitleChange = (value: string) => {
    commitFormRisk({ ...risk, title: value, card_id: slugify(value), sender: { ...risk.sender, context: createSenderContext(value) } })
  }
  const syncJson = (next: Risk) => { const synchronizedRisk = syncAlertFromBasic(next); setRisk(synchronizedRisk); setJsonText(toJson(synchronizedRisk)); setJsonError(''); setDirty(false); setSaveState('idle') }
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); flash('JSON copied to clipboard') }
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `${risk.risk_id || 'risk'}.json`; a.click(); URL.revokeObjectURL(a.href) }
  const applyJsonToPreview = useCallback((source: string) => {
    const result = parseRiskText(source)

    if (result.risk) {
      setRisk(result.risk)
      setJsonError('')
      if (toJson(result.risk) !== toJson(riskRef.current)) {
        setDirty(true)
        setSaveState('idle')
      }
      return true
    }

    setJsonError(result.error)
    return false
  }, [])

  const parse = () => {
    if (applyJsonToPreview(jsonText)) flash('Risk JSON parsed successfully')
  }

  const saveRisk = () => {
    const validation = riskSchema.safeParse(risk)

    if (!validation.success) {
      setJsonError(validation.error.issues[0]?.message || 'Invalid risk data')
      flash('Cannot save invalid risk')
      return
    }

    const normalizedRisk = normalizeRisk(validation.data)

    try {
      window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(normalizedRisk))
      window.localStorage.setItem(savedJsonStorageKey, toJson(normalizedRisk))
      window.localStorage.setItem(savedRiskTimestampKey, new Date().toISOString())
      setRisk(normalizedRisk)
      setJsonText(toJson(normalizedRisk))
      setJsonError('')
      setDirty(false)
      setSaveState('saved')
      flash('Risk saved locally')
    } catch {
      flash('Unable to save risk locally')
    }
  }

  const resetRisk = () => {
    try {
      window.localStorage.removeItem(savedRiskStorageKey)
      window.localStorage.removeItem(savedJsonStorageKey)
      window.localStorage.removeItem(savedRiskTimestampKey)
    } catch {
      // Ignore storage failures and still reset the in-memory risk.
    }

    syncJson(sampleRisk)
  }

  useEffect(() => {
    try {
      const savedRisk = window.localStorage.getItem(savedRiskStorageKey)

      if (!savedRisk) return

      const loadedRisk = normalizeRisk(JSON.parse(savedRisk))
      setRisk(loadedRisk)
      setJsonText(toJson(loadedRisk))
      setJsonError('')
      setDirty(false)
      setSaveState('saved')
    } catch {
      try {
        window.localStorage.removeItem(savedRiskStorageKey)
        window.localStorage.removeItem(savedJsonStorageKey)
        window.localStorage.removeItem(savedRiskTimestampKey)
      } catch {
        // Ignore storage failures and keep the sample risk fallback.
      }
    }
  }, [])

  useEffect(() => {
    if (mode !== 'json') return

    const source = jsonText.trim()

    if (!source) return

    const timeout = window.setTimeout(() => applyJsonToPreview(source), 400)

    return () => window.clearTimeout(timeout)
  }, [jsonText, mode, applyJsonToPreview])
  const resizePanels = useCallback((clientX: number, handle: ResizeHandleId) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pointerPercent = ((clientX - rect.left) / rect.width) * 100
    setPanelWidths(current => {
      if (handle === 'form-json') {
        const form = Math.min(Math.max(pointerPercent, 24), 100 - 20 - current.preview)
        return { ...current, form, json: 100 - form - current.preview }
      }

      const preview = Math.min(Math.max(100 - current.form - pointerPercent, 28), 100 - current.form - 20)
      return { ...current, preview, json: 100 - current.form - preview }
    })
  }, [])
  useEffect(() => {
    if (!activeResizeHandle) return

    const handlePointerMove = (event: PointerEvent) => resizePanels(event.clientX, activeResizeHandle)
    const stopResizing = () => {
      setActiveResizeHandle(null)
      document.body.style.userSelect = ''
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.userSelect = ''
    }
  }, [activeResizeHandle, resizePanels])
  const startResizing = (handle: ResizeHandleId) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActiveResizeHandle(handle)
  }
  const nudgePanels = (handle: ResizeHandleId, direction: number) => {
    setPanelWidths(current => {
      if (handle === 'form-json') {
        const form = Math.min(Math.max(current.form + direction, 24), 100 - 20 - current.preview)
        return { ...current, form, json: 100 - form - current.preview }
      }

      const json = Math.min(Math.max(current.json + direction, 20), 100 - current.form - 28)
      return { ...current, json, preview: 100 - current.form - json }
    })
  }
  const handleResizeKeyDown = (handle: ResizeHandleId) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      nudgePanels(handle, event.key === 'ArrowRight' ? 1 : -1)
    }
  }
  const resetPanelWidths = () => setPanelWidths(defaultPanelWidths)
  const updateSectionTitle = (index: number, title: string) => update('details.sections', risk.details.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, title, key: createUniqueSectionKey(title, risk.details.sections, index) } : section))
  const updateSectionItem = (sectionIndex: number, itemIndex: number, value: string) => update('details.sections', risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: section.items.map((item, currentItemIndex) => currentItemIndex === itemIndex ? value : item) } : section))
  const addSectionItem = (sectionIndex: number) => update('details.sections', risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: [...section.items, ''] } : section))
  const removeSectionItem = (sectionIndex: number, itemIndex: number) => update('details.sections', risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: section.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex) } : section))
  const moveSectionItem = (sectionIndex: number, itemIndex: number, direction: number) => update('details.sections', risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: move(section.items, itemIndex, direction) } : section))
  const duplicateSectionItem = (sectionIndex: number, itemIndex: number) => update('details.sections', risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: [...section.items.slice(0, itemIndex + 1), section.items[itemIndex], ...section.items.slice(itemIndex + 1)] } : section))
  const addSection = () => update('details.sections', [...risk.details.sections, { key: '', title: '', items: [''] }])
  const removeSection = (index: number) => update('details.sections', risk.details.sections.filter((_, sectionIndex) => sectionIndex !== index))
  const moveSection = (index: number, direction: number) => update('details.sections', move(risk.details.sections, index, direction))
  const duplicateSection = (index: number) => {
    const section = { ...risk.details.sections[index], items: [...risk.details.sections[index].items], key: '' }
    const nextSections = [...risk.details.sections.slice(0, index + 1), section, ...risk.details.sections.slice(index + 1)]
    nextSections[index + 1] = { ...section, key: createUniqueSectionKey(section.title, nextSections, index + 1) }
    update('details.sections', nextSections)
  }
  const addMetric = () => {
    const newMetric: RiskMetric = { key: '', label: 'New Metric', value: '', raw_value: '', type: 'text', highlight: false }
    const nextMetrics = [...risk.metrics, newMetric]
    nextMetrics[nextMetrics.length - 1] = { ...newMetric, key: createUniqueMetricKey(newMetric.label, nextMetrics, nextMetrics.length - 1) }
    update('metrics', nextMetrics)
  }
  const patchMetric = (i: number, patch: Partial<RiskMetric>) => update('metrics', risk.metrics.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  const handleMetricLabelChange = (index: number, label: string) => {
    const nextMetrics = risk.metrics.map((metric, metricIndex) => metricIndex === index
      ? { ...metric, label, key: createUniqueMetricKey(label, risk.metrics, index) }
      : metric)
    commitFormRisk({ ...risk, metrics: nextMetrics })
  }
  const handleMetricRawValueChange = (index: number, rawValue: string) => {
    const metric = risk.metrics[index]
    const nextMetrics = risk.metrics.map((item, metricIndex) => metricIndex === index
      ? { ...item, raw_value: normalizeMetricRawValue(rawValue, metric.type), value: formatMetricDisplayValue(rawValue, metric.type) }
      : item)
    commitFormRisk({ ...risk, metrics: nextMetrics })
  }
  const handleMetricTypeChange = (index: number, type: RiskMetric['type']) => {
    const metric = risk.metrics[index]
    const nextMetrics = risk.metrics.map((item, metricIndex) => metricIndex === index
      ? { ...item, type, value: formatMetricDisplayValue(metric.raw_value, type) }
      : item)
    commitFormRisk({ ...risk, metrics: nextMetrics })
  }
  const duplicateMetric = (index: number) => {
    const metric = { ...risk.metrics[index], key: '' }
    const nextMetrics = [...risk.metrics.slice(0, index + 1), metric, ...risk.metrics.slice(index + 1)]
    nextMetrics[index + 1] = { ...metric, key: createUniqueMetricKey(metric.label, nextMetrics, index + 1) }
    update('metrics', nextMetrics)
  }
  const removeMetric = (i: number) => update('metrics', risk.metrics.filter((_, idx) => idx !== i))
  const move = <T,>(items: T[], i: number, direction: number) => { const next = [...items]; const target = i + direction; if (target < 0 || target >= next.length) return next; [next[i], next[target]] = [next[target], next[i]]; return next }
  const addMitigation = () => update('mitigation', [...risk.mitigation, { step: risk.mitigation.length + 1, title: 'New mitigation step', description: '', owner: '' }])
  const patchMitigation = (i: number, patch: Partial<MitigationStep>) => update('mitigation', risk.mitigation.map((m, idx) => idx === i ? { ...m, ...patch } : m).map((m, idx) => ({ ...m, step: idx + 1 })))
  const actionButton = (label: string, onClick: () => void) => <button aria-label={label} title={label} onClick={onClick} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><GripVertical className="size-3.5" /></button>

  const formPanel = <div className="flex flex-col gap-4">
    <Section title="Basic Information"><div className="grid gap-4 sm:grid-cols-2"><Field label="Risk ID" value={risk.risk_id} onChange={v => update('risk_id', v)} /><Field label="Card ID" value={risk.card_id} readOnly autoGenerated /><Field label="Industry Name" value={risk.industry_name} onChange={handleIndustryNameChange} /><Field label="Industry Slug" value={risk.industry_slug} readOnly autoGenerated onChange={() => undefined} /><Field label="Title" value={risk.title} onChange={handleTitleChange} /><SelectField label="Severity" value={risk.severity} options={['low', 'medium', 'high']} onChange={v => handleSeverityChange(v as Risk['severity'])} /><Field label="Severity Label" value={risk.severity_label} readOnly autoGenerated onChange={() => undefined} /><Field label="SKU" value={risk.sku} onChange={v => update('sku', v)} /><Field label="Product" value={risk.product} onChange={v => update('product', v)} /><Field label="Subtitle" value={risk.subtitle} onChange={v => update('subtitle', v)} /><div className="sm:col-span-2"><TextArea label="Summary" value={risk.summary} onChange={v => update('summary', v)} /></div></div></Section>
    <Section title="Sender Information"><div className="grid gap-4 sm:grid-cols-2"><Field label="Sender Name" value={fixedSenderName} readOnly fixed /><Field label="Sender Context" value={risk.sender.context} readOnly autoGenerated onChange={() => undefined} /></div></Section>
    <Section title="Alert Information"><div className="grid gap-4 sm:grid-cols-2"><Field label="Risk ID" value={risk.alert.risk_id} readOnly autoGenerated /><Field label="SKU" value={risk.alert.sku} readOnly autoGenerated /><Field label="Product" value={risk.alert.product} readOnly autoGenerated /><Field label="Severity" value={risk.alert.severity} readOnly autoGenerated /><div className="sm:col-span-2"><TextArea label="Summary" value={risk.alert.summary} readOnly autoGenerated /></div></div></Section>
    <Section title="Metrics"><div className="flex flex-col gap-3">{risk.metrics.map((metric, i) => <div key={`${metric.key}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Metric {i + 1}</span><div className="flex items-center gap-1"><button onClick={() => update('metrics', move(risk.metrics, i, -1))} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronUp className="size-4" /></button><button onClick={() => update('metrics', move(risk.metrics, i, 1))} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronDown className="size-4" /></button><button onClick={() => duplicateMetric(i)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button onClick={() => removeMetric(i)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Key" value={metric.key} readOnly autoGenerated /><Field label="Label" value={metric.label} onChange={v => handleMetricLabelChange(i, v)} /><Field label="Display Value" value={metric.value} readOnly autoGenerated /><div><Field label="Raw Value" value={metric.raw_value} onChange={v => handleMetricRawValueChange(i, v)} />{metricRawValueError(metric.raw_value, metric.type) && <p className="mt-1 text-xs text-red-600">{metricRawValueError(metric.raw_value, metric.type)}</p>}</div><SelectField label="Type" value={metric.type} options={['currency', 'number', 'percentage', 'text']} onChange={v => handleMetricTypeChange(i, v as RiskMetric['type'])} /><label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={metric.highlight} onChange={e => patchMetric(i, { highlight: e.target.checked })} className="size-4 accent-slate-900" />Highlight metric</label></div></div>)}<Button onClick={addMetric}><Plus className="size-3.5" />Add Metric</Button></div></Section>
    <Section title="Risk Details"><DetailSectionsEditor sections={risk.details.sections} onTitleChange={updateSectionTitle} onItemChange={updateSectionItem} onAddItem={addSectionItem} onRemoveItem={removeSectionItem} onMoveItem={moveSectionItem} onDuplicateItem={duplicateSectionItem} onAddSection={addSection} onRemoveSection={removeSection} onMoveSection={moveSection} onDuplicateSection={duplicateSection} /></Section>
    <Section title="Impact"><div className="flex flex-col gap-3">{risk.impact.map((item, i) => <div key={i} className="flex gap-2"><textarea className={`${inputClass} min-h-20`} value={item} onChange={e => update('impact', risk.impact.map((v, idx) => idx === i ? e.target.value : v))} /><button onClick={() => update('impact', risk.impact.filter((_, idx) => idx !== i))} className="self-start rounded-lg p-2 text-red-400 hover:bg-red-50"><Trash2 className="size-4" /></button></div>)}<Button onClick={() => update('impact', [...risk.impact, ''])}><Plus className="size-3.5" />Add Impact</Button></div></Section>
    <Section title="Mitigation Plan"><div className="flex flex-col gap-3">{risk.mitigation.map((step, i) => <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Step {i + 1}</span><div className="flex gap-1"><button onClick={() => update('mitigation', move(risk.mitigation, i, -1).map((m, idx) => ({ ...m, step: idx + 1 })))} className="p-1 text-slate-400"><ChevronUp className="size-4" /></button><button onClick={() => update('mitigation', move(risk.mitigation, i, 1).map((m, idx) => ({ ...m, step: idx + 1 })))} className="p-1 text-slate-400"><ChevronDown className="size-4" /></button><button onClick={() => update('mitigation', [...risk.mitigation.slice(0, i + 1), { ...step }, ...risk.mitigation.slice(i + 1)].map((m, idx) => ({ ...m, step: idx + 1 })))} className="p-1 text-slate-400"><Copy className="size-3.5" /></button><button onClick={() => update('mitigation', risk.mitigation.filter((_, idx) => idx !== i).map((m, idx) => ({ ...m, step: idx + 1 })))} className="p-1 text-red-400"><Trash2 className="size-3.5" /></button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Title" value={step.title} onChange={v => patchMitigation(i, { title: v })} /><Field label="Owner" value={step.owner} onChange={v => patchMitigation(i, { owner: v })} /><div className="sm:col-span-2"><TextArea label="Description" value={step.description} onChange={v => patchMitigation(i, { description: v })} /></div></div></div>)}<Button onClick={addMitigation}><Plus className="size-3.5" />Add Step</Button></div></Section>
    <Section title="Assignment"><div className="grid gap-4 sm:grid-cols-2"><Field label="Owner" value={risk.assign.owner} onChange={v => update('assign.owner', v)} /><SelectField label="Status" value={risk.assign.status} options={['Unassigned', 'Assigned', 'In Progress', 'Resolved', 'Closed']} onChange={v => update('assign.status', v)} /></div></Section>
    <Section title="System Metadata" badge="System-managed" open={false}><div className="grid gap-4 sm:grid-cols-2"><Field label="Detected Time" value={risk.detected_time} readOnly fixed /><Field label="Created At" value={risk.created_at} readOnly fixed /><Field label="Updated At" value={risk.updated_at} readOnly fixed /><SelectField label="Status" value={risk.status} options={['active', 'resolved', 'closed']} disabled /><label className="flex cursor-not-allowed items-center gap-2 text-sm text-slate-500"><input type="checkbox" checked={risk.is_active} disabled aria-disabled="true" aria-label="Is active" className="size-4 cursor-not-allowed accent-slate-900 disabled:cursor-not-allowed disabled:accent-slate-400 disabled:opacity-60" /><span>Is active: {risk.is_active ? 'Yes' : 'No'}</span></label></div></Section>
  </div>

  const jsonPanel = <div className={`min-w-0 ${mode === 'form' ? 'lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-32px)]' : ''}`}><JsonPanel jsonText={jsonText} setJsonText={setJsonText} error={jsonError} onParse={parse} onCopy={() => copy(mode === 'form' ? json : jsonText)} onDownload={download} onFormat={() => {
    try {
      const source = mode === 'form' ? json : jsonText
      setJsonText(JSON.stringify(JSON.parse(source), null, 2))
      setJsonError('')
    } catch {
      setJsonError('Cannot format invalid JSON')
    }
  }} /></div>
  const formColumn = <div className="min-w-0">{formPanel}</div>
  const previewColumn = <div className="min-w-0 xl:sticky xl:top-6 xl:self-start"><div className="xl:max-h-[calc(100vh-120px)] xl:overflow-y-auto"><Preview risk={risk} /></div></div>
  const formJsonLayout = devMode ? <>
    <div ref={containerRef} className="hidden min-w-0 items-start xl:grid xl:[grid-template-columns:var(--panel-grid)]" style={{ '--panel-grid': `${panelWidths.form}fr 10px ${panelWidths.json}fr 10px ${panelWidths.preview}fr` } as React.CSSProperties}>
      {formColumn}
      <ResizeHandle label="Resize form and JSON editor panels" active={activeResizeHandle === 'form-json'} onPointerDown={startResizing('form-json')} onDoubleClick={resetPanelWidths} onKeyDown={handleResizeKeyDown('form-json')} />
      {jsonPanel}
      <ResizeHandle label="Resize JSON editor and preview panels" active={activeResizeHandle === 'json-preview'} onPointerDown={startResizing('json-preview')} onDoubleClick={resetPanelWidths} onKeyDown={handleResizeKeyDown('json-preview')} />
      {previewColumn}
    </div>
    <div className="grid items-start gap-6 xl:hidden">{formColumn}{jsonPanel}{previewColumn}</div>
  </> : <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">{formColumn}{jsonPanel}</div>

  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center overflow-hidden rounded-lg "><Image src="/image.png" alt="StratSync logo" width={36} height={36} className="size-9 object-contain" /></div><div><h1 className="text-lg font-bold tracking-tight">Risk JSON Builder</h1><p className="hidden text-xs text-slate-500 sm:block">By Stratsync.ai</p></div></div><div className="flex items-center gap-2"><label className="hidden cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 md:flex"><input type="checkbox" checked={devMode} onChange={e => setDevMode(e.target.checked)} className="size-4 cursor-pointer accent-slate-900 disabled:cursor-not-allowed" />Developer Mode</label><Button primary className="cursor-pointer disabled:cursor-not-allowed" onClick={saveRisk}><Save className="size-3.5" />Save</Button><Button className="cursor-pointer disabled:cursor-not-allowed" onClick={resetRisk}><RotateCcw className="size-3.5" />Reset</Button><ProfileMenu user={user} onSignOut={signOut} /></div></div></header><div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8"><div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex items-center gap-2">{dirty ? <span className="text-xs font-medium text-amber-600">Unsaved changes</span> : saveState === 'saved' ? <span className="text-xs font-medium text-emerald-600">Saved locally</span> : null}</div><h2 className="text-3xl font-bold tracking-tight text-slate-950">Risk JSON Builder</h2><p className="mt-1 text-sm text-slate-500">Build structured risk payloads visually or convert existing JSON into a readable risk view.</p></div><div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm"><button onClick={() => setMode('form')} className={`cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'form' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>Form → JSON</button><button onClick={() => setMode('json')} className={`cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'json' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>JSON → UI</button></div></div>{mode === 'form' ? formJsonLayout : <div className="grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">{jsonPanel}<Preview risk={risk} /></div>}</div>{notice && <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl"><Check className="size-4 text-emerald-400" />{notice}</div>}</main>
}

export default function Page() {
  return <AuthGate><RiskJsonBuilder /></AuthGate>
}

function ListEditor({ title, items, onChange, onAdd, onRemove }: { title: string; items: string[]; onChange: (i: number, v: string) => void; onAdd: () => void; onRemove: (i: number) => void }) { return <div className="mt-5 flex flex-col gap-2"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">{title}</span><button onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Plus className="size-3" />Add</button></div>{items.map((item, i) => <div key={i} className="flex gap-2"><input className={inputClass} value={item} onChange={e => onChange(i, e.target.value)} /><button onClick={() => onRemove(i)} className="rounded-lg p-2 text-red-400 hover:bg-red-50"><X className="size-4" /></button></div>)}</div> }
function ExposureListEditor({ items, onChange, onMove, onDuplicate, onRemove, onAdd }: { items: string[]; onChange: (index: number, value: string) => void; onMove: (index: number, direction: number) => void; onDuplicate: (index: number) => void; onRemove: (index: number) => void; onAdd: () => void }) { return <div className="flex flex-col gap-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">Underlying Exposure</span><button onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Plus className="size-3" />Add Exposure Item</button></div>{items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No underlying exposure details provided.</p>}{items.map((item, index) => <div key={`exposure-${index}`} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Item {index + 1}</span><div className="flex items-center gap-1"><button type="button" aria-label={`Move exposure item ${index + 1} up`} onClick={() => onMove(index, -1)} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronUp className="size-4" /></button><button type="button" aria-label={`Move exposure item ${index + 1} down`} onClick={() => onMove(index, 1)} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronDown className="size-4" /></button><button type="button" aria-label={`Duplicate exposure item ${index + 1}`} onClick={() => onDuplicate(index)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button type="button" aria-label={`Delete exposure item ${index + 1}`} onClick={() => onRemove(index)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div><textarea className={`${inputClass} min-h-24 resize-y`} value={item} onChange={event => onChange(index, event.target.value)} /></div>)}</div> }
function DetailSectionsEditor({ sections, onTitleChange, onItemChange, onAddItem, onRemoveItem, onMoveItem, onDuplicateItem, onAddSection, onRemoveSection, onMoveSection, onDuplicateSection }: { sections: RiskDetailSection[]; onTitleChange: (index: number, title: string) => void; onItemChange: (sectionIndex: number, itemIndex: number, value: string) => void; onAddItem: (sectionIndex: number) => void; onRemoveItem: (sectionIndex: number, itemIndex: number) => void; onMoveItem: (sectionIndex: number, itemIndex: number, direction: number) => void; onDuplicateItem: (sectionIndex: number, itemIndex: number) => void; onAddSection: () => void; onRemoveSection: (index: number) => void; onMoveSection: (index: number, direction: number) => void; onDuplicateSection: (index: number) => void }) {
  return <div className="flex flex-col gap-4">
    {sections.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No risk detail sections added.</p>}
    {sections.map((section, sectionIndex) => <div key={`${section.key || 'section'}-${sectionIndex}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-4 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Section {sectionIndex + 1}</span><div className="flex items-center gap-1"><button type="button" aria-label={`Move section ${sectionIndex + 1} up`} disabled={sectionIndex === 0} onClick={() => onMoveSection(sectionIndex, -1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronUp className="size-4" /></button><button type="button" aria-label={`Move section ${sectionIndex + 1} down`} disabled={sectionIndex === sections.length - 1} onClick={() => onMoveSection(sectionIndex, 1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronDown className="size-4" /></button><button type="button" aria-label={`Duplicate section ${sectionIndex + 1}`} onClick={() => onDuplicateSection(sectionIndex)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button type="button" aria-label={`Delete section ${sectionIndex + 1}`} onClick={() => onRemoveSection(sectionIndex)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Section Title" value={section.title} onChange={value => onTitleChange(sectionIndex, value)} /><Field label="Section Key" value={section.key} readOnly autoGenerated /></div>
      <div className="mt-4 flex flex-col gap-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">Bullet Items</span><button type="button" onClick={() => onAddItem(sectionIndex)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Plus className="size-3" />Add Item</button></div>{section.items.map((item, itemIndex) => <div key={`${section.key || 'section'}-${sectionIndex}-item-${itemIndex}`} className="flex gap-2"><div className="flex min-w-0 flex-1 items-start gap-2"><span className="pt-2.5 text-xs font-bold text-slate-400">{itemIndex + 1}.</span><textarea className={`${inputClass} min-h-20 resize-y`} value={item} onChange={event => onItemChange(sectionIndex, itemIndex, event.target.value)} /></div><div className="flex shrink-0 items-start gap-1"><button type="button" aria-label="Move item up" disabled={itemIndex === 0} onClick={() => onMoveItem(sectionIndex, itemIndex, -1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronUp className="size-4" /></button><button type="button" aria-label="Move item down" disabled={itemIndex === section.items.length - 1} onClick={() => onMoveItem(sectionIndex, itemIndex, 1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronDown className="size-4" /></button><button type="button" aria-label="Duplicate item" onClick={() => onDuplicateItem(sectionIndex, itemIndex)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button type="button" aria-label="Delete item" onClick={() => onRemoveItem(sectionIndex, itemIndex)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div>)}</div>
    </div>)}
    <Button primary onClick={onAddSection}><Plus className="size-3.5" />Add Section</Button>
  </div>
}
function JsonPanel({ jsonText, setJsonText, error, onParse, onCopy, onDownload, onFormat }: { jsonText: string; setJsonText: (v: string) => void; error: string; onParse: () => void; onCopy: () => void; onDownload: () => void; onFormat: () => void }) { return <div className="flex max-h-[calc(100vh-32px)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">JSON Editor</h3><p className="mt-0.5 text-xs text-slate-500">Edit the payload directly or use the form.</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span className={`size-1.5 rounded-full ${error ? 'bg-red-500' : 'bg-emerald-500'}`} />{error ? 'Invalid JSON' : 'Valid JSON'}</span></div><div className="relative"><textarea aria-label="Risk JSON editor" value={jsonText} onChange={e => setJsonText(e.target.value)} className="min-h-[400px] max-h-[calc(100vh-220px)] w-full overflow-y-auto resize-none rounded-lg border border-slate-800 bg-[#17202b] p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus:ring-2 focus:ring-slate-300" spellCheck={false} />{error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}</div><div className="flex flex-wrap gap-2"><Button primary className="cursor-pointer" onClick={onParse}><Upload className="size-3.5" />Parse JSON</Button><Button className="cursor-pointer" onClick={onFormat}><Check className="size-3.5" />Format</Button><Button className="cursor-pointer" onClick={onCopy}><Copy className="size-3.5" />Copy</Button><Button className="cursor-pointer" onClick={onDownload}><Download className="size-3.5" />Download</Button></div></div> }
