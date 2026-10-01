import { notFound } from 'next/navigation'
import { isProduction } from '@/lib/auth-guard'

// Production gate for the diagnostic pages under /test (/test and /test/widget).
//
// The /api/*/test ROUTES already 404 in production via notFoundInProduction().
// The pages that drive them did not: they were only session-gated by
// middleware, so any signed-in customer could open an internal test harness.
//
// The guard lives in a layout rather than in the pages because /test/page.tsx
// is a client component — it cannot read VERCEL_ENV, and notFound() has to run
// on the server. A layout is a server component by default and wraps every
// route beneath it, so one file covers both pages and any added later.
//
// 404 rather than 403, matching notFoundInProduction(): a forbidden response
// would confirm the page exists.
export const dynamic = 'force-dynamic'

export default function TestLayout({ children }: { children: React.ReactNode }) {
  if (isProduction()) notFound()
  return <>{children}</>
}
