import { NextResponse } from 'next/server';
import { runCallCenter } from '../route';

import { TEST_CLIENT_ID } from '@/lib/client-config';
import { notFoundInProduction } from '@/lib/auth-guard'

const FAKE_TRANSCRIPT =
  'Caller: Hi, what are your hours? Agent: We\'re open Monday to Friday, 9 to 6. ' +
  'Caller: Perfect, thank you! Agent: You\'re welcome, have a great day!';

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
    // Mode A — generate the call script.
    const scriptResult = await runCallCenter(TEST_CLIENT_ID);

    // Mode B — analyze a fake transcript.
    const analysisResult = await runCallCenter(TEST_CLIENT_ID, FAKE_TRANSCRIPT);

    return NextResponse.json({
      mode_a_script: { status: scriptResult.status, ...scriptResult.body },
      mode_b_analysis: { status: analysisResult.status, ...analysisResult.body },
    });
  } catch (err: any) {
    console.error('[call-center/test] failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
