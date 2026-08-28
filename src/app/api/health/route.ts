import { NextResponse } from 'next/server';
import { AGENTS } from '@/lib/agent-catalog';

// GET /api/health — liveness probe for uptime monitoring and deploy checks.
//
// Deliberately dependency-free: it touches no database and no third-party API,
// so a red health check means the deployment itself is down rather than a
// downstream provider having a bad day.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      // Read from the catalog so this cannot drift as agents are added.
      agents: AGENTS.length,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
