import { NextResponse } from 'next/server';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { analyzeStoredCall } from '@/lib/call-analysis';
import { AgentRuntimeError } from '@/lib/agent-runtime';
import { isUuid } from '@/lib/validation';

export const maxDuration = 60;
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { clientId } = await requireSession();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = await analyzeStoredCall(clientId,id);
    if (result.outcome==='not_found') return NextResponse.json({ error:'Not found' },{ status:404 });
    if (!['claimed','completed'].includes(result.outcome)) return NextResponse.json({ error: result.outcome === 'missing_transcript'
      ? 'There is no usable transcript to analyze.' : result.outcome === 'retry_limit' ? 'This call reached its retry limit. Operator review is required.' : 'This call is already being analyzed.' },{status:409});
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error instanceof AgentRuntimeError ? error.message : 'Call analysis unavailable.' }, { status: error instanceof AgentRuntimeError ? error.status : 503 });
  }
}
