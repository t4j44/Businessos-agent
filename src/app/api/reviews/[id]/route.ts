import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// PATCH { action: 'approve' | 'save', response_text? }
// 'approve' marks the drafted response as published/approved.
// 'save' stores an edited response without changing approval state.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { action, response_text } = await req.json();

    if (!['approve', 'save'].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'approve' or 'save'." },
        { status: 400 },
      );
    }

    const patch: Record<string, any> = {};
    if (typeof response_text === 'string') patch.response_text = response_text;

    if (action === 'approve') {
      patch.responded = true;
      patch.response_method = 'approved';
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
      .select('id, responded, response_text')
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
    console.error('[reviews/:id] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
