export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type MetricType = 'currency' | 'number' | 'percentage' | 'text'
export type AssignmentStatus = 'Unassigned' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed'
export interface RiskMetric { key: string; label: string; value: string; raw_value: string | number; type: MetricType; highlight: boolean }
export interface RiskSender { name: string; source: string; risk_id: string; timestamp: string; context: string }
export interface RiskEntity { type: string; id: string; name: string; secondary?: RiskEntity }
export interface RiskDetailItem { label: string; value: string }
export interface RiskDetailSection { key: string; title: string; items: string[]; uiId?: string }
export interface RiskDetails { section_title: string; items: RiskDetailItem[]; underlying_exposure: string[]; impact: string[]; sections: RiskDetailSection[] }
export interface MitigationStep { step: number; title: string; description: string; owner: string }
export interface RiskMitigation { summary: string; steps: MitigationStep[]; last_updated: string; next_action: string }
export interface RiskAction { label?: string; type?: string; url?: string; [key: string]: unknown }
export interface Risk {
  risk_id: string; card_id: string; industry_slug: string; industry_name: string; title: string; severity: Severity; severity_label: string; subtitle: string; summary: string;
  sender: RiskSender; entity: RiskEntity; metrics: RiskMetric[]; details: RiskDetails; mitigation: any; actions: RiskAction[];
  sku: string; product: string; impact: string[]; alert: { risk_id: string; sku: string; product: string; severity: string; summary: string }; assign: { owner: string; status: AssignmentStatus };
  detected_time: string; is_active: boolean; status: string; _id?: string; created_at: string; updated_at: string;
}
export type RiskDraft = Risk
