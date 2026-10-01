import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { readJsonBody, ValidationError, isUuid } from '@/lib/validation';
import { logAgentRun } from '@/lib/log';
import { serverError } from '@/lib/server-error'

// Publishing knowledge is a deliberate owner action; customer and research
// memory can never be exposed by changing this flag.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { clientId, userId } = await requireSession();
    const { id } = await params;
    const { visibility } = await readJsonBody(req);
    if (!isUuid(id) || !['internal', 'public'].includes(visibility)) {
      return NextResponse.json({ error: 'Choose internal or public visibility.' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.from('rag_chunks').update({
      visibility, approved_at: visibility === 'public' ? new Date().toISOString() : null,
      approved_by: visibility === 'public' ? userId : null,
    }).eq('id', id).eq('client_id', clientId).eq('is_active', true)
      .in('chunk_type', ['brand', 'faq', 'policy', 'service', 'knowledge']).select('id, visibility').maybeSingle();
    if (error) return NextResponse.json({ error: 'Knowledge visibility could not be saved.' }, { status: 503 });
    if (!data) return NextResponse.json({ error: 'Eligible knowledge not found.' }, { status: 404 });
    await logAgentRun({ client_id: clientId, agent_type: 'brand_scout', status: 'completed',
      output_summary: visibility === 'public' ? 'Owner approved knowledge for customer answers' : 'Owner made knowledge internal',
      metadata: { chunk_id: id, approved_by: userId, visibility } });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return authErrorResponse(error) ?? NextResponse.json({ error: 'Knowledge update failed.' }, { status: 503 });
  }
}

// Soft-delete a piece of brand memory. Rows are retained with is_active = false
// so nothing is permanently lost and retrieval simply stops matching them.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from('rag_chunks')
      .update({ is_active: false })
      .eq('id', id)
      // Ownership: a row belonging to another tenant must be
      // indistinguishable from one that does not exist.
      .eq('client_id', clientId)
      .select('id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error('[my-business/chunks] deactivate failed:', error.message);
      return serverError(error, 'my-business/chunks/[id]');
    }

    return NextResponse.json({ deleted: true, id: data.id });
  } catch (err: any) {
    console.error('[my-business/chunks] DELETE failed:', err);
    return serverError(err, 'my-business/chunks/[id]');
  }
}
