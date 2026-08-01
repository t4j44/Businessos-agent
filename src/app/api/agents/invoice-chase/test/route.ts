import { NextResponse } from 'next/server';
import { runInvoiceChase } from '../route';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

const FAKE_INVOICE = {
  customer_name: 'John Smith',
  amount_cents: 50000,
  invoice_number: 'INV-001',
};

export async function GET() {
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
