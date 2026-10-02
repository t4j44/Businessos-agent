import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireSession, authErrorResponse } from '@/lib/auth-guard'
import { serverError } from '@/lib/server-error'

// CSV lead import.
//
// This used to do a plain INSERT, so uploading the same file twice duplicated
// every lead. Rows are now normalised, checked against the leads this client
// already has and against each other, and inserted through import_csv_leads
// (migration 038) so the check and the insert cannot be split apart by a
// simultaneous second upload.

export const runtime = 'nodejs'

// Limits. 4 MB rather than a rounder 5: Vercel caps a serverless request body
// at about 4.5 MB, and a request rejected by the platform gives the owner an
// opaque error instead of ours, so our own message has to fire first. At the
// ~120 bytes a lead row typically occupies, 4 MB is far more than the row cap
// below — in practice the row cap is what you hit.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// 10k rows keeps one synchronous request inside the function timeout, with a
// single insert statement rather than a batch loop. Bigger lists should be
// split, which is also how the owner finds out their file is unusually large.
const MAX_ROWS = 10_000;

// Header aliases accepted for each lead column, lowercased.
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name', 'full_name', 'contact', 'contact name'],
  email: ['email', 'email address', 'work email', 'e-mail'],
  company: ['company', 'company name', 'organization', 'account'],
  // Needed for the no-email duplicate rule: two rows for the same company
  // domain are the same lead.
  website: ['website', 'web site', 'url', 'domain', 'company website', 'site'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin_url', 'profile'],
  phone: ['phone', 'phone number', 'mobile', 'telephone'],
  // TCPA: consent has to be imported with the lead, not assumed.
  phone_consent: ['phone_consent', 'phone consent', 'sms consent', 'consent'],
  consent_source: ['consent_source', 'consent source', 'source of consent', 'opt_in_source'],
};

// Values accepted as affirmative consent in the CSV.
const TRUTHY = ['true', 'yes', 'y', '1', 'consented', 'opt-in', 'opt in'];

// Deliberately loose: this rejects obvious junk ("Jane Doe", "n/a", a bare
// domain) without trying to out-guess a real mail server on what is deliverable.
const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[^\s@.,;:<>()[\]\\"]+(\.[^\s@.,;:<>()[\]\\"]+)+$/;

/**
 * RFC-4180 parser over the whole file.
 *
 * The previous version split the text on newlines first and then parsed each
 * line, so a quoted field containing a line break was torn into two broken
 * rows. Quotes have to be tracked across newlines, which means one pass over
 * the whole string.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // A spreadsheet-exported CSV usually starts with a UTF-8 BOM.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => { row.push(field.trim()); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        // "" inside a quoted field is one literal quote.
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      // Including \n and \r: a line break inside quotes is content, not a row end.
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  // Whatever is left, unless the file ended exactly on a row break.
  if (field.length > 0 || row.length > 0) endRow();

  // Blank lines are not rows and are not counted as anything.
  return rows.filter((r) => r.some((c) => c.length > 0));
}

/** Trimmed and lowercased, or null. */
export function normalizeEmail(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return value || null;
}

/**
 * Lowercase host, with no scheme, path, query, fragment, port or leading www.
 * Mirrors normalize_lead_domain() in migration 038 step for step, so a domain
 * computed here matches one backfilled in SQL. A test asserts they agree.
 */
export function normalizeDomain(raw: unknown): string | null {
  let value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  value = value.replace(/^www\./, '');
  value = value.replace(/[.:]+$/, '');
  return value || null;
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

type ImportRow = {
  name: string | null; email: string | null; company: string | null;
  website: string | null; domain: string | null; dedupe_key: string | null;
  linkedin_url: string | null; phone: string | null;
  phone_consent: boolean; phone_consent_source: string | null;
};

/**
 * Normalises parsed rows, drops the unusable ones and collapses duplicates
 * within the file. Exported so the rules can be tested without a database.
 */
export function prepareRows(
  rows: string[][],
  columns: Record<string, number>,
): { rows: ImportRow[]; skipped_invalid: number; skipped_duplicate_in_file: number } {
  const at = (row: string[], column: string) => {
    const index = columns[column];
    if (index === undefined) return null;
    const value = row[index];
    return value === undefined || value === '' ? null : value;
  };

  const prepared: ImportRow[] = [];
  const seen = new Set<string>();
  let skipped_invalid = 0;
  let skipped_duplicate_in_file = 0;

  for (const row of rows) {
    const rawEmail = at(row, 'email');
    const email = normalizeEmail(rawEmail);
    const name = at(row, 'name');
    const company = at(row, 'company');
    const website = at(row, 'website');
    const domain = normalizeDomain(website);

    // A supplied address that is not an address makes the row unusable: the
    // point of an imported lead is being able to contact it, and silently
    // storing the lead without the address would hide the typo in the file.
    if (email !== null && !EMAIL.test(email)) { skipped_invalid++; continue; }
    // Nothing to identify the lead by.
    if (!email && !name && !company) { skipped_invalid++; continue; }

    // Email first, domain only when there is no email — the same precedence
    // the duplicate check in import_csv_leads uses.
    const dedupe_key = email ? email : domain ? `domain:${domain}` : null;
    if (dedupe_key) {
      if (seen.has(dedupe_key)) { skipped_duplicate_in_file++; continue; }
      seen.add(dedupe_key);
    }

    const consent = TRUTHY.includes(String(at(row, 'phone_consent') ?? '').trim().toLowerCase());
    prepared.push({
      name, email, company, website, domain, dedupe_key,
      linkedin_url: at(row, 'linkedin_url'),
      phone: at(row, 'phone'),
      // Only an explicit affirmative counts; anything else, including a blank
      // column, means no consent.
      phone_consent: consent,
      phone_consent_source: at(row, 'consent_source'),
    });
  }

  return { rows: prepared, skipped_invalid, skipped_duplicate_in_file };
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

    // Checked before reading the body into memory.
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB — please split it and import the parts.`,
        },
        { status: 413 },
      );
    }

    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      return NextResponse.json(
        { error: 'The CSV needs a header row and at least one lead.' },
        { status: 400 },
      );
    }

    const dataRows = parsed.slice(1);
    if (dataRows.length > MAX_ROWS) {
      return NextResponse.json(
        {
          error: `That file has ${dataRows.length.toLocaleString()} rows. The limit is ${MAX_ROWS.toLocaleString()} per import — please split it.`,
        },
        { status: 413 },
      );
    }

    const columns = mapHeaders(parsed[0]);
    if (columns.email === undefined && columns.name === undefined && columns.company === undefined) {
      return NextResponse.json(
        { error: 'The CSV needs at least an "email", "name" or "company" column.' },
        { status: 400 },
      );
    }

    const { rows, skipped_invalid, skipped_duplicate_in_file } = prepareRows(dataRows, columns);

    if (rows.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped_duplicate: skipped_duplicate_in_file,
        skipped_invalid,
        total_rows: dataRows.length,
      });
    }

    // One statement: the duplicate check and the insert happen together, so a
    // second upload of the same file cannot slip between them.
    const { data, error } = await supabaseAdmin.rpc('import_csv_leads', {
      p_client_id: client_id,
      p_rows: rows,
    });

    if (error) {
      console.error('[enrichment/csv-import] import failed:', error.code);
      return serverError(error, 'agents/enrichment/csv-import');
    }

    const imported = Number(data?.imported) || 0;
    const duplicateExisting = Number(data?.skipped_duplicate) || 0;

    return NextResponse.json({
      imported,
      skipped_duplicate: skipped_duplicate_in_file + duplicateExisting,
      skipped_invalid,
      total_rows: dataRows.length,
      // Which kind of duplicate, for an owner wondering why a re-import did
      // nothing.
      detail: {
        duplicate_in_file: skipped_duplicate_in_file,
        duplicate_existing_lead: duplicateExisting,
      },
    });
  } catch (err: any) {
    console.error('[enrichment/csv-import] POST failed:', err);
    return serverError(err, 'agents/enrichment/csv-import');
  }
}
