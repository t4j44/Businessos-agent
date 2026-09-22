import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { isUuid } from '@/lib/validation';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { clientId } = await requireSession();
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data: customer, error } = await supabaseAdmin.from('contacts')
      .select('id,name,email,phone,status,score,created_at').eq('client_id', clientId).eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Customer could not be loaded.' }, { status: 503 });
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data: interactions, error: historyError, count } = await supabaseAdmin.from('contact_interactions')
      .select('id,agent_name,interaction_type,summary,sentiment_score,created_at', { count: 'exact' })
      .eq('client_id', clientId).eq('contact_id', id).order('created_at', { ascending: false }).limit(100);
    if (historyError) return NextResponse.json({ error: 'Customer history could not be loaded.' }, { status: 503 });
    return NextResponse.json({ customer, interactions, total_interactions: count, history_limit: 100 });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: 'Customer could not be loaded.' }, { status: 503 });
  }
}
