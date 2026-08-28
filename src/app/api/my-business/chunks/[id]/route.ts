import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true, id: data.id });
  } catch (err: any) {
    console.error('[my-business/chunks] DELETE failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
