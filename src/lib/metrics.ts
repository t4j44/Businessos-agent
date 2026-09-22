import { supabaseAdmin } from './supabase';

export async function getBusinessMetrics(clientId: string, since: string, until = new Date().toISOString()) {
  const { data, error } = await supabaseAdmin.rpc('business_metrics', { p_client_id: clientId, p_since: since, p_until: until });
  if (error || !data) throw new Error('Business metrics are unavailable; a report was not generated.');
  return data;
}

/** Internal indicator, not validated ROI. No score when there is no evidence. */
export function operationalScore(metrics: any): number | null {
  const parts: Array<[number, number]> = [];
  if (metrics.calls.total > 0) parts.push([metrics.calls.resolved / metrics.calls.total, 300]);
  if (metrics.invoices.total > 0) parts.push([metrics.invoices.paid / metrics.invoices.total, 300]);
  if (metrics.reviews.total > 0) parts.push([metrics.reviews.responded / metrics.reviews.total, 200]);
  if (metrics.calls.avg_sentiment !== null && metrics.calls.avg_sentiment !== undefined) parts.push([metrics.calls.avg_sentiment / 100, 200]);
  if (!parts.length) return null;
  return Math.round(1000 * parts.reduce((sum, [value, weight]) => sum + Math.max(0, Math.min(1, value)) * weight, 0) / parts.reduce((sum, [, weight]) => sum + weight, 0));
}
