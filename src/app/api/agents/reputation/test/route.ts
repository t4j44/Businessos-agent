import { NextResponse } from 'next/server';
import { runReputation } from '../route';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

export async function GET() {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    // Review 1 — positive (5 stars, Google).
    const positive = await runReputation({
      client_id: TEST_CLIENT_ID,
      platform: 'Google',
      rating: 5,
      review_text:
        'Absolutely incredible service! Sarah went above and beyond to help me. ' +
        'The team was responsive and professional. Highly recommend!',
      reviewer_name: 'Test Reviewer',
    });

    // Review 2 — negative (2 stars, Yelp).
    const negative = await runReputation({
      client_id: TEST_CLIENT_ID,
      platform: 'Yelp',
      rating: 2,
      review_text:
        'Waited 45 minutes past my appointment with no communication. ' +
        'The staff seemed disorganized. Very disappointing.',
      reviewer_name: 'Test Reviewer',
    });

    return NextResponse.json({
      positive_review: { status: positive.status, ...positive.body },
      negative_review: { status: negative.status, ...negative.body },
    });
  } catch (err: any) {
    console.error('[reputation/test] failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
