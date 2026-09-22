import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isUuid, readJsonBody, ValidationError } from '@/lib/validation';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// PATCH { action: 'approve' | 'save', response_text? }
// 'approve' approves a draft for manual publication; it does not publish.
// 'save' stores an edited response without changing approval state.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let clientId: string;
  let userId: string;
  try {
    ({ clientId, userId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { action, response_text } = await readJsonBody(req);
    if (!isUuid(id)) throw new ValidationError('Invalid review.');
    if (response_text !== undefined && (typeof response_text !== 'string' || response_text.length > 10000)) throw new ValidationError('Response must be text of at most 10,000 characters.');
    const { data: current, error: lookupError } = await supabaseAdmin.from('reviews').select('response_text, responded').eq('client_id', clientId).eq('id', id).maybeSingle();
    if (lookupError) return NextResponse.json({ error: 'Review unavailable.' }, { status: 503 });
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (current.responded) return NextResponse.json({ error: 'Edit a published reply on its original review platform.' }, { status: 409 });

    if (!['approve', 'save'].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'approve' or 'save'." },
        { status: 400 },
      );
    }

    const patch: Record<string, any> = {};
    if (typeof response_text === 'string') patch.response_text = response_text;

    if (action === 'approve') {
      if (!(response_text ?? current.response_text)?.trim()) throw new ValidationError('Generate or write a response first.');
      patch.response_method = 'approved_draft';
      patch.response_approved_at = new Date().toISOString();
      patch.response_approved_by = userId;
    }

    if (action === 'save') {
      patch.response_method = 'manual_draft';
      patch.response_approved_at = null;
      patch.response_approved_by = null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('reviews')
      .update(patch)
      .eq('id', id)
      // Ownership: a row belonging to another tenant must be
      // indistinguishable from one that does not exist.
      .eq('client_id', clientId)
      .select('id, responded, response_text, response_method, response_approved_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error('[reviews/:id] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: true, review: data });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[reviews/:id] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
