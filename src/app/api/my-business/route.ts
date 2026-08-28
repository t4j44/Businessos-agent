import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { TEST_CLIENT_ID } from '@/lib/client-config';
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// `field` arrives from the browser, so it is checked against an allowlist —
// otherwise any column on brand_profiles could be overwritten.
const TEXT_FIELDS = [
  'company_name',
  'icp_summary',
  'tone_description',
  'tone_type',
  'value_proposition',
  'greeting_text',
  'brand_colors',
];

const JSON_FIELDS = [
  'products_json',
  'pain_points_json',
  'competitors_json',
  'faq_json',
];

// The website URL lives on `clients`, not `brand_profiles`.
const CLIENT_FIELDS = ['url'];

const TONE_TYPES = ['formal', 'casual', 'technical'];

export async function GET(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const client_id = clientId;

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, name, url, plan_tier')
      .eq('id', client_id)
      .maybeSingle();

    const { data: brand } = await supabaseAdmin
      .from('brand_profiles')
      .select('*')
      .eq('client_id', client_id)
      .maybeSingle();

    const { data: chunks } = await supabaseAdmin
      .from('rag_chunks')
      .select('id, content, chunk_type, source_url, created_at')
      .eq('client_id', client_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      client: client || { id: client_id, name: null, url: null },
      brand: brand || null,
      chunks: chunks || [],
      chunk_count: (chunks || []).length,
    });
  } catch (err: any) {
    console.error('[my-business] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { field, value } = body;
    const client_id = clientId;

    if (!field) {
      return NextResponse.json({ error: 'field is required.' }, { status: 400 });
    }

    // Website URL is stored on the client record.
    if (CLIENT_FIELDS.includes(field)) {
      const { error } = await supabaseAdmin
        .from('clients')
        .update({ [field]: value })
        .eq('id', client_id);

      if (error) {
        console.error('[my-business] client update failed:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ updated: true });
    }

    const isText = TEXT_FIELDS.includes(field);
    const isJson = JSON_FIELDS.includes(field);

    if (!isText && !isJson) {
      return NextResponse.json(
        { error: `'${field}' is not a field that can be updated.` },
        { status: 400 },
      );
    }

    // JSON columns must receive a real array, not a stringified sentence.
    let parsed: any = value;
    if (isJson) {
      if (typeof value === 'string') {
        try {
          parsed = JSON.parse(value);
        } catch {
          return NextResponse.json({ error: `'${field}' expects an array.` }, { status: 400 });
        }
      }
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: `'${field}' expects an array.` }, { status: 400 });
      }
    }

    if (field === 'tone_type' && parsed && !TONE_TYPES.includes(String(parsed))) {
      return NextResponse.json(
        { error: `tone_type must be one of: ${TONE_TYPES.join(', ')}.` },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from('brand_profiles')
      .update({ [field]: parsed })
      .eq('client_id', client_id);

    if (error) {
      console.error('[my-business] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: true });
  } catch (err: any) {
    console.error('[my-business] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
