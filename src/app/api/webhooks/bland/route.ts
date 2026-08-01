import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'GET webhooks/bland' });
}

export async function POST(req: Request) {
  return NextResponse.json({ message: 'POST webhooks/bland' });
}