import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

export async function GET(req: Request) {
  try {
    const { clientId } = await requireSession();
    const query = new URL(req.url).searchParams;
    const page = Math.max(0, Math.min(2000, Number(query.get('page')) || 0));
    if (!Number.isInteger(page)) return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
    let request = supabaseAdmin.from('contacts')
      .select('id,name,email,phone,status,score,created_at', { count: 'exact' }).eq('client_id', clientId);
    const name = query.get('name')?.trim().slice(0, 100);
    if (name) request = request.ilike('name', `%${name.replace(/[\\%_]/g, '\\$&')}%`);
    const { data, error, count } = await request.order('created_at', { ascending: false })
      .order('id', { ascending: false }).range(page * 50, page * 50 + 49);
    if (error) return NextResponse.json({ error: 'Customers could not be loaded.' }, { status: 503 });
    return NextResponse.json({ customers: data, total: count, page, page_size: 50 });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: 'Customers could not be loaded.' }, { status: 503 });
  }
}
