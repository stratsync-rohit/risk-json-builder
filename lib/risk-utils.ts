import { z } from 'zod'
import type { MitigationStep, Risk } from '@/types/risk'

const strings = z.array(z.unknown()).default([]).transform(values => values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim()))
const metric = z.object({ key: z.string().default(''), label: z.string().default(''), value: z.string().default(''), raw_value: z.union([z.string(), z.number()]).default(''), type: z.enum(['currency', 'number', 'percentage', 'text']).default('text'), highlight: z.boolean().default(false) }).passthrough()
const entity: z.ZodTypeAny = z.object({ type: z.string().default(''), id: z.string().default(''), name: z.string().default(''), secondary: z.lazy(() => entity).optional() }).passthrough()
const step = z.object({ step: z.number().default(1), title: z.string().optional(), description: z.string().optional(), owner: z.string().optional() }).passthrough()
const detailSection = z.object({ key: z.string().default(''), title: z.string().default(''), items: z.array(z.string()).default([]) }).passthrough()

export const riskSchema = z.object({
  risk_id: z.string().min(1, 'Risk ID is required.'), title: z.string().min(1, 'Title is required.'), severity: z.enum(['low', 'medium', 'high', 'critical']), summary: z.string().min(1, 'Summary is required.'),
  card_id: z.string().default(''), industry_slug: z.string().default(''), industry_name: z.string().default(''), severity_label: z.string().default(''), subtitle: z.string().default(''),
  sender: z.object({ name: z.string().default(''), source: z.string().default(''), risk_id: z.string().default(''), timestamp: z.string().default('') }).default({ name: '', source: '', risk_id: '', timestamp: '' }), entity: entity.default({ type: '', id: '', name: '' }), metrics: z.array(metric).default([]),
  details: z.object({ section_title: z.string().default(''), items: z.array(z.object({ label: z.string().default(''), value: z.string().default('') }).passthrough()).default([]), underlying_exposure: strings, impact: z.array(z.string()).default([]), sections: z.array(detailSection).default([]) }).default({ section_title: '', items: [], underlying_exposure: [], impact: [], sections: [] }),
  mitigation: z.object({ summary: z.string().default(''), steps: z.array(step).default([]), last_updated: z.string().default(''), next_action: z.string().default('') }).default({ summary: '', steps: [], last_updated: '', next_action: '' }), actions: z.preprocess(value => Array.isArray(value) ? value.map(action => typeof action === 'string' ? { label: action } : action) : [], z.array(z.record(z.string(), z.unknown()))), detected_time: z.string().default(''), is_active: z.boolean().default(true), status: z.string().default('active'), _id: z.string().optional(), created_at: z.string().optional(), updated_at: z.string().optional(),
}).passthrough().superRefine((risk, context) => {
  const riskEntity = risk.entity as { type: string; id: string }
  if (riskEntity.type === 'sku' && !/^\d+$/.test(riskEntity.id)) {
    context.addIssue({ code: 'custom', path: ['entity', 'id'], message: 'SKU must contain numbers only.' })
  }
})

const now = '2026-08-27T04:01:55.261Z'
export const sampleRisk: Risk = { risk_id: 'RSK-21132-0472', card_id: 'revenue-to-cover', industry_slug: 'distribution-trading', industry_name: 'Distribution & Trading', title: 'Potential To-Cover Risk Discovered', severity: 'high', severity_label: 'High', subtitle: 'SKU 21132 · Burberry XYZ Perfume for Men', summary: 'Pending sales orders have increased over the last few weeks, and current stock plus consignment plus confirmed PO cover is not enough to meet these pending sales orders.', sender: { name: 'StratSync Risk Monitor', source: 'Potential To-Cover Alert', risk_id: 'RSK-21132-0472', timestamp: '09:42 AM IST', context: 'Potential To-Cover Alert' }, entity: { type: 'sku', id: '21132', name: 'Burberry XYZ Perfume for Men' }, sku: '21132', product: 'Burberry XYZ Perfume for Men', metrics: [{ key: 'revenue_at_risk', label: 'Revenue at Risk', value: '$130,000', raw_value: 130000, type: 'currency', highlight: true }, { key: 'customers_impacted', label: 'Customers Impacted', value: '5', raw_value: 5, type: 'number', highlight: false }, { key: 'tier_1_customers', label: 'Tier 1 Customers Impacted', value: '3', raw_value: 3, type: 'number', highlight: true }, { key: 'item_keyness', label: 'Item Keyness', value: 'High', raw_value: 'High', type: 'text', highlight: false }], details: { section_title: 'ITEM-LEVEL DETAILS', items: [{ label: 'Demand signal', value: 'Pending sales orders exceed available inventory and confirmed supply.' }, { label: 'Cover position', value: 'Current stock and consignment inventory cannot fully cover open demand.' }], underlying_exposure: [], impact: ['Open customer orders may miss requested delivery dates.', 'Tier 1 accounts could require priority allocation decisions.', 'Revenue recognition is exposed if the cover gap persists.'], sections: [{ key: 'item_level_details', title: 'ITEM-LEVEL DETAILS', items: ['Pending sales orders exceed available inventory and confirmed supply.', 'Current stock and consignment inventory cannot fully cover open demand.'] }] }, impact: ['Open customer orders may miss requested delivery dates.', 'Tier 1 accounts could require priority allocation decisions.', 'Revenue recognition is exposed if the cover gap persists.'], mitigation: { summary: 'Close the cover gap and protect priority customer commitments.', steps: [{ step: 1, title: 'Confirm cover gap', description: 'Validate current stock, consignment inventory, confirmed purchase orders and pending sales orders.', owner: 'Procurement' }, { step: 2, title: 'Check supplier availability', description: 'Confirm expedited replenishment options and lead times with suppliers.', owner: 'Category / Procurement Owner' }], last_updated: now, next_action: 'Confirm the cover gap with Procurement.' }, actions: [], detected_time: '09:42 AM IST', is_active: true, status: 'active', created_at: now, updated_at: now, alert: { risk_id: 'RSK-21132-0472', sku: '21132', product: 'Burberry XYZ Perfume for Men', severity: 'High severity', summary: 'Pending sales orders have increased over the last few weeks.' }, assign: { owner: 'Category Manager', status: 'Assigned' } }

const text = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : ''
const rec = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const textArray = (v: unknown) => Array.isArray(v) ? v.map(text).filter(Boolean) : []
function decorateMitigation(value: Risk['mitigation']) {
  if (Array.isArray(value) || !value || typeof value !== 'object') return value
  const object = value as Record<string, unknown> & { steps: unknown[] }
  Object.defineProperties(object, {
    length: { value: object.steps.length },
    map: { value: (fn: (item: unknown, index: number) => unknown) => object.steps.map(fn) },
    filter: { value: (fn: (item: unknown, index: number) => boolean) => object.steps.filter(fn) },
    slice: { value: (...args: number[]) => object.steps.slice(...args) },
    [Symbol.iterator]: { value: function* () { yield* object.steps } },
  })
  return object
}

/** Accepts the common schema and migrates the retired sku/product, alert, sections and array mitigation fields. */
export function normalizeRisk(input: unknown): Risk {
  const source = rec(input), oldDetails = rec(source.details), oldSender = rec(source.sender), oldEntity = rec(source.entity), oldMitigation = source.mitigation, mitigationRecord = rec(oldMitigation)
  const entityId = text(source.entity && rec(source.entity).id) || text(source.sku), entityName = text(source.entity && rec(source.entity).name) || text(source.product)
  const oldSections = Array.isArray(oldDetails.sections) ? oldDetails.sections : []
  const sectionItems = oldSections.flatMap(s => { const r = rec(s); return Array.isArray(r.items) ? r.items.map(text).filter(Boolean) : [] })
  const items = Array.isArray(oldDetails.items) ? oldDetails.items.map(i => { const r = rec(i); return { label: text(r.label), value: text(r.value) } }).filter(i => i.label || i.value) : []
  const canonicalExposure = textArray(oldDetails.underlying_exposure)
  const canonicalSectionItems = canonicalExposure.length ? canonicalExposure : items.map(item => item.value || item.label).filter(Boolean)
  const editorSections = oldSections.length ? oldSections : (text(oldDetails.section_title) || canonicalSectionItems.length ? [{ key: '', title: text(oldDetails.section_title), items: canonicalSectionItems }] : [])
  const detailImpact = Array.isArray(oldDetails.impact) ? oldDetails.impact.map(text) : []
  const impact = detailImpact.length ? detailImpact : textArray(source.impact)
  const stepsSource = Array.isArray(oldMitigation) ? oldMitigation : Array.isArray(mitigationRecord.steps) ? mitigationRecord.steps : []
  const parsed = riskSchema.parse({ ...source, sender: { name: text(oldSender.name) || 'StratSync Risk Monitor', source: text(oldSender.source) || text(oldSender.context), risk_id: text(oldSender.risk_id) || text(source.risk_id), timestamp: text(oldSender.timestamp) || text(source.detected_time), context: text(oldSender.context), }, entity: { type: text(oldEntity.type) || (entityId ? 'sku' : ''), id: entityId, name: entityName, secondary: oldEntity.secondary }, details: { section_title: text(oldDetails.section_title) || text(rec(oldSections[0]).title), items, underlying_exposure: textArray(oldDetails.underlying_exposure).length ? textArray(oldDetails.underlying_exposure) : sectionItems, impact, sections: oldSections }, mitigation: { summary: text(mitigationRecord.summary), steps: stepsSource.map((v, i) => { const r = rec(v); return { ...r, step: i + 1, title: text(r.title), description: text(r.description), owner: text(r.owner) } }), last_updated: text(mitigationRecord.last_updated) || text(source.updated_at), next_action: text(mitigationRecord.next_action) } }) as unknown as Risk
  return { ...structuredClone(sampleRisk), ...parsed, sender: { ...sampleRisk.sender, ...parsed.sender }, entity: { ...sampleRisk.entity, ...parsed.entity }, details: { ...sampleRisk.details, ...parsed.details, sections: editorSections }, mitigation: decorateMitigation({ ...sampleRisk.mitigation, ...parsed.mitigation }) } as Risk
}
export function toJson(risk: Risk) {
  const source = risk as unknown as Record<string, unknown>
  const details = risk.details || { section_title: '', items: [], underlying_exposure: [], impact: [] }
  const mitigation = Array.isArray(risk.mitigation) ? { summary: '', steps: risk.mitigation, last_updated: risk.updated_at || '', next_action: '' } : risk.mitigation
  const mitigationSteps = (mitigation?.steps || [])
    .filter((step: MitigationStep) => step.title.trim() || step.description.trim() || step.owner.trim())
    .map((step: MitigationStep, index: number) => ({ ...step, step: index + 1 }))
  const canonical = { risk_id: risk.risk_id, card_id: risk.card_id, industry_slug: risk.industry_slug, industry_name: risk.industry_name, title: risk.title, severity: risk.severity, severity_label: risk.severity_label, subtitle: risk.subtitle, summary: risk.summary, sender: { name: risk.sender?.name || '', source: risk.sender?.source || risk.sender?.context || '', risk_id: risk.sender?.risk_id || risk.risk_id, timestamp: risk.sender?.timestamp || risk.detected_time || '' }, entity: risk.entity, metrics: risk.metrics || [], details: { section_title: details.section_title || '', items: details.items || [], underlying_exposure: details.underlying_exposure || [], impact: (details.impact || []).filter(item => item.trim().length > 0) }, mitigation: { summary: mitigation?.summary || '', steps: mitigationSteps, last_updated: mitigation?.last_updated || '', next_action: mitigation?.next_action || '' }, actions: risk.actions || [], detected_time: risk.detected_time, is_active: risk.is_active, status: risk.status }
  void source
  return JSON.stringify(canonical, null, 2)
}
