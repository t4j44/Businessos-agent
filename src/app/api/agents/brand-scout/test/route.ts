import { NextResponse } from 'next/server';
import { runBrandScout } from '../route';

export async function GET() {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { status, body } = await runBrandScout(
      'https://stripe.com',
      '00000000-0000-0000-0000-000000000001',
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
