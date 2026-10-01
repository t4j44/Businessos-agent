import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError } from '@/lib/server-error'

const ALLOWED_STATUSES = new Set([
  'pending', 'emailed', 'replied', 'hot', 'do_not_contact',
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const status = String(body?.status || '');

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json({ error: `Unsupported status: ${status}` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .update({ status })
      .eq('id', id)
      // Ownership: a row belonging to another tenant must be
      // indistinguishable from one that does not exist.
      .eq('client_id', clientId)
      .select('id, status')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error('[dashboard/leads/:id] update failed:', error.message);
      return serverError(error, 'dashboard/leads/[id]');
    }

    return NextResponse.json({ lead: data });
  } catch (err: any) {
    console.error('[dashboard/leads/:id] PATCH failed:', err);
    return serverError(err, 'dashboard/leads/[id]');
  }
}
