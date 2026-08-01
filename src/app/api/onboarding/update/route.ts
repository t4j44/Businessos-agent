import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// `field` arrives from the browser, so it is checked against an allowlist —
// otherwise any column on brand_profiles could be overwritten.
const TEXT_FIELDS = [
  'company_name',
  'icp_summary',
  'tone_description',
  'tone_type',
  'value_proposition',
  'brand_colors',
  'greeting_text',
];

const JSON_FIELDS = [
  'products_json',
  'pain_points_json',
  'competitors_json',
  'faq_json',
];

export async function POST(req: Request) {
  try {
    const { client_id, field, value } = await req.json();

    if (!client_id || !field) {
      return NextResponse.json(
        { error: 'client_id and field are required.' },
        { status: 400 },
      );
    }

    const isText = TEXT_FIELDS.includes(field);
    const isJson = JSON_FIELDS.includes(field);

    if (!isText && !isJson) {
      return NextResponse.json(
        { error: `'${field}' is not a field that can be updated.` },
        { status: 400 },
      );
    }

    // JSON columns must receive real JSON, not a raw sentence.
    let parsedValue: any = value;
    if (isJson) {
      try {
        parsedValue = typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return NextResponse.json(
          { error: `'${field}' expects valid JSON.` },
          { status: 400 },
        );
      }
    }

    const { error } = await supabaseAdmin
      .from('brand_profiles')
      .update({ [field]: parsedValue })
      .eq('client_id', client_id);

    if (error) {
      console.error('[onboarding/update] update failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: true });
  } catch (err: any) {
    console.error('[onboarding/update] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
