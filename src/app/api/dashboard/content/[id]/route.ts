import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const ALLOWED_STATUSES = new Set(['draft', 'scheduled', 'published']);

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

    const patch: Record<string, any> = { status };
    // Approving a draft schedules it; without an explicit time, queue it for now.
    if (status === 'scheduled' && body?.scheduled_at !== undefined) {
      patch.scheduled_at = body.scheduled_at;
    }

    const { data, error } = await supabaseAdmin
      .from('content_calendar')
      .update(patch)
      .eq('id', id)
      .select('id, status, scheduled_at')
      .single();

    if (error) {
      console.error('[dashboard/content/:id] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ post: data });
  } catch (err: any) {
    console.error('[dashboard/content/:id] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
