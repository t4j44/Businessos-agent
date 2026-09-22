import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { readJsonBody, isUuid, ValidationError } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, context: Context) {
  try {
    const { clientId } = await requireSession();
    const { id } = await context.params;
    if (!isUuid(id)) throw new ValidationError('Invalid conversation ID.');
    const before = new URL(req.url).searchParams.get('before');
    if (before && (!/^\d{1,19}$/.test(before) || BigInt(before) > BigInt('9223372036854775807'))) throw new ValidationError('Invalid message cursor.');
    const { data: row, error } = await supabaseAdmin.from('widget_conversations')
      .select('id,session_key,message_count,handoff_status,handoff_request_key,visitor_name,visitor_email,visitor_phone,handoff_reason,requested_at,resolved_at')
      .eq('client_id', clientId).eq('id', id).maybeSingle();
    if (error) throw new Error('Read failed');
    if (!row) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
    let query = supabaseAdmin.from('widget_messages').select('id,role,content,created_at')
      .eq('client_id', clientId).eq('session_key', row.session_key);
    if (before) query = query.lt('id', before);
    const { data: messages, error: messageError } = await query.order('id', { ascending: false }).limit(51);
    if (messageError) throw new Error('Read failed');
    const visible = (messages || []).slice(0, 50).reverse();
    const { session_key: _sessionKey, ...conversation } = row;
    return NextResponse.json({ conversation, messages: visible, has_older: (messages || []).length > 50 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return authErrorResponse(error) ?? NextResponse.json({ error: 'Conversation could not be loaded.' }, { status: 503 });
  }
}

export async function PATCH(req: Request, context: Context) {
  try {
    const { clientId, userId } = await requireSession();
    const { id } = await context.params;
    const body = await readJsonBody(req, 2000);
    if (!isUuid(id) || !isUuid(body.request_key) || body.action !== 'resolve') throw new ValidationError('A valid request and resolve action are required.');
    const { data, error } = await supabaseAdmin.rpc('resolve_widget_handoff', { p_client_id: clientId, p_id: id, p_request_key: body.request_key, p_user_id: userId });
    if (error || !data) throw new Error('Write failed');
    if (data.outcome === 'not_found') return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
    if (data.outcome === 'conflict') return NextResponse.json({ error: 'Request changed. Refresh before resolving.' }, { status: 409 });
    return NextResponse.json({ resolved: true, notification_sent: false });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return authErrorResponse(error) ?? NextResponse.json({ error: 'Request could not be resolved.' }, { status: 503 });
  }
}
