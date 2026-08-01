import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'GET agents/enrichment/business-card' });
}

export async function POST(req: Request) {
  return NextResponse.json({ message: 'POST agents/enrichment/business-card' });
}