import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const WEEKS = 12;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

// No real benchmark feed exists yet — this is a placeholder constant so the
// comparison line has something to plot. Replace when a real source lands.
const INDUSTRY_AVERAGE = 4.1;

export type Sentiment = 'praise' | 'neutral' | 'complaint';

function sentimentOf(star: number): Sentiment {
  if (star >= 4) return 'praise';
  if (star === 3) return 'neutral';
  return 'complaint';
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

// ── Deduplication ───────────────────────────────────────────────────────────
// Agent test runs can insert the same review repeatedly. Prefer the platform's
// own id when present; otherwise fall back to the normalized review text.
// Rows arrive newest-first, so the first hit for a key is the one kept.
function dedupeReviews<T extends { external_review_id?: string | null; review_text?: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = r.external_review_id
      ? `id:${r.external_review_id}`
      : `text:${String(r.review_text || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
    if (!key || key === 'text:') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── Complaint theme grouping ────────────────────────────────────────────────
// The model writes themes as free text, so the same complaint arrives as many
// near-identical strings. Themes are normalized to word sets and clustered when
// they overlap by more than THEME_SIMILARITY.
const THEME_SIMILARITY = 0.6;

const THEME_STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'to', 'with', 'for', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'no', 'not', 'about', 'from', 'by',
]);

function themeTokens(theme: string): Set<string> {
  return new Set(
    String(theme)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !THEME_STOPWORDS.has(w)),
  );
}

// Overlap coefficient: shared words as a share of the smaller theme.
function themeSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

export function groupComplaintThemes(
  rawThemes: string[],
): { theme: string; count: number; variants: string[] }[] {
  const counts = new Map<string, number>();
  for (const t of rawThemes) {
    const key = String(t || '').trim();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Most common variant first, so it seeds its cluster and becomes the label.
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const clusters: { label: string; count: number; variants: string[]; tokens: Set<string> }[] = [];
  for (const [variant, count] of entries) {
    const tokens = themeTokens(variant);
    const match = clusters.find((c) => themeSimilarity(tokens, c.tokens) > THEME_SIMILARITY);
    if (match) {
      match.count += count;
      match.variants.push(variant);
    } else {
      clusters.push({ label: variant, count, variants: [variant], tokens });
    }
  }

  return clusters
    .map((c) => ({ theme: c.label, count: c.count, variants: c.variants }))
    .sort((a, b) => b.count - a.count);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;

    const { data: rows, error } = await supabaseAdmin
      .from('reviews')
      .select(
        'id, platform, star_rating, review_text, reviewer_name, review_date, responded, response_text, complaint_theme, external_review_id, created_at',
      )
      .eq('client_id', client_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[reputation/analyze] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rawRows = rows || [];

    // Collapse repeat inserts of the same review before anything is derived,
    // so counts, sentiment and themes are not inflated by duplicates.
    const sourceRows: any[] = dedupeReviews(rawRows);
    const duplicatesRemoved = rawRows.length - sourceRows.length;

    const reviews = sourceRows.map((r) => ({
      ...r,
      star_rating: Number(r.star_rating) || 0,
      sentiment: sentimentOf(Number(r.star_rating) || 0),
      at: r.review_date || r.created_at,
    }));

    const total = reviews.length;
    const responded = reviews.filter((r) => r.responded).length;
    const avgRating = total
      ? round1(reviews.reduce((s, r) => s + r.star_rating, 0) / total)
      : 0;

    // ── Sentiment split ───────────────────────────────────────────────────
    const counts: Record<Sentiment, number> = { praise: 0, neutral: 0, complaint: 0 };
    for (const r of reviews) counts[r.sentiment]++;
    const asPct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

    // ── Complaint themes, clustered and ranked ────────────────────────────
    // Near-identical phrasings of the same complaint are merged so the panel
    // shows one theme with a combined count, not five near-duplicates.
    const complaintThemes = groupComplaintThemes(
      reviews.map((r) => r.complaint_theme).filter(Boolean) as string[],
    );

    const topComplaint = complaintThemes[0]?.theme || null;

    // ── Weekly trend over the last 12 weeks ───────────────────────────────
    const now = Date.now();
    const series = [];
    let weeksWithData = 0;
    for (let i = WEEKS - 1; i >= 0; i--) {
      const end = now - i * MS_WEEK;
      const start = end - MS_WEEK;
      const inWeek = reviews.filter((r) => {
        const t = new Date(r.at).getTime();
        return t > start && t <= end;
      });
      if (inWeek.length > 0) weeksWithData++;
      series.push({
        week: `Week ${WEEKS - i}`,
        your_rating: inWeek.length
          ? round1(inWeek.reduce((s, r) => s + r.star_rating, 0) / inWeek.length)
          : null,
        industry_average: INDUSTRY_AVERAGE,
        review_count: inWeek.length,
      });
    }
    // Below three weeks of history the line is too sparse to read as a trend.
    const trendHasHistory = weeksWithData >= 3;

    // ── Predicted improvement ─────────────────────────────────────────────
    // Projection: if every review carrying the top complaint theme were
    // resolved to 4 stars, this is how the average would move.
    let predictedImprovement = 0;
    if (topComplaint && total) {
      const projected =
        reviews.reduce(
          (s, r) => s + (r.complaint_theme === topComplaint ? Math.max(r.star_rating, 4) : r.star_rating),
          0,
        ) / total;
      predictedImprovement = Math.max(0, round1(projected - avgRating));
    }

    const platforms = ['Google', 'Yelp', 'G2', 'Capterra'].map((name) => ({
      name,
      count: reviews.filter((r) => (r.platform || '').toLowerCase() === name.toLowerCase()).length,
    }));

    return NextResponse.json({
      client_id,
      is_empty: total === 0,
      duplicates_removed: duplicatesRemoved,
      summary: {
        avg_rating: avgRating,
        total_reviews: total,
        responded,
        response_rate: total ? Math.round((responded / total) * 100) : 0,
        top_complaint: topComplaint,
        predicted_improvement: predictedImprovement,
      },
      sentiment_breakdown: {
        praise: counts.praise,
        neutral: counts.neutral,
        complaint: counts.complaint,
        praise_pct: asPct(counts.praise),
        neutral_pct: asPct(counts.neutral),
        complaint_pct: asPct(counts.complaint),
      },
      sentiment_over_time: series,
      // False when there is too little history to plot a meaningful 12-week trend.
      trend_has_history: trendHasHistory,
      industry_average: INDUSTRY_AVERAGE,
      complaint_themes: complaintThemes,
      platforms,
      reviews: reviews.map((r) => ({
        id: r.id,
        platform: r.platform,
        star_rating: r.star_rating,
        review_text: r.review_text,
        reviewer_name: r.reviewer_name,
        responded: r.responded,
        response_text: r.response_text,
        complaint_theme: r.complaint_theme,
        sentiment: r.sentiment,
        created_at: r.at,
      })),
    });
  } catch (err: any) {
    console.error('[reputation/analyze] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

// Batch entry point used by the Vercel cron (/api/cron/reputation-scan).
//
// GET above is the read-only dashboard aggregator. This POST is the actor: it
// finds reviews that have no drafted reply yet and runs the reputation agent
// over each one. Without it the cron would hit a 405, since this file
// previously exported GET only.
export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { client_id, limit } = await req.json();

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    const { runReputation } = await import('../route');

    const { data: rows, error } = await supabaseAdmin
      .from('reviews')
      .select('id, platform, star_rating, review_text, reviewer_name, responded, response_text')
      .eq('client_id', client_id)
      .eq('responded', false)
      .is('response_text', null)
      .order('star_rating', { ascending: true })
      .limit(Number(limit) || 25);

    if (error) {
      console.error('[reputation/analyze] POST query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const pending = (rows || []).filter((r: any) => r.review_text && r.star_rating != null);
    const results: any[] = [];

    for (const review of pending) {
      try {
        const { status, body } = await runReputation({
          client_id,
          review_text: review.review_text,
          rating: Number(review.star_rating),
          platform: review.platform || 'Google',
          reviewer_name: review.reviewer_name || undefined,
          review_id: review.id,
        });
        results.push({
          review_id: review.id,
          status: status === 200 ? 'ok' : 'failed',
          error: status === 200 ? undefined : body?.error,
        });
      } catch (err: any) {
        results.push({ review_id: review.id, status: 'error', error: err?.message });
      }
    }

    return NextResponse.json({
      client_id,
      pending: pending.length,
      drafted: results.filter((r) => r.status === 'ok').length,
      results,
    });
  } catch (err: any) {
    console.error('[reputation/analyze] POST failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
