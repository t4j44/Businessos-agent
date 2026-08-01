import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'GET agents/callcenter' });
}

export async function POST(req: Request) {
  return NextResponse.json({ message: 'POST agents/callcenter' });
}