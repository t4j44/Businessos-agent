import React from 'react'

// Loading placeholders shaped like the content that is coming.
//
// WHY NOT A SPINNER: a spinner says "something is happening somewhere". A
// skeleton says "four metric cards and a twelve-row table are about to appear
// here", and the layout does not jump when they do. The perceived wait is
// shorter for the same real wait, which is the cheapest speed improvement
// available — it costs no network and no compute.
//
// The shimmer is optional. The shape is not. A skeleton that is not the same
// size as its content is worse than a spinner, because it moves twice.
//
// Reduced motion is respected two ways: `motion-safe:` keeps the shimmer out of
// the markup entirely for those users, and globals.css also clamps every
// animation duration under the same media query.

function Shimmer() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -translate-x-full motion-safe:animate-shimmer
                 bg-gradient-to-r from-transparent via-white/[.035] to-transparent"
    />
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span className={`relative block overflow-hidden rounded bg-raised ${className}`}>
      <Shimmer />
    </span>
  )
}

/** Matches MetricCard: same border, radius, padding and internal rhythm. */
export function SkeletonCard({ rows = 0, className = '' }: { rows?: number; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-line bg-gradient-to-b from-raised to-surface p-5 shadow-lightcatch ${className}`}
      aria-hidden="true"
    >
      <Skeleton className="h-3 w-24" />
      {/* Height matches text-figure (2.9rem / line-height 1). */}
      <Skeleton className="mt-3 h-[2.9rem] w-28" />
      {rows > 0 && (
        <div className="mt-4 space-y-2 border-t border-line-soft pt-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** One list row: leading block, two stacked lines, trailing value. */
export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0 ${className}`}
      aria-hidden="true"
    >
      <Skeleton className="h-8 w-8 flex-shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-3 w-14 flex-shrink-0" />
    </div>
  )
}

/**
 * A table placeholder with the real column count, so the header does not shift
 * sideways when the data lands.
 */
export function SkeletonTable({
  rows = 6,
  cols = 4,
  className = '',
}: { rows?: number; cols?: number; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-line bg-surface ${className}`}
      aria-hidden="true"
    >
      <div
        className="grid gap-4 border-b border-line bg-raised px-4 py-2.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 w-16" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-4 border-b border-line-soft px-4 py-3.5 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? 'w-4/5' : 'w-2/3'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * In-flight indicator for a button.
 *
 * NOT a skeleton, deliberately: there is no incoming content to be shaped like,
 * and a button cannot be replaced by a placeholder while the user is looking at
 * the thing they just pressed. It is also not a spinner — nothing rotates. Three
 * dots breathing in sequence reads as "working" without the barber-pole effect
 * that makes a wait feel longer than it is.
 */
export function Pending({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={`inline-flex items-center gap-[3px] ${className}`}
    >
      <span className="h-1 w-1 rounded-full bg-current opacity-40 motion-safe:animate-pulse" />
      <span className="h-1 w-1 rounded-full bg-current opacity-40 motion-safe:animate-pulse [animation-delay:160ms]" />
      <span className="h-1 w-1 rounded-full bg-current opacity-40 motion-safe:animate-pulse [animation-delay:320ms]" />
    </span>
  )
}

export default Skeleton
