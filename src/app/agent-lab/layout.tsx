import { notFound } from 'next/navigation'
import { isProduction } from '@/lib/auth-guard'

// Production gate for /agent-lab. Same reasoning as src/app/test/layout.tsx:
// agent-lab/page.tsx is a client component, so the check has to run in a
// server component above it, and it 404s rather than 403s so the page's
// existence is not confirmed in production.
export const dynamic = 'force-dynamic'

export default function AgentLabLayout({ children }: { children: React.ReactNode }) {
  if (isProduction()) notFound()
  return <>{children}</>
}
