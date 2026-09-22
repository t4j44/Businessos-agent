// Compatibility shim — the product MetricCard lives in ui/.
// Keep this path so any lingering dashboard imports resolve to the same component.
export { MetricCard, type MetricCardProps, type MetricState, type MetricRow } from '@/components/ui/MetricCard'
export { default } from '@/components/ui/MetricCard'
