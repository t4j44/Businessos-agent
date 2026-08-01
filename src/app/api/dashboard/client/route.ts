import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// Minimal client identity for the sidebar footer. There is no auth yet, so
// this resolves the test client until a real session is available.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;

    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, plan_tier, status')
      .eq('id', client_id)
      .single();

    if (error) {
      console.error('[dashboard/client] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      name: data.name || 'Your Business',
      plan_tier: data.plan_tier || 'starter',
      status: data.status,
    });
  } catch (err: any) {
    console.error('[dashboard/client] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
