import React from 'react'

// The one metric card in the product.
//
// Every dashboard had grown its own stat block — same idea, six slightly
// different paddings, four different label sizes, three different ideas about
// what a delta looks like. That inconsistency is what makes a product read as
// assembled rather than designed.
//
// DEPTH: a top light-catch (`inset 0 1px 0 rgba(255,255,255,.045)`) and no drop
// shadow. On a dark ground a drop shadow has nothing to fall onto — it just
// makes the card look like a light card that was painted black. The 180°
// gradient from `raised` to `surface` does the rest: the card catches light at
// the top edge the way a physical panel would.
//
// No 'use client'. Nothing here has state or a handler, so it renders on the
// server and ships no JavaScript.

export type MetricState = 'good' | 'warn' | 'crit'

/** A secondary fact, shown under the figure. */
export type MetricRow = { label: string; value: string | number }

export interface MetricCardProps {
  label: string
  value: string | number
  /** e.g. "+12%" or "-3". Rendered in the semantic colour of `state`. */
  delta?: string
  /** Colours the delta and the header pill. Omit for a neutral card. */
  state?: MetricState
  /** Text for the header pill. Requires `state`; defaults to the delta. */
  pill?: string
  rows?: MetricRow[]
  /** Oldest → newest. Fewer than two points renders nothing. */
  series?: number[]
  /** 0–1. Renders a 2px accent bar across the bottom edge. */
  progress?: number
  className?: string
}

const STATE_TEXT: Record<MetricState, string> = {
  good: 'text-good',
  warn: 'text-warn',
  crit: 'text-crit',
}

// 9% background, 28% border — enough to read as a tinted chip, not enough to
// compete with the figure.
const STATE_PILL: Record<MetricState, string> = {
  good: 'bg-good/[.09] border-good/[.28] text-good',
  warn: 'bg-warn/[.09] border-warn/[.28] text-warn',
  crit: 'bg-crit/[.09] border-crit/[.28] text-crit',
}

const STATE_STROKE: Record<MetricState, string> = {
  good: 'rgb(var(--good))',
  warn: 'rgb(var(--warn))',
  crit: 'rgb(var(--crit))',
}

function Sparkline({ points, stroke, uid }: { points: number[]; stroke: string; uid: string }) {
  const width = 120
  const height = 34
  const pad = 3

  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1

  const x = (i: number) => (i / (points.length - 1)) * width
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - pad * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(' ')
  // Closed back along the baseline so the area fill has something to fill.
  const area = `${line} L${width},${height} L0,${height} Z`

  const lastX = x(points.length - 1)
  const lastY = y(points[points.length - 1])

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Two faint gridlines. They give the line something to be measured
          against without turning the sparkline into a chart. */}
      <line x1="0" y1={height / 3} x2={width} y2={height / 3}
            stroke="rgb(var(--line))" strokeWidth="1" />
      <line x1="0" y1={(height / 3) * 2} x2={width} y2={(height / 3) * 2}
            stroke="rgb(var(--line))" strokeWidth="1" />

      <path d={area} fill={`url(#spark-${uid})`} />
      <path d={line} stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />

      {/* The endpoint is the number that matters — a halo plus a solid dot so
          the eye lands on "now" rather than on the middle of the run. */}
      <circle cx={lastX} cy={lastY} r="4.5" fill={stroke} opacity="0.18" />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
    </svg>
  )
}

export function MetricCard({
  label,
  value,
  delta,
  state,
  pill,
  rows,
  series,
  progress,
  className = '',
}: MetricCardProps) {
  // SVG gradient ids must be unique within a document. Derived from the label
  // rather than useId() so this stays a server component.
  const uid = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const stroke = state ? STATE_STROKE[state] : 'rgb(var(--accent))'
  const pillText = pill ?? delta
  const hasSpark = Array.isArray(series) && series.length > 1

  return (
    <div
      className={
        // `glass` carries the frost, the bevel and the top light-catch; the
        // accent border and the 2px lift arrive on hover only, from
        // `glass-interactive`. A permanently lit border stops meaning anything.
        'glass glass-interactive relative overflow-hidden rounded-lg ' + className
      }
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="label-caps font-mono">{label}</p>
          {state && pillText && (
            <span
              className={
                'flex-shrink-0 rounded-full border px-2 py-0.5 font-mono text-[0.66rem] leading-4 ' +
                STATE_PILL[state]
              }
            >
              {pillText}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-display numeric text-figure text-text">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
            {delta && (
              <span className={`numeric text-sm font-medium ${state ? STATE_TEXT[state] : 'text-dim'}`}>
                {delta}
              </span>
            )}
          </div>

          {hasSpark && (
            <div className="flex-shrink-0 pb-1">
              <Sparkline points={series!} stroke={stroke} uid={uid} />
            </div>
          )}
        </div>

        {rows && rows.length > 0 && (
          <dl className="mt-4 space-y-1.5 border-t border-line-soft pt-3">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-[0.78rem] text-muted">{row.label}</dt>
                <dd className="numeric font-mono text-[0.78rem] text-text">
                  {typeof row.value === 'number' ? row.value.toLocaleString() : row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {typeof progress === 'number' && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line-soft">
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default MetricCard
