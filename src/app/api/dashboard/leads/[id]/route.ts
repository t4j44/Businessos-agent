import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const ALLOWED_STATUSES = new Set([
  'pending', 'emailed', 'replied', 'hot', 'do_not_contact',
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
      .select('id, status')
      .single();

    if (error) {
      console.error('[dashboard/leads/:id] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ lead: data });
  } catch (err: any) {
    console.error('[dashboard/leads/:id] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
