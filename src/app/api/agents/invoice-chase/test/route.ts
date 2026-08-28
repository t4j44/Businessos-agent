import { NextResponse } from 'next/server';
import { runInvoiceChase } from '../route';

import { TEST_CLIENT_ID } from '@/lib/client-config';
import { notFoundInProduction } from '@/lib/auth-guard'

const FAKE_INVOICE = {
  customer_name: 'John Smith',
  amount_due: 500.00,
  invoice_id: 'INV-001',
  days_overdue: 15,
};

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
    const messages = [];
    for (let step = 1; step <= 5; step++) {
      const result = await runInvoiceChase({
        client_id: TEST_CLIENT_ID,
        chase_step: step as 1 | 2 | 3 | 4 | 5,
        ...FAKE_INVOICE,
      });
      messages.push({ status: result.status, ...result.body });
    }

    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error('[invoice-chase/test] failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
