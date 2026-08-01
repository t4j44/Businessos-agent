import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { name, url, industry, contact_email, contact_phone } = await req.json();

    if (!name || !url) {
      return NextResponse.json(
        { error: 'Business name and website URL are required.' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .insert({ name, url, industry, contact_email, contact_phone })
      .select('id')
      .single();

    if (error) {
      console.error('[onboarding] insert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ client_id: data.id });
  } catch (err: any) {
    console.error('[onboarding] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
