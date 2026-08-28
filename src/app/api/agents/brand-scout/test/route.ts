import { NextResponse } from 'next/server';
import { runBrandScout } from '../route';
import { TEST_CLIENT_ID } from '@/lib/client-config';
import { notFoundInProduction } from '@/lib/auth-guard'

export async function GET() {
  const blocked = notFoundInProduction()
  if (blocked) return blocked

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { status, body } = await runBrandScout(
      'https://stripe.com',
      TEST_CLIENT_ID,
    );
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[brand-scout/test] failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
