import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// Header aliases accepted for each lead column, lowercased.
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'full_name', 'contact', 'contact name'],
  email: ['email', 'email address', 'work email', 'e-mail'],
  company: ['company', 'company name', 'organization', 'account'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'profile'],
  phone: ['phone', 'phone number', 'mobile', 'telephone'],
};

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
  try {
    const form = await req.formData();
    const file = form.get('file');
    const client_id = String(form.get('client_id') || TEST_CLIENT_ID);

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      imported: data?.length ?? 0,
      skipped: rows.length - leads.length,
    });
  } catch (err: any) {
    console.error('[enrichment/csv-import] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
