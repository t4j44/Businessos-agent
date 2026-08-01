import { NextResponse } from 'next/server';

// The creative agent is not wired up yet. It answers honestly rather than
// pretending to generate, so the Content page can say so instead of faking a
// spinner and inventing posts.
const NOT_IMPLEMENTED = {
  error: 'The creative agent is not configured yet — no posts were generated.',
};

export async function GET() {
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}

export async function POST() {
  return NextResponse.json(NOT_IMPLEMENTED, { status: 501 });
}
