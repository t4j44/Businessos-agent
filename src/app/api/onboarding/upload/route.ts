import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { PDFParse } from 'pdf-parse';

const BUCKET = 'brand-assets';
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per file

const ALLOWED_TYPES: Record<string, 'image' | 'pdf'> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/svg+xml': 'image',
  'application/pdf': 'pdf',
};

// Signed URL lifetime for returned asset links (private bucket).
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;

// Very large PDFs are truncated so a single row stays sane.
const MAX_PDF_CHARS = 50_000;

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

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const client_id = form.get('client_id');
    if (!client_id || typeof client_id !== 'string') {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files were provided.' }, { status: 400 });
    }

    const uploaded: { name: string; type: string; url: string }[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const file of files) {
      const kind = ALLOWED_TYPES[file.type];

      if (!kind) {
        failed.push({ name: file.name, reason: 'Only PNG, JPG, SVG, and PDF files are supported.' });
        continue;
      }
      if (file.size > MAX_BYTES) {
        failed.push({ name: file.name, reason: 'File is larger than 10MB.' });
        continue;
      }

      const path = `${client_id}/${safeName(file.name)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      // 1 — Store the asset.
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: file.type, upsert: true });

      if (uploadError) {
        console.error('[onboarding/upload] storage upload failed:', uploadError);
        failed.push({ name: file.name, reason: uploadError.message });
        continue;
      }

      // 2 — Images: dominant-colour extraction is Phase 2. The file itself is
      //     stored now so the colour can be derived later without re-uploading.

      // 3 — PDFs: pull the text out and keep it as a retrievable chunk.
      if (kind === 'pdf') {
        try {
          const text = (await extractPdfText(bytes)).trim();
          if (text) {
            // No embedding yet — vectors are generated in Piece 3 (RAG).
            const { error: chunkError } = await supabaseAdmin.from('rag_chunks').insert({
              client_id,
              content: text.slice(0, MAX_PDF_CHARS),
              source_url: path,
              chunk_type: 'asset',
            });
            if (chunkError) {
              console.error('[onboarding/upload] rag_chunks insert failed:', chunkError);
            }
          }
        } catch (e: any) {
          // A failed text extraction shouldn't lose the uploaded file.
          console.error(`[onboarding/upload] PDF text extraction failed for ${file.name}:`, e);
        }
      }

      const { data: signed } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);

      uploaded.push({ name: file.name, type: file.type, url: signed?.signedUrl || path });
    }

    return NextResponse.json({ uploaded, failed });
  } catch (err: any) {
    console.error('[onboarding/upload] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
