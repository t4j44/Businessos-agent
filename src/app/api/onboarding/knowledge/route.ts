import { NextResponse } from 'next/server';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { storeChunk } from '@/lib/embeddings';
import { readJsonBody, ValidationError } from '@/lib/validation';

// Saves text the user has read and approved into brand memory.
//
// This is the second half of the upload confirmation turn: /api/onboarding/upload
// extracts and returns, the user edits, and this writes what they actually
// agreed to rather than the raw extraction.
//
// storeChunk() generates the embedding before inserting and refuses to write a
// row without one. That matters: search_rag_chunks filters
// `embedding IS NOT NULL`, so a chunk saved without a vector is invisible to
// every agent forever while still showing up in the Brand Memory count — a
// row that looks like knowledge and behaves like nothing.

export const runtime = 'nodejs';
export const maxDuration = 60;

// Keep short trailing passages; every nonempty chunk is stored.
const TARGET_CHARS = 1_500;
const MAX_CHARS = 20_000;
const MAX_CHUNKS = 24;

/**
 * Splits on paragraph boundaries, then on sentences when a single paragraph is
 * longer than the target. Retrieval works better on passages that stop where
 * the writing stops.
 */
function chunkText(text: string, target = TARGET_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > target) {
      flush();
      // Keep the sentence terminator with the sentence it ends.
      const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph];
      for (const sentence of sentences) {
        if (current.length + sentence.length > target) flush();
        current += sentence;
      }
      flush();
      continue;
    }

    if (current.length + paragraph.length + 2 > target) flush();
    current += (current ? '\n\n' : '') + paragraph;
  }

  flush();
  return chunks;
}

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await readJsonBody(req, 90_000);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const source = typeof body?.source === 'string' ? body.source.slice(0, 500) : null;

    if (!text) {
      return NextResponse.json({ error: 'There is nothing to save.' }, { status: 400 });
    }
    if (text.length < 50) {
      return NextResponse.json(
        { error: 'That is too short to be useful — 50 characters or more, please.' },
        { status: 400 },
      );
    }

    if (text.length > MAX_CHARS) throw new ValidationError('Please split documents longer than 20,000 characters.');
    const chunks = chunkText(text);
    if (chunks.length > MAX_CHUNKS) throw new ValidationError('Please split this document into smaller parts.');

    let saved = 0;
    const skipped: string[] = [];

    for (const chunk of chunks) {
      // Owner documents have a separate domain and survive website rescans.
      const ok = await storeChunk(clientId, chunk, 'knowledge', source ?? undefined);
      if (ok) saved++;
      else skipped.push(chunk.slice(0, 60));
    }

    if (saved === 0) {
      // Every chunk failed to embed or insert. storeChunk logs the reason; the
      // caller needs to know nothing was kept rather than see a cheerful tick.
      console.error(
        `[onboarding/knowledge] nothing stored for client ${clientId} from ${chunks.length} chunk(s)`,
      );
      return NextResponse.json(
        { error: 'I could not save that to your brand memory. Please try again.' },
        { status: 502 },
      );
    }

    if (skipped.length > 0) {
      console.warn(
        `[onboarding/knowledge] ${skipped.length} of ${chunks.length} chunks were not stored for client ${clientId}`,
      );
    }

    return NextResponse.json({ saved, total: chunks.length });
  } catch (err: any) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[onboarding/knowledge] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
