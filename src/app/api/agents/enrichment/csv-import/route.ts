import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireSession, authErrorResponse } from '@/lib/auth-guard'
import { serverError } from '@/lib/server-error'

// Header aliases accepted for each lead column, lowercased.
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'full_name', 'contact', 'contact name'],
  email: ['email', 'email address', 'work email', 'e-mail'],
  company: ['company', 'company name', 'organization', 'account'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'profile'],
  phone: ['phone', 'phone number', 'mobile', 'telephone'],
  // TCPA: consent has to be imported with the lead, not assumed.
  phone_consent: ['phone_consent', 'phone consent', 'sms consent', 'consent'],
  consent_source: ['consent_source', 'consent source', 'source of consent', 'opt_in_source'],
};

// Values accepted as affirmative consent in the CSV.
const TRUTHY = ['true', 'yes', 'y', '1', 'consented', 'opt-in', 'opt in'];

// Minimal RFC-4180 row splitter: handles quoted fields and escaped quotes.
function splitRow(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

function mapHeaders(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((raw, idx) => {
    const key = raw.toLowerCase().replace(/^﻿/, '').trim();
    for (const [column, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[column] === undefined && aliases.includes(key)) map[column] = idx;
    }
  });
  return map;
}

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    const client_id = clientId;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No CSV file was uploaded.' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'The CSV needs a header row and at least one lead.' },
        { status: 400 },
      );
    }

    const columns = mapHeaders(splitRow(lines[0]));
    if (columns.email === undefined && columns.name === undefined) {
      return NextResponse.json(
        { error: 'The CSV needs at least a "name" or "email" column.' },
        { status: 400 },
      );
    }

    const at = (row: string[], column: string) =>
      columns[column] === undefined ? null : row[columns[column]] || null;

    const rows = lines.slice(1).map(splitRow).filter((r) => r.some((c) => c.length > 0));
    const leads = rows
      .map((r) => ({
        client_id,
        name: at(r, 'name'),
        email: at(r, 'email'),
        company: at(r, 'company'),
        linkedin_url: at(r, 'linkedin_url'),
        phone: at(r, 'phone'),
        source: 'csv_import',
        status: 'pending',
        // Only an explicit affirmative counts; anything else, including a
        // blank column, means no consent.
        phone_consent: TRUTHY.includes(String(at(r, 'phone_consent') ?? '').trim().toLowerCase()),
        phone_consent_at: TRUTHY.includes(String(at(r, 'phone_consent') ?? '').trim().toLowerCase())
          ? new Date().toISOString()
          : null,
        phone_consent_source: at(r, 'consent_source'),
      }))
      .filter((l) => l.name || l.email);

    if (leads.length === 0) {
      return NextResponse.json({ error: 'No usable rows found in the CSV.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert(leads)
      .select('id');

    if (error) {
      console.error('[enrichment/csv-import] insert failed:', error.message);
      return serverError(error, 'agents/enrichment/csv-import');
    }

    return NextResponse.json({
      imported: data?.length ?? 0,
      skipped: rows.length - leads.length,
    });
  } catch (err: any) {
    console.error('[enrichment/csv-import] POST failed:', err);
    return serverError(err, 'agents/enrichment/csv-import');
  }
}
