// @ts-nocheck
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import Image from 'next/image'
import { ArrowRight, Check, ChevronDown, ChevronUp, CircleAlert, Copy, Database, Download, Eye, GripVertical, Loader2, LogOut, Plus, RefreshCw, RotateCcw, Trash2, Upload, UserRound, X } from 'lucide-react'
import type { User } from 'firebase/auth'
import type { MitigationStep, Risk, RiskDetailSection, RiskMetric } from '@/types/risk'
import { normalizeRisk, riskSchema, toJson } from '@/lib/risk-utils'
import { Preview } from '@/components/risk-preview'
import { AuthGate, useAuth } from '@/components/auth/AuthGate'

type SectionProps = { title: string; children: React.ReactNode; open?: boolean; badge?: string }
type ResizeHandleId = 'form-json' | 'json-preview'
type PanelWidths = { form: number; json: number; preview: number }
type BuilderMode = 'form' | 'json' | 'database'
type RiskIdStatus = 'idle' | 'checking' | 'verified' | 'error'
type DatabaseSaveStatus = 'idle' | 'saving' | 'success' | 'duplicate' | 'error'
type ActiveRiskStatus = 'draft' | 'existing-database' | 'none'
type DatabaseRisk = Omit<Partial<Risk>, '_id' | 'sender' | 'metrics' | 'details' | 'mitigation'> & {
  _id?: unknown
  created_at?: unknown
  updated_at?: unknown
  sender?: unknown
  metrics?: unknown
  details?: unknown
  mitigation?: unknown
}
const defaultPanelWidths: PanelWidths = { form: 34, json: 28, preview: 38 }
const severityTone: Record<string, string> = { low: 'bg-emerald-50 text-emerald-700 border-emerald-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', high: 'bg-orange-50 text-orange-700 border-orange-200', critical: 'bg-red-50 text-red-700 border-red-200' }
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
const readOnlyFieldClass = '!cursor-not-allowed !border-slate-200 !bg-slate-100 !text-slate-500 shadow-none placeholder:!text-slate-400 hover:!bg-slate-100 focus:!border-slate-200 focus:!bg-slate-100 focus:outline-none focus:ring-0 disabled:!cursor-not-allowed disabled:!border-slate-200 disabled:!bg-slate-100 disabled:!text-slate-500'
const savedRiskStorageKey = 'risk-json-builder-current-risk'
const savedJsonStorageKey = 'risk-json-builder-current-json'
const savedRiskTimestampKey = 'risk-json-builder-saved-at'
const activeRiskStatusStorageKey = 'risk-json-builder-active-status'
const databaseSavedRiskIdStorageKey = 'risk-json-builder-database-saved-risk-id'
const autosaveDelayMs = 1000
const riskIdCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const riskIdGenerationAttempts = 10
let nextSectionUiId = 0

function createSectionUiId() {
  nextSectionUiId += 1
  return `risk-detail-section-${nextSectionUiId}`
}

function generateRandomBlock(length = 4) {
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, value => riskIdCharacters[value % riskIdCharacters.length]).join('')
}

function generateRiskIdCandidate() {
  return `RSK-${generateRandomBlock()}-${generateRandomBlock()}`
}

async function checkRiskIdExists(riskId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Risk ID API URL is not configured')

  const response = await fetch(`${baseUrl}/api/risks/${encodeURIComponent(riskId)}`)
  if (response.status === 200) return true
  if (response.status === 404) return false
  throw new Error(`Risk ID check failed with status ${response.status}`)
}

async function createRisk(risk: Risk) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
  if (!baseUrl) throw new Error('Risk API URL is not configured')

  return fetch(`${baseUrl}/api/risks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: toJson(risk),
  })
}

async function generateUniqueRiskId() {
  for (let attempt = 0; attempt < riskIdGenerationAttempts; attempt += 1) {
    const candidate = generateRiskIdCandidate()
    if (!await checkRiskIdExists(candidate)) return candidate
  }

  throw new Error('Unable to generate a unique Risk ID')
}

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

function createEntitySubtitle(entity: Risk['entity']) {
  const id = entity.id.trim()
  const prefix = id ? [entity.type.trim().toUpperCase(), id].filter(Boolean).join(' ') : ''
  return [prefix, entity.name.trim()].filter(Boolean).join(' · ')
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
    sender: {
      ...nextRisk.sender,
      risk_id: nextRisk.risk_id,
    },
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

function createFreshRiskDraft(riskId = ''): Risk {
  return {
    risk_id: riskId,
    card_id: '',
    industry_slug: '',
    industry_name: '',
    title: '',
    severity: '' as Risk['severity'],
    severity_label: '',
    subtitle: '',
    summary: '',
    sender: {
      name: 'StratSync Risk Monitor',
      source: '',
      risk_id: riskId,
      timestamp: '',
      context: '',
    },
    entity: { type: 'sku', id: '', name: '' },
    metrics: [],
    details: {
      section_title: '',
      items: [],
      underlying_exposure: [],
      impact: [''],
      sections: [{ key: '', title: '', items: [''], uiId: createSectionUiId() }],
    },
    mitigation: {
      summary: '',
      steps: [],
      last_updated: '',
      next_action: '',
    },
    actions: [],
    detected_time: '',
    is_active: true,
    status: 'active',
    sku: '',
    product: '',
    impact: [],
    alert: { risk_id: riskId, sku: '', product: '', severity: '', summary: '' },
    assign: { owner: '', status: 'Unassigned' },
    created_at: '',
    updated_at: '',
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
function Field({ label, value, onChange, type = 'text', inputMode, pattern, placeholder, readOnly = false, autoGenerated = false, fixed = false }: { label: string; value: string | number | boolean; onChange?: (v: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; pattern?: string; placeholder?: string; readOnly?: boolean; autoGenerated?: boolean; fixed?: boolean }) { const isReadOnly = readOnly || autoGenerated || fixed; return <label className="flex flex-col gap-1.5"><span className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{autoGenerated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Auto-generated</span>}{fixed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">System-defined</span>}</span><input className={`${inputClass} ${isReadOnly ? readOnlyFieldClass : ''}`} type={type} inputMode={inputMode} pattern={pattern} value={String(value)} placeholder={placeholder} readOnly={isReadOnly} aria-readonly={isReadOnly ? 'true' : undefined} onChange={isReadOnly ? undefined : onChange ? e => onChange(e.target.value) : undefined} /></label> }
function RiskIdField({ value, status }: { value: string; status: RiskIdStatus }) {
  const statusLabel = status === 'checking' ? 'Generating and verifying Risk ID' : status === 'verified' ? 'Risk ID verified' : status === 'error' ? 'Unable to verify Risk ID' : 'Risk ID is system-controlled'
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">Risk ID</span><span className="relative"><input className={`${inputClass} ${readOnlyFieldClass} pr-10`} value={value || (status === 'checking' ? 'Generating Risk ID...' : '')} readOnly aria-readonly="true" aria-describedby="risk-id-status" /><span id="risk-id-status" role="status" aria-label={statusLabel} title={statusLabel} className="pointer-events-none absolute inset-y-0 right-3 flex w-4 items-center justify-center">{status === 'checking' ? <Loader2 className="size-4 animate-spin text-slate-500" /> : status === 'verified' ? <Check className="size-4 text-emerald-600" /> : status === 'error' ? <CircleAlert className="size-4 text-red-600" /> : null}</span></span></label>
}
function SelectField({ label, value, options, onChange, disabled = false, className = '' }: { label: string; value: string; options: string[]; onChange?: (v: string) => void; disabled?: boolean; className?: string }) { return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500">{label}</span><select className={`${inputClass} ${disabled ? readOnlyFieldClass : ''} ${className}`} value={value} onChange={disabled || !onChange ? undefined : e => onChange(e.target.value)} disabled={disabled} aria-disabled={disabled ? 'true' : undefined}>{options.map(o => <option key={o || 'empty'} value={o}>{o || 'Select severity'}</option>)}</select></label> }
function TextArea({ label, value, onChange, placeholder, readOnly = false, autoGenerated = false }: { label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean; autoGenerated?: boolean }) { const isReadOnly = readOnly || autoGenerated; return <label className="flex flex-col gap-1.5"><span className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{autoGenerated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Auto-generated</span>}</span><textarea className={`${inputClass} min-h-24 resize-y ${isReadOnly ? readOnlyFieldClass : ''}`} value={value} placeholder={placeholder} readOnly={isReadOnly} aria-readonly={isReadOnly ? 'true' : undefined} onChange={isReadOnly ? undefined : onChange ? e => onChange(e.target.value) : undefined} /></label> }
function Button({ children, onClick, primary = false, danger = false, className = '', disabled = false }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; className?: string; disabled?: boolean }) { return <button disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${primary ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700' : danger ? 'border-red-100 text-red-600 hover:bg-red-50' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'} ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className}`}>{children}</button> }

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

function withoutDatabaseMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const cleanRisk = { ...(value as Record<string, unknown>) }
  delete cleanRisk._id
  delete cleanRisk.created_at
  delete cleanRisk.updated_at
  return cleanRisk
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function getDatabaseFactValue(facts: unknown[], label: string) {
  const fact = facts.find(item => stringValue(recordValue(item).label).toLowerCase() === label.toLowerCase())
  return stringValue(recordValue(fact).value)
}

function getDatabaseRiskSkuProduct(risk: DatabaseRisk) {
  const details = recordValue(risk.details)
  const facts = Array.isArray(details.facts) ? details.facts : []
  return {
    sku: stringValue(risk.sku) || getDatabaseFactValue(facts, 'SKU'),
    product: stringValue(risk.product) || getDatabaseFactValue(facts, 'Product'),
  }
}

function mapDatabaseMitigation(value: unknown) {
  const source: unknown[] = Array.isArray(value) ? value : Array.isArray(recordValue(value).steps) ? recordValue(value).steps as unknown[] : []
  return source.map((step, index) => {
    const mappedStep = recordValue(step)
    return {
      step: index + 1,
      title: typeof step === 'string' ? step : stringValue(mappedStep.title || mappedStep.name) || `Step ${index + 1}`,
      description: stringValue(mappedStep.description),
      owner: stringValue(mappedStep.owner),
    }
  })
}

function mapDatabaseMetrics(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(metric => {
    const source = recordValue(metric)
    const label = stringValue(source.label) || 'Metric'
    const rawValue = source.value ?? ''
    return {
      key: slugify(label),
      label,
      value: stringValue(rawValue),
      raw_value: typeof rawValue === 'string' || typeof rawValue === 'number' ? rawValue : '',
      type: 'text',
      highlight: source.status === 'critical',
    }
  })
}

function mapDatabaseDetails(value: unknown) {
  const source = recordValue(value)
  const hasCommonDetails = typeof source.section_title === 'string' || Array.isArray(source.items) || Array.isArray(source.underlying_exposure) || Array.isArray(source.impact)
  if (hasCommonDetails) {
    const items = Array.isArray(source.items) ? source.items.map(item => {
      const record = recordValue(item)
      return { label: stringValue(record.label), value: stringValue(record.value) }
    }).filter(item => item.label || item.value) : []
    return {
      section_title: stringValue(source.section_title),
      items,
      underlying_exposure: Array.isArray(source.underlying_exposure) ? source.underlying_exposure.map(stringValue).filter(Boolean) : [],
      impact: Array.isArray(source.impact) ? source.impact.map(stringValue).filter(Boolean) : [],
      sections: Array.isArray(source.sections) ? source.sections : [],
    }
  }
  if (Array.isArray(source.sections)) return { section_title: '', items: [], underlying_exposure: [], impact: [], sections: source.sections }

  const facts = Array.isArray(source.facts) ? source.facts : []
  const items = facts.map(fact => {
    const item = recordValue(fact)
    const label = stringValue(item.label)
    const factValue = stringValue(item.value)
    return { label, value: factValue }
  }).filter(item => item.label || item.value)

  return { section_title: items.length > 0 ? 'DATABASE FACTS' : '', items, underlying_exposure: [], impact: [], sections: [] }
}

function mapDatabaseRiskToBuilderRisk(databaseRisk: DatabaseRisk) {
  const source = withoutDatabaseMetadata(databaseRisk) as Record<string, unknown>
  const severity = stringValue(source.severity).toLowerCase()
  const sender = recordValue(source.sender)
  const { sku, product } = getDatabaseRiskSkuProduct(databaseRisk)

  return {
    ...source,
    risk_id: stringValue(source.risk_id) || 'DATABASE-RISK',
    title: stringValue(source.title) || 'Database Risk',
    severity: ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium',
    severity_label: stringValue(source.severity_label) || severity || 'Medium',
    sku: sku || 'Unknown SKU',
    product: product || 'Unknown Product',
    summary: stringValue(source.summary) || 'No summary provided.',
    sender: { name: stringValue(sender.name) || 'StratSync Risk Monitor' },
    metrics: mapDatabaseMetrics(source.metrics),
    details: mapDatabaseDetails(databaseRisk.details),
    mitigation: mapDatabaseMitigation(source.mitigation),
  }
}

function databaseRiskLabel(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function databaseRiskStatus(risk: DatabaseRisk) {
  return databaseRiskLabel(risk.status || (risk.is_active ? 'active' : ''), '—')
}

function DatabaseRisksView({ risks, selectedRisk, loading, error, onRefresh, onView, onLoad }: { risks: DatabaseRisk[]; selectedRisk: Risk | null; loading: boolean; error: string; onRefresh: () => void; onView: (risk: DatabaseRisk | null) => void; onLoad: (risk: DatabaseRisk) => void }) {
  return <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-lg font-bold text-slate-950">Database Risks</h3><p className="mt-1 text-sm text-slate-500">View risks currently stored in MongoDB.</p></div>
      <div className="flex items-center gap-3"><span className="text-sm font-semibold text-slate-500">{risks.length} {risks.length === 1 ? 'Risk' : 'Risks'}</span><Button onClick={onRefresh} className="cursor-pointer" disabled={loading}><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></div>
    </div>
    {loading && <p className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">Loading database risks...</p>}
    {!loading && error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"><span>{error}</span><Button onClick={onRefresh} className="cursor-pointer border-red-200 text-red-700 hover:bg-white">Retry</Button></div>}
    {!loading && !error && risks.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">No risks found in the database.</p>}
    {!loading && !error && risks.length > 0 && <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Risk ID</th><th className="px-4 py-3">Title</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Industry</th><th className="px-4 py-3">SKU / Product</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{risks.map((risk, index) => { const { sku, product } = getDatabaseRiskSkuProduct(risk); return <tr key={databaseRiskLabel(risk._id, '') || databaseRiskLabel(risk.risk_id, '') || index} className="align-top hover:bg-slate-50/70"><td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-700">{databaseRiskLabel(risk.risk_id)}</td><td className="max-w-[260px] px-4 py-4 font-semibold text-slate-900">{databaseRiskLabel(risk.title)}</td><td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${severityTone[String(risk.severity || '').toLowerCase()] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{databaseRiskLabel(risk.severity_label || risk.severity)}</span></td><td className="px-4 py-4 text-slate-600">{databaseRiskLabel(risk.industry_name || risk.industry_slug)}</td><td className="max-w-[280px] whitespace-normal break-words px-4 py-4 text-slate-600">{sku || product ? <>{sku && <span className="font-medium text-slate-700">{sku}</span>}{sku && product ? ' · ' : null}{product && <span>{product}</span>}</> : '—'}</td><td className="px-4 py-4 capitalize text-slate-600">{databaseRiskStatus(risk)}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onView(risk)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><Eye className="size-3.5" />View</button><button type="button" onClick={() => onLoad(risk)} className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"><ArrowRight className="size-3.5" />Load</button></div></td></tr> })}</tbody></table></div></div>}
    {selectedRisk && <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p><h3 className="mt-1 text-sm font-bold text-slate-900">{databaseRiskLabel(selectedRisk.title)}</h3></div><button type="button" onClick={() => onView(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-700">Close</button></div><Preview risk={selectedRisk} /></div>}
  </div>
}

function RiskJsonBuilder() {
  const { register } = useForm()
  const { user, signOut } = useAuth()
  const [risk, setRisk] = useState<Risk>(() => createFreshRiskDraft())
  const [activeRiskStatus, setActiveRiskStatus] = useState<ActiveRiskStatus>('draft')
  const [mode, setMode] = useState<BuilderMode>('form')
  const [devMode, setDevMode] = useState(false)
  const [jsonText, setJsonText] = useState(() => toJson(createFreshRiskDraft()))
  const [jsonError, setJsonError] = useState('')
  const [notice, setNotice] = useState('')
  const [isGeneratingRiskId, setIsGeneratingRiskId] = useState(false)
  const [riskIdStatus, setRiskIdStatus] = useState<RiskIdStatus>('checking')
  const [isInitialized, setIsInitialized] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [databaseRisks, setDatabaseRisks] = useState<DatabaseRisk[]>([])
  const [selectedDatabaseRisk, setSelectedDatabaseRisk] = useState<Risk | null>(null)
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseError, setDatabaseError] = useState('')
  const [databaseLoaded, setDatabaseLoaded] = useState(false)
  const [databaseSaveStatus, setDatabaseSaveStatus] = useState<DatabaseSaveStatus>('idle')
  const [databaseSaveRiskId, setDatabaseSaveRiskId] = useState('')
  const [databaseStoredRiskIds, setDatabaseStoredRiskIds] = useState<Set<string>>(() => new Set())
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(defaultPanelWidths)
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandleId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const riskRef = useRef(risk)
  const riskIdGenerationPromiseRef = useRef<Promise<string> | null>(null)
  const riskIdRequestTokenRef = useRef(0)
  const databaseSaveInFlightRef = useRef(false)
  riskRef.current = risk
  const json = useMemo(() => toJson(risk), [risk])
  const riskValidation = useMemo(() => riskSchema.safeParse(JSON.parse(json)), [json])
  const jsonEditorSynchronized = useMemo(() => {
    if (mode !== 'json') return true
    const parsed = parseRiskText(jsonText)
    return Boolean(parsed.risk && toJson(syncAlertFromBasic(parsed.risk)) === json)
  }, [json, jsonText, mode])
  const riskAlreadyInDatabase = Boolean(risk.risk_id && databaseStoredRiskIds.has(risk.risk_id))
  const canAddToDatabase = Boolean(activeRiskStatus === 'draft' && isInitialized && risk.risk_id && riskValidation.success && jsonEditorSynchronized && riskIdStatus === 'verified' && !isGeneratingRiskId && databaseSaveStatus !== 'saving' && !riskAlreadyInDatabase)
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200) }
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
  const updateEntity = (field: 'id' | 'name', value: string) => {
    const entity = { ...risk.entity, [field]: value }
    commitFormRisk({ ...risk, entity, subtitle: createEntitySubtitle(entity) })
  }
  const syncJson = (next: Risk) => { const synchronizedRisk = syncAlertFromBasic(next); setRisk(synchronizedRisk); setJsonText(toJson(synchronizedRisk)); setJsonError(''); setDirty(false); setSaveState('idle') }
  const assignUniqueRiskId = async (baseRisk: Risk) => {
    const requestToken = ++riskIdRequestTokenRef.current
    setIsGeneratingRiskId(true)
    setRiskIdStatus('checking')

    const generationPromise = riskIdGenerationPromiseRef.current || generateUniqueRiskId()
    riskIdGenerationPromiseRef.current = generationPromise

    try {
      const riskId = await generationPromise
      if (requestToken !== riskIdRequestTokenRef.current) return
      const currentRisk = riskRef.current.risk_id ? baseRisk : riskRef.current
      syncJson({ ...currentRisk, risk_id: riskId, sender: { ...currentRisk.sender, risk_id: riskId } })
      setDirty(true)
      setRiskIdStatus('verified')
    } catch (generationError) {
      if (requestToken !== riskIdRequestTokenRef.current) return
      if (process.env.NODE_ENV === 'development') console.error('Unable to generate a unique Risk ID', generationError)
      setRiskIdStatus('error')
      flash('Unable to generate a unique Risk ID. Please try again.')
    } finally {
      if (riskIdGenerationPromiseRef.current === generationPromise) riskIdGenerationPromiseRef.current = null
      if (requestToken === riskIdRequestTokenRef.current) setIsGeneratingRiskId(false)
    }
  }
  const cancelRiskIdGeneration = (status: RiskIdStatus = 'idle') => {
    riskIdRequestTokenRef.current += 1
    setIsGeneratingRiskId(false)
    setRiskIdStatus(status)
  }
  const fetchDatabaseRisks = useCallback(async () => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, '')
    setDatabaseLoading(true)
    setDatabaseError('')

    if (!baseUrl) {
      setDatabaseLoading(false)
      setDatabaseLoaded(true)
      setDatabaseError('Unable to load database risks.')
      return
    }

    try {
      const response = await fetch(`${baseUrl}/api/risks`)
      if (!response.ok) throw new Error(`Database risks request failed with status ${response.status}`)
      const payload: unknown = await response.json()
      const source = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray((payload as { risks?: unknown }).risks) ? (payload as { risks: unknown[] }).risks : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []
      setDatabaseRisks(source.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as DatabaseRisk[])
      setDatabaseStoredRiskIds(current => {
        const next = new Set(current)
        source.forEach(item => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const riskId = stringValue((item as DatabaseRisk).risk_id).trim()
            if (riskId) next.add(riskId)
          }
        })
        return next
      })
      setDatabaseLoaded(true)
    } catch (fetchError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to load database risks', fetchError)
      setDatabaseError('Unable to load database risks.')
      setDatabaseLoaded(true)
    } finally {
      setDatabaseLoading(false)
    }
  }, [])
  useEffect(() => {
    if (mode === 'database' && !databaseLoaded) void fetchDatabaseRisks()
  }, [databaseLoaded, fetchDatabaseRisks, mode])
  const loadDatabaseRisk = (databaseRisk: DatabaseRisk) => {
    try {
      const nextRisk = syncAlertFromBasic(normalizeRisk(mapDatabaseRiskToBuilderRisk(databaseRisk)))
      cancelRiskIdGeneration('verified')
      setRisk(nextRisk)
      setJsonText(toJson(nextRisk))
      setJsonError('')
      setActiveRiskStatus('existing-database')
      setDirty(false)
      setSaveState('idle')
      if (nextRisk.risk_id) setDatabaseStoredRiskIds(current => new Set(current).add(nextRisk.risk_id))
      setDatabaseSaveStatus('idle')
      setDatabaseSaveRiskId('')
      try {
        window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(nextRisk))
        window.localStorage.setItem(savedJsonStorageKey, toJson(nextRisk))
        window.localStorage.setItem(activeRiskStatusStorageKey, 'existing-database')
      } catch {
        // Keep the database risk available in memory if storage is unavailable.
      }
      setSelectedDatabaseRisk(null)
      setMode('json')
    } catch (loadError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to load database risk into builder', loadError)
      flash('Unable to load this database risk into the builder.')
    }
  }
  const viewDatabaseRisk = (databaseRisk: DatabaseRisk | null) => {
    if (!databaseRisk) {
      setSelectedDatabaseRisk(null)
      return
    }

    try {
      setSelectedDatabaseRisk(normalizeRisk(mapDatabaseRiskToBuilderRisk(databaseRisk)))
    } catch (viewError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to preview database risk', viewError)
      flash('Unable to load this database risk into the preview.')
    }
  }
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); flash('JSON copied to clipboard') }
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = `${risk.risk_id || 'risk'}.json`; a.click(); URL.revokeObjectURL(a.href) }
  const applyJsonToPreview = useCallback((source: string) => {
    const result = parseRiskText(source)

    if (result.risk) {
      cancelRiskIdGeneration('verified')
      const synchronizedRisk = syncAlertFromBasic(result.risk)
      const riskChanged = toJson(synchronizedRisk) !== toJson(riskRef.current)
      setRisk(synchronizedRisk)
      setJsonError('')
      if (riskChanged) {
        setActiveRiskStatus('draft')
        setDirty(true)
        setSaveState('idle')
      }
      return true
    }

    setJsonError(result.error)
    return false
  }, [])

  const parse = () => {
    try {
      const parsedValue = JSON.parse(jsonText) as Record<string, unknown>
      const parsedRiskId = typeof parsedValue?.risk_id === 'string' ? parsedValue.risk_id.trim() : ''

      if (!parsedRiskId) {
        const normalizedRisk = normalizeRisk({ ...parsedValue, risk_id: '__PENDING__' })
        const freshRisk = syncAlertFromBasic({ ...normalizedRisk, risk_id: '', sender: { ...normalizedRisk.sender, risk_id: '' } })
        syncJson(freshRisk)
        void assignUniqueRiskId(freshRisk)
        return
      }
    } catch {
      // Let the existing parser provide the validation error.
    }

    if (applyJsonToPreview(jsonText)) flash('Risk JSON parsed successfully')
  }

  const resetRisk = () => {
    try {
      window.localStorage.removeItem(savedRiskStorageKey)
      window.localStorage.removeItem(savedJsonStorageKey)
      window.localStorage.removeItem(savedRiskTimestampKey)
    } catch {
      // Ignore storage failures and still reset the in-memory risk.
    }

    const freshRisk = createFreshRiskDraft()
    setActiveRiskStatus('draft')
    setDatabaseSaveStatus('idle')
    setDatabaseSaveRiskId('')
    try {
      window.localStorage.setItem(activeRiskStatusStorageKey, 'draft')
    } catch {
      // Continue with the in-memory draft if storage is unavailable.
    }
    syncJson(freshRisk)
    void assignUniqueRiskId(freshRisk)
  }

  const startNewRisk = () => {
    const freshRisk = createFreshRiskDraft()
    setActiveRiskStatus('draft')
    setDatabaseSaveStatus('idle')
    setDatabaseSaveRiskId('')
    setMode('form')
    setJsonText(toJson(freshRisk))
    setJsonError('')
    setDirty(true)
    setSaveState('idle')
    setRisk(freshRisk)
    try {
      window.localStorage.setItem(activeRiskStatusStorageKey, 'draft')
      window.localStorage.removeItem(savedRiskStorageKey)
      window.localStorage.removeItem(savedJsonStorageKey)
      window.localStorage.removeItem(savedRiskTimestampKey)
    } catch {
      // Continue with the in-memory draft if storage is unavailable.
    }
    void assignUniqueRiskId(freshRisk)
  }

  const addToDatabase = async () => {
    if (databaseSaveInFlightRef.current || riskAlreadyInDatabase) return

    const validation = riskSchema.safeParse(JSON.parse(toJson(riskRef.current)))
    if (!validation.success || !jsonEditorSynchronized || riskIdStatus !== 'verified' || isGeneratingRiskId) {
      flash('Please fix the risk data before adding it to the database.')
      return
    }

    const canonicalRisk = normalizeRisk(validation.data)
    const submittedRiskId = canonicalRisk.risk_id
    databaseSaveInFlightRef.current = true
    setDatabaseSaveStatus('saving')
    setDatabaseSaveRiskId(submittedRiskId)

    try {
      const response = await createRisk(canonicalRisk)

      if (response.status === 201) {
        setDatabaseStoredRiskIds(current => new Set(current).add(submittedRiskId))
        setDatabaseSaveStatus('success')
        void fetchDatabaseRisks()
        setActiveRiskStatus('none')
        setJsonText('')
        setJsonError('')
        setDirty(false)
        setSaveState('idle')
        try {
          window.localStorage.setItem(databaseSavedRiskIdStorageKey, submittedRiskId)
          window.localStorage.setItem(activeRiskStatusStorageKey, 'none')
          window.localStorage.removeItem(savedRiskStorageKey)
          window.localStorage.removeItem(savedJsonStorageKey)
          window.localStorage.removeItem(savedRiskTimestampKey)
        } catch {
          // The in-memory empty state still prevents accidental resubmission.
        }
        flash('Risk added to database')
        return
      }

      if (response.status === 409) {
        setDatabaseStoredRiskIds(current => new Set(current).add(submittedRiskId))
        setDatabaseSaveStatus('duplicate')
        setActiveRiskStatus('existing-database')
        try {
          window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(canonicalRisk))
          window.localStorage.setItem(savedJsonStorageKey, toJson(canonicalRisk))
          window.localStorage.setItem(activeRiskStatusStorageKey, 'existing-database')
          window.localStorage.setItem(databaseSavedRiskIdStorageKey, submittedRiskId)
        } catch {
          // Keep the duplicate state in memory if storage is unavailable.
        }
        flash('Risk ID already exists in the database.')
        return
      }

      if (response.status === 422) {
        if (process.env.NODE_ENV === 'development') {
          const detail = await response.json().catch(() => null)
          console.error('Risk API validation failed', detail)
        }
        setDatabaseSaveStatus('error')
        flash('Risk data is invalid. Please review the form.')
        return
      }

      setDatabaseSaveStatus('error')
      flash('Unable to add risk to the database. Please try again.')
    } catch (saveError) {
      if (process.env.NODE_ENV === 'development') console.error('Unable to connect to the risk API', saveError)
      setDatabaseSaveStatus('error')
      flash('Unable to connect to the risk API.')
    } finally {
      databaseSaveInFlightRef.current = false
    }
  }

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      let freshRisk: Risk | null = null

      try {
        const savedRisk = window.localStorage.getItem(savedRiskStorageKey)
        const storedStatus = window.localStorage.getItem(activeRiskStatusStorageKey) as ActiveRiskStatus | null
        const databaseSavedRiskId = window.localStorage.getItem(databaseSavedRiskIdStorageKey)

        if (storedStatus === 'none' || (!savedRisk && databaseSavedRiskId && storedStatus !== 'draft')) {
          setActiveRiskStatus('none')
          setJsonText('')
          setJsonError('')
          setDirty(false)
          setSaveState('idle')
          setRiskIdStatus('idle')
          setIsInitialized(true)
          return
        }

        if (!savedRisk) {
          freshRisk = createFreshRiskDraft()
        } else {
          const savedValue = JSON.parse(savedRisk) as Record<string, unknown>
          const savedRiskId = typeof savedValue.risk_id === 'string' ? savedValue.risk_id.trim() : ''

          if (savedRiskId) {
            const loadedRisk = syncAlertFromBasic(normalizeRisk(savedValue))
            if (cancelled) return
            if (databaseSavedRiskId === savedRiskId || storedStatus === 'existing-database') {
              setActiveRiskStatus('existing-database')
              setDatabaseStoredRiskIds(current => new Set(current).add(savedRiskId))
            } else {
              setActiveRiskStatus('draft')
            }
            setRisk(loadedRisk)
            setJsonText(toJson(loadedRisk))
            setJsonError('')
            setDirty(false)
            setSaveState('saved')
            setRiskIdStatus('verified')
            setIsInitialized(true)
            return
          }

          const normalizedSavedRisk = normalizeRisk({ ...savedValue, risk_id: '__PENDING__' })
          freshRisk = syncAlertFromBasic({ ...normalizedSavedRisk, risk_id: '', sender: { ...normalizedSavedRisk.sender, risk_id: '' } })
        }
      } catch {
        try {
          window.localStorage.removeItem(savedRiskStorageKey)
          window.localStorage.removeItem(savedJsonStorageKey)
          window.localStorage.removeItem(savedRiskTimestampKey)
        } catch {
          // Ignore storage failures and keep the fresh in-memory risk.
        }
        freshRisk = createFreshRiskDraft()
      }

      if (cancelled || !freshRisk) return
      setActiveRiskStatus('draft')
      syncJson(freshRisk)
      await assignUniqueRiskId(freshRisk)
      if (!cancelled) setIsInitialized(true)
    }

    void initialize()

    return () => {
      cancelled = true
      riskIdRequestTokenRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!isInitialized || activeRiskStatus !== 'draft' || !dirty || isGeneratingRiskId) return

    const timeout = window.setTimeout(() => {
      const validation = riskSchema.safeParse(riskRef.current)
      if (!validation.success) return

      setSaveState('saving')
      const normalizedRisk = syncAlertFromBasic(normalizeRisk(validation.data))

      try {
        window.localStorage.setItem(savedRiskStorageKey, JSON.stringify(normalizedRisk))
        window.localStorage.setItem(savedJsonStorageKey, toJson(normalizedRisk))
        window.localStorage.setItem(savedRiskTimestampKey, new Date().toISOString())
        window.localStorage.setItem(activeRiskStatusStorageKey, 'draft')
        setRisk(normalizedRisk)
        setJsonText(toJson(normalizedRisk))
        setJsonError('')
        setDirty(false)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, autosaveDelayMs)

    return () => window.clearTimeout(timeout)
  }, [activeRiskStatus, dirty, isGeneratingRiskId, isInitialized, risk])

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
  const commitDetailSections = (sections: RiskDetailSection[]) => commitFormRisk({ ...risk, details: { ...risk.details, sections, section_title: sections[0]?.title || '', underlying_exposure: sections.flatMap(section => section.items).filter(item => item.trim().length > 0) } })
  const updateSectionTitle = (index: number, title: string) => commitDetailSections(risk.details.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, title, key: createUniqueSectionKey(title, risk.details.sections, index) } : section))
  const updateSectionItem = (sectionIndex: number, itemIndex: number, value: string) => commitDetailSections(risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: section.items.map((item, currentItemIndex) => currentItemIndex === itemIndex ? value : item) } : section))
  const addSectionItem = (sectionIndex: number) => commitDetailSections(risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: [...section.items, ''] } : section))
  const removeSectionItem = (sectionIndex: number, itemIndex: number) => commitDetailSections(risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: section.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex) } : section))
  const moveSectionItem = (sectionIndex: number, itemIndex: number, direction: number) => commitDetailSections(risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: move(section.items, itemIndex, direction) } : section))
  const duplicateSectionItem = (sectionIndex: number, itemIndex: number) => commitDetailSections(risk.details.sections.map((section, index) => index === sectionIndex ? { ...section, items: [...section.items.slice(0, itemIndex + 1), section.items[itemIndex], ...section.items.slice(itemIndex + 1)] } : section))
  const addSection = () => commitDetailSections([...risk.details.sections, { key: '', title: '', items: [''], uiId: createSectionUiId() }])
  const removeSection = (index: number) => commitDetailSections(risk.details.sections.filter((_, sectionIndex) => sectionIndex !== index))
  const moveSection = (index: number, direction: number) => commitDetailSections(move(risk.details.sections, index, direction))
  const duplicateSection = (index: number) => {
    const section = { ...risk.details.sections[index], items: [...risk.details.sections[index].items], key: '', uiId: createSectionUiId() }
    const nextSections = [...risk.details.sections.slice(0, index + 1), section, ...risk.details.sections.slice(index + 1)]
    nextSections[index + 1] = { ...section, key: createUniqueSectionKey(section.title, nextSections, index + 1) }
    commitDetailSections(nextSections)
  }
  const commitImpact = (impact: string[]) => commitFormRisk({ ...risk, details: { ...risk.details, impact } })
  const addMetric = () => {
    const newMetric: RiskMetric = { key: '', label: '', value: '', raw_value: '', type: 'text', highlight: false }
    update('metrics', [...risk.metrics, newMetric])
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
  const mitigationSteps: MitigationStep[] = Array.isArray(risk.mitigation) ? risk.mitigation : risk.mitigation?.steps || []
  const updateMitigationSteps = (steps: MitigationStep[]) => update(Array.isArray(risk.mitigation) ? 'mitigation' : 'mitigation.steps', steps.map((step, index) => ({ ...step, step: index + 1 })))
  const addMitigation = () => updateMitigationSteps([...mitigationSteps, { step: mitigationSteps.length + 1, title: '', description: '', owner: '' }])
  const patchMitigation = (i: number, patch: Partial<MitigationStep>) => updateMitigationSteps(mitigationSteps.map((step, index) => index === i ? { ...step, ...patch } : step))
  const actionButton = (label: string, onClick: () => void) => <button aria-label={label} title={label} onClick={onClick} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><GripVertical className="size-3.5" /></button>

  const formPanel = <div className="flex flex-col gap-4">
    <Section title="Risk Information">
      <div>
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Basic Information</h3>
        <div className="grid gap-4 sm:grid-cols-2"><RiskIdField value={risk.risk_id} status={riskIdStatus} /><Field label="Industry Name" value={risk.industry_name} onChange={handleIndustryNameChange} /><Field label="Title" value={risk.title} onChange={handleTitleChange} /><SelectField label="Severity" value={risk.severity} options={['', 'low', 'medium', 'high', 'critical']} onChange={v => handleSeverityChange(v as Risk['severity'])} /><Field label="SKU" value={risk.entity.id} inputMode="numeric" pattern="[0-9]*" onChange={v => updateEntity('id', v.replace(/\D/g, ''))} /><Field label="Product" value={risk.entity.name} onChange={v => updateEntity('name', v)} /><div className="sm:col-span-2"><TextArea label="Summary" value={risk.summary} onChange={v => update('summary', v)} /></div></div>
      </div>
      <div className="mt-7 border-t border-slate-200 pt-7">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Metrics</h3>
        <div className="flex flex-col gap-3">{risk.metrics.map((metric, i) => <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Metric {i + 1}</span><div className="flex items-center gap-1"><button onClick={() => update('metrics', move(risk.metrics, i, -1))} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronUp className="size-4" /></button><button onClick={() => update('metrics', move(risk.metrics, i, 1))} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronDown className="size-4" /></button><button onClick={() => duplicateMetric(i)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button onClick={() => removeMetric(i)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Label" value={metric.label} placeholder="Metric label" onChange={v => handleMetricLabelChange(i, v)} /><div><Field label="Raw Value" value={metric.raw_value} placeholder="Enter value" onChange={v => handleMetricRawValueChange(i, v)} />{metricRawValueError(metric.raw_value, metric.type) && <p className="mt-1 text-xs text-red-600">{metricRawValueError(metric.raw_value, metric.type)}</p>}</div><SelectField label="Type" value={metric.type} options={['currency', 'number', 'percentage', 'text']} onChange={v => handleMetricTypeChange(i, v as RiskMetric['type'])} /><label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={metric.highlight} onChange={e => patchMetric(i, { highlight: e.target.checked })} className="size-4 accent-slate-900" />Highlight metric</label></div></div>)}<Button onClick={addMetric}><Plus className="size-3.5" />Add Metric</Button></div>
      </div>
    </Section>
    <Section title="Risk Context">
      <div>
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Risk Details</h3>
        <DetailSectionsEditor sections={risk.details.sections} onTitleChange={updateSectionTitle} onItemChange={updateSectionItem} onAddItem={addSectionItem} onRemoveItem={removeSectionItem} onMoveItem={moveSectionItem} onDuplicateItem={duplicateSectionItem} onAddSection={addSection} onRemoveSection={removeSection} onMoveSection={moveSection} onDuplicateSection={duplicateSection} />
      </div>
      <div className="mt-7 border-t border-slate-200 pt-7">
        <h3 className="mb-4 text-sm font-semibold text-slate-900">Impact</h3>
        <div className="flex flex-col gap-3">{risk.details.impact.map((item, i) => <div key={i} className="flex gap-2"><textarea className={`${inputClass} min-h-20`} value={item} onChange={e => commitImpact(risk.details.impact.map((value, index) => index === i ? e.target.value : value))} /><button onClick={() => commitImpact(risk.details.impact.filter((_, index) => index !== i))} className="self-start rounded-lg p-2 text-red-400 hover:bg-red-50"><Trash2 className="size-4" /></button></div>)}<Button onClick={() => commitImpact([...risk.details.impact, ''])}><Plus className="size-3.5" />Add Impact</Button></div>
      </div>
    </Section>
    <Section title="Mitigation Plan"><div className="flex flex-col gap-3">{mitigationSteps.map((step, i) => <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Step {i + 1}</span><div className="flex gap-1"><button onClick={() => updateMitigationSteps(move(mitigationSteps, i, -1))} className="p-1 text-slate-400"><ChevronUp className="size-4" /></button><button onClick={() => updateMitigationSteps(move(mitigationSteps, i, 1))} className="p-1 text-slate-400"><ChevronDown className="size-4" /></button><button onClick={() => updateMitigationSteps([...mitigationSteps.slice(0, i + 1), { ...step }, ...mitigationSteps.slice(i + 1)])} className="p-1 text-slate-400"><Copy className="size-3.5" /></button><button onClick={() => updateMitigationSteps(mitigationSteps.filter((_, index) => index !== i))} className="p-1 text-red-400"><Trash2 className="size-3.5" /></button></div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Title" value={step.title} placeholder="Enter mitigation step title" onChange={v => patchMitigation(i, { title: v })} /><Field label="Owner" value={step.owner} placeholder="Enter owner" onChange={v => patchMitigation(i, { owner: v })} /><div className="sm:col-span-2"><TextArea label="Description" value={step.description} placeholder="Enter description" onChange={v => patchMitigation(i, { description: v })} /></div></div></div>)}<Button onClick={addMitigation}><Plus className="size-3.5" />Add Step</Button></div></Section>
    <Section title="Assignment"><div className="grid gap-4 sm:grid-cols-2"><Field label="Owner" value={risk.assign.owner} onChange={v => update('assign.owner', v)} /><SelectField label="Status" value={risk.assign.status} options={['Unassigned', 'Assigned', 'In Progress', 'Resolved', 'Closed']} onChange={v => update('assign.status', v)} /></div></Section>
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
  const saveStatus = saveState === 'saving'
    ? <span className="text-xs font-medium text-slate-500">Saving...</span>
    : saveState === 'error'
      ? <span className="text-xs font-medium text-red-600">Unable to save locally</span>
      : dirty
        ? <span className="text-xs font-medium text-amber-600">Unsaved changes</span>
        : saveState === 'saved'
          ? <span className="text-xs font-medium text-emerald-600">Saved locally</span>
          : null
  const databaseButtonLabel = databaseSaveStatus === 'saving' && databaseSaveRiskId === risk.risk_id
    ? 'Adding...'
    : riskAlreadyInDatabase
      ? databaseSaveStatus === 'success' && databaseSaveRiskId === risk.risk_id ? 'Added to Database' : 'Already in Database'
      : 'Add to Database'
  const emptyState = <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm"><div className="max-w-md"><div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="size-5" /></div><h3 className="mt-4 text-lg font-bold text-slate-950">No active risk</h3><p className="mt-2 text-sm text-slate-500">Your previous risk has been added to the database. Start a new risk when ready.</p><Button primary className="mt-6 cursor-pointer" onClick={startNewRisk}><Plus className="size-3.5" />New Risk</Button></div></div>
  const builderContent = mode === 'database'
    ? <DatabaseRisksView risks={databaseRisks} selectedRisk={selectedDatabaseRisk} loading={databaseLoading} error={databaseError} onRefresh={() => { void fetchDatabaseRisks() }} onView={viewDatabaseRisk} onLoad={loadDatabaseRisk} />
    : activeRiskStatus === 'none'
      ? emptyState
      : mode === 'form'
        ? formJsonLayout
        : <div className="grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">{jsonPanel}<Preview risk={risk} /></div>

  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center overflow-hidden rounded-lg "><Image src="/image.png" alt="StratSync logo" width={36} height={36} className="size-9 object-contain" /></div><div><h1 className="text-lg font-bold tracking-tight">Risk JSON Builder</h1><p className="hidden text-xs text-slate-500 sm:block">By Stratsync.ai</p></div></div><div className="flex items-center gap-2"><label className="hidden cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 md:flex"><input type="checkbox" checked={devMode} onChange={e => setDevMode(e.target.checked)} className="size-4 cursor-pointer accent-slate-900 disabled:cursor-not-allowed" />Developer Mode</label>{activeRiskStatus === 'none' ? <Button primary className="cursor-pointer" onClick={startNewRisk}><Plus className="size-3.5" />New Risk</Button> : <><Button className="cursor-pointer disabled:cursor-not-allowed" disabled={!canAddToDatabase} onClick={() => { void addToDatabase() }}>{databaseSaveStatus === 'saving' && databaseSaveRiskId === risk.risk_id ? <Loader2 className="size-3.5 animate-spin" /> : riskAlreadyInDatabase ? <Check className="size-3.5" /> : <Database className="size-3.5" />}{databaseButtonLabel}</Button><Button className="cursor-pointer disabled:cursor-not-allowed" disabled={isGeneratingRiskId} onClick={resetRisk}>{isGeneratingRiskId ? <RefreshCw className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{isGeneratingRiskId ? 'Generating ID…' : 'Reset'}</Button></>}<ProfileMenu user={user} onSignOut={signOut} /></div></div></header><div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8"><div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="mb-2 flex min-h-4 items-center gap-2">{saveStatus}</div><h2 className="text-3xl font-bold tracking-tight text-slate-950">Risk JSON Builder</h2><p className="mt-1 text-sm text-slate-500">Build structured risk payloads visually or convert existing JSON into a readable risk view.</p></div><div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm"><button onClick={() => setMode('form')} className={`shrink-0 cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'form' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>Form → JSON</button><button onClick={() => setMode('json')} className={`shrink-0 cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'json' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>JSON → UI</button><button onClick={() => setMode('database')} className={`shrink-0 cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-200 ease-in-out ${mode === 'database' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>Database Risks</button></div></div>{builderContent}</div>{notice && <div className="fixed bottom-5 right-5 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl"><Check className="size-4 text-emerald-400" />{notice}</div>}</main>
}

export default function Page() {
  return <AuthGate><RiskJsonBuilder /></AuthGate>
}

function ListEditor({ title, items, onChange, onAdd, onRemove }: { title: string; items: string[]; onChange: (i: number, v: string) => void; onAdd: () => void; onRemove: (i: number) => void }) { return <div className="mt-5 flex flex-col gap-2"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">{title}</span><button onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Plus className="size-3" />Add</button></div>{items.map((item, i) => <div key={i} className="flex gap-2"><input className={inputClass} value={item} onChange={e => onChange(i, e.target.value)} /><button onClick={() => onRemove(i)} className="rounded-lg p-2 text-red-400 hover:bg-red-50"><X className="size-4" /></button></div>)}</div> }
function ExposureListEditor({ items, onChange, onMove, onDuplicate, onRemove, onAdd }: { items: string[]; onChange: (index: number, value: string) => void; onMove: (index: number, direction: number) => void; onDuplicate: (index: number) => void; onRemove: (index: number) => void; onAdd: () => void }) { return <div className="flex flex-col gap-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">Underlying Exposure</span><button onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Plus className="size-3" />Add Exposure Item</button></div>{items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No underlying exposure details provided.</p>}{items.map((item, index) => <div key={`exposure-${index}`} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Item {index + 1}</span><div className="flex items-center gap-1"><button type="button" aria-label={`Move exposure item ${index + 1} up`} onClick={() => onMove(index, -1)} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronUp className="size-4" /></button><button type="button" aria-label={`Move exposure item ${index + 1} down`} onClick={() => onMove(index, 1)} className="rounded p-1 text-slate-400 hover:bg-white"><ChevronDown className="size-4" /></button><button type="button" aria-label={`Duplicate exposure item ${index + 1}`} onClick={() => onDuplicate(index)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button type="button" aria-label={`Delete exposure item ${index + 1}`} onClick={() => onRemove(index)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div><textarea className={`${inputClass} min-h-24 resize-y`} value={item} onChange={event => onChange(index, event.target.value)} /></div>)}</div> }
function DetailSectionsEditor({ sections, onTitleChange, onItemChange, onAddItem, onRemoveItem, onMoveItem, onDuplicateItem, onAddSection, onRemoveSection, onMoveSection, onDuplicateSection }: { sections: RiskDetailSection[]; onTitleChange: (index: number, title: string) => void; onItemChange: (sectionIndex: number, itemIndex: number, value: string) => void; onAddItem: (sectionIndex: number) => void; onRemoveItem: (sectionIndex: number, itemIndex: number) => void; onMoveItem: (sectionIndex: number, itemIndex: number, direction: number) => void; onDuplicateItem: (sectionIndex: number, itemIndex: number) => void; onAddSection: () => void; onRemoveSection: (index: number) => void; onMoveSection: (index: number, direction: number) => void; onDuplicateSection: (index: number) => void }) {
  return <div className="flex flex-col gap-4">
    {sections.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">No risk detail sections added.</p>}
    {sections.map((section, sectionIndex) => <div key={section.uiId || `section-${sectionIndex}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-4 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Section {sectionIndex + 1}</span><div className="flex items-center gap-1"><button type="button" aria-label={`Move section ${sectionIndex + 1} up`} disabled={sectionIndex === 0} onClick={() => onMoveSection(sectionIndex, -1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronUp className="size-4" /></button><button type="button" aria-label={`Move section ${sectionIndex + 1} down`} disabled={sectionIndex === sections.length - 1} onClick={() => onMoveSection(sectionIndex, 1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronDown className="size-4" /></button><button type="button" aria-label={`Duplicate section ${sectionIndex + 1}`} onClick={() => onDuplicateSection(sectionIndex)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button type="button" aria-label={`Delete section ${sectionIndex + 1}`} onClick={() => onRemoveSection(sectionIndex)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div>
      <Field label="Section Title" value={section.title} placeholder="Enter section title" onChange={value => onTitleChange(sectionIndex, value)} />
      <div className="mt-4 flex flex-col gap-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-600">Bullet Items</span><button type="button" onClick={() => onAddItem(sectionIndex)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Plus className="size-3" />Add Item</button></div>{section.items.map((item, itemIndex) => <div key={`${section.uiId || `section-${sectionIndex}`}-item-${itemIndex}`} className="flex gap-2"><div className="flex min-w-0 flex-1 items-start gap-2"><span className="pt-2.5 text-xs font-bold text-slate-400">{itemIndex + 1}.</span><textarea className={`${inputClass} min-h-20 resize-y`} value={item} placeholder="Enter detail" onChange={event => onItemChange(sectionIndex, itemIndex, event.target.value)} /></div><div className="flex shrink-0 items-start gap-1"><button type="button" aria-label="Move item up" disabled={itemIndex === 0} onClick={() => onMoveItem(sectionIndex, itemIndex, -1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronUp className="size-4" /></button><button type="button" aria-label="Move item down" disabled={itemIndex === section.items.length - 1} onClick={() => onMoveItem(sectionIndex, itemIndex, 1)} className="rounded p-1 text-slate-400 enabled:hover:bg-white disabled:opacity-30"><ChevronDown className="size-4" /></button><button type="button" aria-label="Duplicate item" onClick={() => onDuplicateItem(sectionIndex, itemIndex)} className="rounded p-1 text-slate-400 hover:bg-white"><Copy className="size-3.5" /></button><button type="button" aria-label="Delete item" onClick={() => onRemoveItem(sectionIndex, itemIndex)} className="rounded p-1 text-red-400 hover:bg-red-50"><Trash2 className="size-3.5" /></button></div></div>)}</div>
    </div>)}
    <Button primary onClick={onAddSection}><Plus className="size-3.5" />Add Section</Button>
  </div>
}
function JsonPanel({ jsonText, setJsonText, error, onParse, onCopy, onDownload, onFormat }: { jsonText: string; setJsonText: (v: string) => void; error: string; onParse: () => void; onCopy: () => void; onDownload: () => void; onFormat: () => void }) { return <div className="flex max-h-[calc(100vh-32px)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold">JSON Editor</h3><p className="mt-0.5 text-xs text-slate-500">Edit the payload directly or use the form.</p></div><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span className={`size-1.5 rounded-full ${error ? 'bg-red-500' : 'bg-emerald-500'}`} />{error ? 'Invalid JSON' : 'Valid JSON'}</span></div><div className="relative"><textarea aria-label="Risk JSON editor" value={jsonText} onChange={e => setJsonText(e.target.value)} className="min-h-[400px] max-h-[calc(100vh-220px)] w-full overflow-y-auto resize-none rounded-lg border border-slate-800 bg-[#17202b] p-4 font-mono text-xs leading-6 text-slate-200 outline-none focus:ring-2 focus:ring-slate-300" spellCheck={false} />{error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}</div><div className="flex flex-wrap gap-2"><Button primary className="cursor-pointer" onClick={onParse}><Upload className="size-3.5" />Parse JSON</Button><Button className="cursor-pointer" onClick={onFormat}><Check className="size-3.5" />Format</Button><Button className="cursor-pointer" onClick={onCopy}><Copy className="size-3.5" />Copy</Button><Button className="cursor-pointer" onClick={onDownload}><Download className="size-3.5" />Download</Button></div></div> }
