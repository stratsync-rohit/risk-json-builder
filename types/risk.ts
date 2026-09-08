export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type MetricType = 'currency' | 'number' | 'percentage' | 'text'
export type AssignmentStatus = 'Unassigned' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed'

export interface RiskMetric { key: string; label: string; value: string; raw_value: string | number; type: MetricType; highlight: boolean }
export interface RiskSender { name: string; context: string }
export interface RiskAlert { risk_id: string; sku: string; product: string; severity: string; summary: string }
export interface RiskDetailSection { key: string; title: string; items: string[] }
export interface RiskDetails { sections: RiskDetailSection[] }
export interface MitigationStep { step: number; title: string; description: string; owner: string }
export interface RiskAssignment { owner: string; status: AssignmentStatus }
export interface Risk {
  _id: string; risk_id: string; card_id: string; industry_slug: string; industry_name: string; title: string; severity: Severity; severity_label: string; sku: string; product: string; subtitle: string; summary: string; sender: RiskSender; alert: RiskAlert; metrics: RiskMetric[]; details: RiskDetails; impact: string[]; mitigation: MitigationStep[]; assign: RiskAssignment; detected_time: string; is_active: boolean; status: string; created_at: string; updated_at: string
}
export type RiskDraft = Omit<Risk, 'alert'> & { alert: RiskAlert }
