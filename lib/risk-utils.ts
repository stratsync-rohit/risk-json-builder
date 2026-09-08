import { z } from 'zod'
import type { Risk, RiskDraft } from '@/types/risk'

const nonEmptyStrings = z.array(z.unknown()).default([]).transform(values => values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim()))
const detailSectionSchema = z.object({ key: z.string(), title: z.string(), items: nonEmptyStrings })

export const riskSchema = z.object({
  risk_id: z.string().min(1, 'Risk ID is required.'), title: z.string().min(1, 'Title is required.'), severity: z.enum(['low', 'medium', 'high', 'critical']), sku: z.string().min(1, 'SKU is required.'), product: z.string().min(1, 'Product is required.'), summary: z.string().min(1, 'Summary is required.'),
  metrics: z.array(z.record(z.string(), z.unknown())).default([]), impact: z.array(z.string()).default([]), mitigation: z.array(z.record(z.string(), z.unknown())).default([]),
  details: z.object({ sections: z.array(detailSectionSchema).default([]) }).default({ sections: [] }),
}).passthrough()

const now = '2026-08-27T04:01:55.261Z'
export const sampleRisk: Risk = {
  _id: '6a8fb6b3b5220351c08edf1f', risk_id: 'RSK-21132-0472', card_id: 'revenue-to-cover', industry_slug: 'distribution-trading', industry_name: 'Distribution & Trading', title: 'Potential To-Cover Risk Discovered', severity: 'high', severity_label: 'High', sku: '21132', product: 'Burberry XYZ Perfume for Men', subtitle: 'SKU 21132 · Burberry XYZ Perfume for Men', summary: 'Pending sales orders have increased over the last few weeks, and current stock plus consignment plus confirmed PO cover is not enough to meet these pending sales orders.', sender: { name: 'StratSync Risk Monitor', context: 'Potential To-Cover Alert' }, alert: { risk_id: 'RSK-21132-0472', sku: '21132', product: 'Burberry XYZ Perfume for Men', severity: 'High severity', summary: 'Pending sales orders have increased over the last few weeks, and current stock plus consignment plus confirmed PO cover is not enough to meet these pending sales orders.' }, metrics: [{ key: 'revenue_at_risk', label: 'Revenue at Risk', value: '$130,000', raw_value: 130000, type: 'currency', highlight: true }, { key: 'customers_impacted', label: 'Customers Impacted', value: '5', raw_value: 5, type: 'number', highlight: false }, { key: 'tier_1_customers', label: 'Tier 1 Customers', value: '3', raw_value: 3, type: 'number', highlight: true }, { key: 'item_keyness', label: 'Item Keyness', value: 'High', raw_value: 'High', type: 'text', highlight: false }], details: { sections: [{ key: 'underlying_exposure', title: 'Underlying Exposure', items: ['Pending sales orders exceed available inventory and confirmed supply.', 'Current stock and consignment inventory cannot fully cover open demand.', 'Tier 1 customer commitments may be delayed.', 'There is no remaining buffer for unexpected demand or supply disruption.'] }] }, impact: ['Open customer orders may miss requested delivery dates.', 'Tier 1 accounts could require priority allocation decisions.', 'Revenue recognition is exposed if the cover gap persists.'], mitigation: [{ step: 1, title: 'Confirm cover gap', description: 'Validate current stock, consignment inventory, confirmed purchase orders and pending sales orders.', owner: 'Procurement' }, { step: 2, title: 'Check supplier availability', description: 'Confirm expedited replenishment options and lead times with suppliers.', owner: 'Category / Procurement Owner' }, { step: 3, title: 'Decide order prioritisation', description: 'Align allocation rules across strategic and standard customers.', owner: 'Category Manager' }, { step: 4, title: 'Prepare customer communication', description: 'Draft proactive updates for impacted accounts if required.', owner: 'Customer Success' }], assign: { owner: 'Category Manager', status: 'Assigned' }, detected_time: '09:42 AM IST', is_active: true, status: 'active', created_at: now, updated_at: now,
}

export function normalizeRisk(input: unknown): Risk {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const sourceDetails = source.details && typeof source.details === 'object' && !Array.isArray(source.details) ? source.details as Record<string, unknown> : {}
  const legacyExposure = ['demand_signal', 'cover_position', 'revenue_impact', 'service_risk'].map(key => sourceDetails[key]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const legacyItems = Array.isArray(sourceDetails.underlying_exposure) ? sourceDetails.underlying_exposure : legacyExposure
  const sourceSections = Array.isArray(sourceDetails.sections) ? sourceDetails.sections : legacyItems.length > 0 ? [{ key: 'underlying_exposure', title: 'Underlying Exposure', items: legacyItems }] : []
  const details = {
    sections: sourceSections.filter(section => section && typeof section === 'object' && !Array.isArray(section)).map(section => {
      const value = section as Record<string, unknown>
      return { key: typeof value.key === 'string' ? value.key : '', title: typeof value.title === 'string' ? value.title : '', items: Array.isArray(value.items) ? value.items : [] }
    }),
  }
  const parsed = riskSchema.parse({ ...source, details }) as unknown as Partial<Risk>
  const base = structuredClone(sampleRisk)
  const merged = { ...base, ...parsed, sender: { ...base.sender, ...(parsed.sender || {}) }, alert: { ...base.alert, ...(parsed.alert || {}) }, details: { ...base.details, ...(parsed.details || {}) }, assign: { ...base.assign, ...(parsed.assign || {}) } }
  merged.metrics = Array.isArray(parsed.metrics) ? parsed.metrics as Risk['metrics'] : []
  merged.impact = Array.isArray(parsed.impact) ? parsed.impact as string[] : []
  merged.mitigation = Array.isArray(parsed.mitigation) ? parsed.mitigation.map((step, index) => ({ ...step, step: index + 1 })) as Risk['mitigation'] : []
  return merged as Risk
}

export function toJson(risk: RiskDraft) { return JSON.stringify(risk, null, 2) }
