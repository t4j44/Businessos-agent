import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

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

const TONE_TYPES = ['formal', 'casual', 'technical'];

export async function PATCH(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { field, value } = await req.json();
    const client_id = clientId;

    if (!field) {
      return NextResponse.json(
        { error: 'field is required.' },
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

    // JSON columns must receive a real array, not a stringified sentence.
    let parsed: any = value;
    if (isJson) {
      if (typeof value === 'string') {
        try {
          parsed = JSON.parse(value);
        } catch {
          return NextResponse.json(
            { error: `'${field}' expects an array.` },
            { status: 400 },
          );
        }
      }
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { error: `'${field}' expects an array.` },
          { status: 400 },
        );
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
      console.error('[my-business/update] update failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: true });
  } catch (err: any) {
    console.error('[my-business/update] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
