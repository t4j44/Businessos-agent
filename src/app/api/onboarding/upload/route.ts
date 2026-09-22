import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { PDFParse } from 'pdf-parse';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// Brand-asset upload for onboarding.
//
// THREE THINGS THIS ROUTE NOW GUARANTEES
//
// 1. It never returns HTML. Every exit is NextResponse.json(). The browser can
//    still receive HTML for a request that never reaches this function at all —
//    Vercel rejects a body over ~4.5MB with its own error page — which is why
//    the uploader checks res.ok and the content-type before calling res.json(),
//    and refuses oversized files client-side first.
//
// 2. client_id comes from the session, not the form. The form field used to be
//    trusted, so any signed-in user could write files into another tenant's
//    storage folder and attach chunks to their brand memory.
//
// 3. Extracted text is NOT written to rag_chunks here. It is returned to the
//    caller for confirmation, and saved — as edited — by
//    /api/onboarding/knowledge. Writing it straight in was how a wrong
//    extraction ended up permanently in brand memory with nobody having read it.
//
// PREVIOUSLY: the chunk insert here omitted `embedding`. search_rag_chunks
// filters `embedding IS NOT NULL`, so every one of those rows was invisible to
// retrieval forever. The knowledge route embeds at insert time.

export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'brand-assets';

// Matches storage.buckets.file_size_limit for this bucket (migration 022).
// The browser enforces a lower ceiling because Vercel caps the whole request
// body well below this.
const MAX_BYTES = 10 * 1024 * 1024;

type Kind = 'image' | 'pdf' | 'text' | 'docx';

// Canonical content type per accepted kind. Whatever the browser reports, the
// file is stored under one of these — the bucket's allowed_mime_types list is
// enforced by storage itself, before any of this route's own validation runs.
const MIME_KIND: Record<string, { kind: Kind; store: string }> = {
  'image/png':       { kind: 'image', store: 'image/png' },
  'image/jpeg':      { kind: 'image', store: 'image/jpeg' },
  'image/jpg':       { kind: 'image', store: 'image/jpeg' },
  'image/webp':      { kind: 'image', store: 'image/webp' },
  'image/svg+xml':   { kind: 'image', store: 'image/svg+xml' },
  'application/pdf': { kind: 'pdf',   store: 'application/pdf' },
  'text/plain':      { kind: 'text',  store: 'text/plain' },
  'text/markdown':   { kind: 'text',  store: 'text/markdown' },
  'text/x-markdown': { kind: 'text',  store: 'text/markdown' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    { kind: 'docx', store: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
};

// Browsers report .md as text/markdown, text/plain, application/octet-stream or
// nothing at all depending on the OS. The extension is the more reliable signal
// for documents, so it wins when the reported type is unknown.
const EXT_KIND: Record<string, { kind: Kind; store: string }> = {
  png:  { kind: 'image', store: 'image/png' },
  jpg:  { kind: 'image', store: 'image/jpeg' },
  jpeg: { kind: 'image', store: 'image/jpeg' },
  webp: { kind: 'image', store: 'image/webp' },
  svg:  { kind: 'image', store: 'image/svg+xml' },
  pdf:  { kind: 'pdf',   store: 'application/pdf' },
  txt:  { kind: 'text',  store: 'text/plain' },
  text: { kind: 'text',  store: 'text/plain' },
  md:   { kind: 'text',  store: 'text/markdown' },
  mdx:  { kind: 'text',  store: 'text/markdown' },
  markdown: { kind: 'text', store: 'text/markdown' },
  docx: { kind: 'docx',  store: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
};

const ACCEPTED_LABEL = 'PNG, JPG, WEBP, SVG, PDF, TXT, MD, or DOCX';

// Signed URL lifetime for returned asset links (private bucket).
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

// Upper bound on text handed back for confirmation. Long enough for a brand
// guideline document, short enough that the response stays a sane size.
const MAX_DOC_CHARS = 20_000;

function classify(file: File): { kind: Kind; store: string } | null {
  const byMime = MIME_KIND[(file.type || '').toLowerCase()];
  if (byMime) return byMime;

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

// The filename lands in a storage path, so strip anything that could
// traverse directories or break the key.
function safeName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'file';
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

// Collapses the runs of blank lines a PDF or a pasted document tends to carry,
// so the confirmation screen shows prose rather than a column of whitespace.
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Uploaded = {
  name: string;
  type: string;
  /** Signed URL for the stored file, or the storage key if signing failed. */
  url: string;
  /** The storage key. A saved chunk records this as its source. */
  path: string;
  /** Text pulled out of the file, for the confirmation turn. Absent for images. */
  extracted?: string;
  /** True when `extracted` was cut at MAX_DOC_CHARS. */
  truncated?: boolean;
  /** Present when the file was stored but its text could not be read. */
  note?: string;
};

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e: any) {
      // A body truncated in transit, or one the runtime refused to buffer.
      console.error('[onboarding/upload] could not read the request body:', e);
      return NextResponse.json(
        { error: 'The upload did not arrive intact. Try a smaller file.' },
        { status: 400 },
      );
    }

    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files were provided.' }, { status: 400 });
    }

    // Supabase never creates a bucket on demand — uploading into a missing one
    // fails per file with a bare "Bucket not found", which reads like a problem
    // with the file. Check once up front so the real cause is reported instead.
    const { error: bucketError } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (bucketError) {
      console.error(`[onboarding/upload] bucket "${BUCKET}" unavailable:`, bucketError);
      return NextResponse.json(
        {
          error:
            `Storage bucket "${BUCKET}" is not available (${bucketError.message}). ` +
            `Run supabase/migrations/022_catchup.sql to create it.`,
        },
        { status: 503 },
      );
    }

    const uploaded: Uploaded[] = [];
    const failed: { name: string; reason: string }[] = [];

    // Distinguishes "storage rejected it" from "we rejected it" so the response
    // status can say which side is at fault.
    let storageFailed = false;

    for (const file of files) {
      const classified = classify(file);

      if (!classified) {
        failed.push({ name: file.name, reason: `Only ${ACCEPTED_LABEL} files are supported.` });
        continue;
      }
      if (file.size > MAX_BYTES) {
        failed.push({ name: file.name, reason: 'File is larger than 10MB.' });
        continue;
      }

      const { kind, store } = classified;
      const path = `${clientId}/${safeName(file.name)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      // 1 — store the asset.
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: store, upsert: true });

      if (uploadError) {
        console.error('[onboarding/upload] storage upload failed:', uploadError);
        storageFailed = true;
        failed.push({ name: file.name, reason: uploadError.message });
        continue;
      }

      const entry: Uploaded = { name: file.name, type: store, url: path, path };

      // 2 — pull out the text, where there is text to pull.
      //     Images: dominant-colour extraction is Phase 2. The file itself is
      //     stored now so the colour can be derived later without re-uploading.
      if (kind === 'text') {
        const raw = tidy(new TextDecoder('utf-8').decode(bytes));
        if (raw) {
          entry.extracted = raw.slice(0, MAX_DOC_CHARS);
          entry.truncated = raw.length > MAX_DOC_CHARS;
        } else {
          entry.note = 'That file looked empty, so there was nothing to read.';
        }
      } else if (kind === 'pdf') {
        try {
          const raw = tidy(await extractPdfText(bytes));
          if (raw) {
            entry.extracted = raw.slice(0, MAX_DOC_CHARS);
            entry.truncated = raw.length > MAX_DOC_CHARS;
          } else {
            entry.note =
              'I could not find any selectable text in that PDF — it may be a scan.';
          }
        } catch (e: any) {
          // A failed text extraction shouldn't lose the uploaded file.
          console.error(`[onboarding/upload] PDF text extraction failed for ${file.name}:`, e);
          entry.note = 'I saved that PDF but could not read its text.';
        }
      } else if (kind === 'docx') {
        // No .docx text extractor is installed. See the note in the reply that
        // accompanied this change: adding one means a new dependency (mammoth
        // or officeparser), which was explicitly out of scope. The file is
        // stored so nothing is lost, and it is honest about what it can't do.
        entry.note =
          'I saved that .docx, but I cannot read Word files yet — paste the text ' +
          'or upload it as .txt, .md or PDF if you want it in your brand memory.';
      }

      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);

      // Not fatal — the file is already stored, and `path` still identifies it.
      // Worth a log line so a broken signing config is not invisible.
      if (signError) {
        console.error(`[onboarding/upload] could not sign ${path}:`, signError.message);
      }

      entry.url = signed?.signedUrl || path;
      uploaded.push(entry);
    }

    // Nothing was stored. Returning 200 here made the client announce success
    // over a completely empty upload, which hid the real failure.
    if (uploaded.length === 0) {
      return NextResponse.json(
        { uploaded, failed, error: failed[0]?.reason || 'No files could be stored.' },
        { status: storageFailed ? 502 : 400 },
      );
    }

    return NextResponse.json({ uploaded, failed });
  } catch (err: any) {
    console.error('[onboarding/upload] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
