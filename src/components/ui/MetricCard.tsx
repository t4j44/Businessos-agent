'use client'

import React from 'react'
import { ArrowUpRight, ArrowDownRight, Minus, ArrowRight } from 'lucide-react'
import * as tokens from '@/lib/design-tokens'

export type TrendDirection = 'up' | 'down' | 'neutral'
export type MetricAccent = 'default' | 'primary' | 'success' | 'warning' | 'danger'

interface MetricCardProps {
  label: string
  value: string | number
  /** Direction of change vs last week. */
  trend?: TrendDirection
  /** Percentage change vs last week, e.g. 12 renders as"+12%". */
  trendValue?: number
  color?: MetricAccent
  onClick?: () => void
  /**
   * Optional sparkline series, oldest → newest. Not in the original prop list,
   * but a sparkline cannot be drawn without data.
   */
  sparkline?: number[]
}

const ACCENTS: Record<MetricAccent, string> = {
  default: 'text-[#F4F4F5]',
  primary: 'text-[#7C3AED]',
  success: 'text-[#10B981]',
  warning: 'text-[#F59E0B]',
  danger: 'text-[#EF4444]',
}

const TREND_STYLES: Record<TrendDirection, string> = {
  up: 'text-[#10B981]',
  down: 'text-[#EF4444]',
  neutral: 'text-[#71717A]',
}

const TREND_ICONS: Record<TrendDirection, React.ElementType> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  neutral: Minus,
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null

  const width = 72
  const height = 24
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1

  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width
      const y = height - ((p - min) / range) * height
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
      className="overflow-visible"
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MetricCard({
  label,
  value,
  trend,
  trendValue,
  color = 'default',
  onClick,
  sparkline,
}: MetricCardProps) {
  const clickable = typeof onClick === 'function'
  const TrendIcon = trend ? TREND_ICONS[trend] : null

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className={tokens.type.metricLabel}>{label}</p>
        {clickable && (
          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[#71717A] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#A1A1AA]" />
        )}
      </div>

      <p className={`mt-3 ${tokens.type.metric} ${ACCENTS[color]}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        {trend && TrendIcon ? (
          <div className={`flex items-center gap-1 ${TREND_STYLES[trend]}`}>
            <TrendIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-xs font-medium tabular-nums">
              {trendValue !== undefined
                ? `${trend === 'up' ? '+' : trend === 'down' ? '−' : ''}${Math.abs(trendValue)}%`
                : '—'}
            </span>
            <span className="text-xs text-[#71717A]">vs last week</span>
          </div>
        ) : (
          <span />
        )}

        {sparkline && sparkline.length > 1 && (
          <div className={`flex-shrink-0 ${trend ? TREND_STYLES[trend] : 'text-[#7C3AED]'}`}>
            <Sparkline points={sparkline} />
          </div>
        )}
      </div>
    </>
  )

  const base =
    'group w-full rounded-xl border border-[#1F1F23] bg-[#111113] p-5 text-left transition-colors duration-200'

  // Rendered as a real button when interactive, so it is keyboard accessible.
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} cursor-pointer hover:border-[#3F3F46] hover:bg-[#17171A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0B]`}
      >
        {content}
      </button>
    )
  }

  return <div className={base}>{content}</div>
}

export default MetricCard
