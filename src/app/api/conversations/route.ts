import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

export async function GET(req: Request) {
  try {
    const { clientId } = await requireSession();
    const params = new URL(req.url).searchParams;
    const page = Number(params.get('page') || 0), status = params.get('status') || 'all';
    if (!Number.isInteger(page) || page < 0 || page > 2000 || !['all','requested','resolved'].includes(status)) {
      return NextResponse.json({ error: 'Invalid page or status.' }, { status: 400 });
    }
    let query = supabaseAdmin.from('widget_conversations')
      .select('id,last_activity_at,last_message_preview,message_count,handoff_status,visitor_name,requested_at', { count: 'exact' }).eq('client_id', clientId);
    if (status !== 'all') query = query.eq('handoff_status', status);
    const { data, error, count } = await query.order('last_activity_at', { ascending: false }).order('id', { ascending: false }).range(page * 50, page * 50 + 49);
    if (error) return NextResponse.json({ error: 'Conversations could not be loaded.' }, { status: 503 });
    return NextResponse.json({ conversations: data, total: count, page, page_size: 50 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return authErrorResponse(error) ?? NextResponse.json({ error: 'Conversations could not be loaded.' }, { status: 503 }); }
}
