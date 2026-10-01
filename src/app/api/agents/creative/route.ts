import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { supabaseAdmin, getClientContext } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { requireSession, authErrorResponse } from '@/lib/auth-guard'
import { serverError } from '@/lib/server-error'

// Three platforms are generated in parallel, and a 30-post batch is a long
// completion. The default serverless ceiling cuts that off mid-JSON.
export const maxDuration = 300;

const PLATFORMS = ['instagram', 'facebook', 'linkedin'] as const;
type Platform = (typeof PLATFORMS)[number];

const DEFAULT_DAYS = 30;

const PLATFORM_STYLE: Record<Platform, string> = {
  instagram:
    'Instagram: visual-first. Open with a scroll-stopping line, keep it under 100 words, warm and personal. End with 4-6 relevant hashtags in the hashtags field, not in the body.',
  facebook:
    'Facebook: community-minded and conversational. 60-120 words. Local, neighbourly framing works well. Questions that invite comments perform best. Hashtags are rarely used — leave the array empty or use at most two.',
  linkedin:
    'LinkedIn: professional and credibility-building. 80-150 words. Focus on expertise, standards of care, team, and business insight rather than discounts. No emoji spam — at most one. At most three hashtags.',
};

// Vertical-specific content themes. Anything not matched gets the generic mix.
const VERTICAL_THEMES: Record<string, string> = {
  dental: [
    '- "Did you know…" dental health tips (flossing, enamel, gum health, kids\' teeth)',
    '- Before/after framing for cosmetic work — describe the transformation and the patient\'s confidence, never fabricate a specific case',
    '- Insurance, financing and payment-plan explainers that remove cost anxiety',
    '- Myth-busting on common dental fears, especially pain and anaesthetic',
    '- Meet-the-team and behind-the-scenes in the practice (sterilisation, technology, a day in the chair)',
  ].join('\n'),
  salon: [
    '- Style tips: how to maintain a cut, colour care, heat protection, at-home routines',
    '- Seasonal looks tied to the time of year and upcoming local events',
    '- Product features — what the salon stocks and why the team chose it',
    '- Client spotlights and transformation framing (describe the look and the feeling, never invent a named client)',
    '- Behind-the-scenes: the team training, new techniques, the salon atmosphere',
  ].join('\n'),
  restaurant: [
    '- Dish spotlights: one plate, described so the reader can taste it',
    '- Behind-the-kitchen: prep, sourcing, the people cooking',
    '- Seasonal specials and limited runs tied to the calendar',
    '- Staff picks and pairing suggestions',
    '- The room itself: atmosphere, occasions the space suits',
  ].join('\n'),
};

// Matched against clients.industry plus the brand text, since industry is often
// unset on profiles that came from the website scraper.
function detectVertical(industry: string, brandText: string): string | null {
  const haystack = `${industry} ${brandText}`.toLowerCase();
  if (/\b(dental|dentist|orthodont|teeth|tooth|oral care|hygienist)\b/.test(haystack)) return 'dental';
  if (/\b(salon|hair|barber|stylist|beauty|nail|spa|aesthetic)\b/.test(haystack)) return 'salon';
  if (/\b(restaurant|cafe|café|bistro|diner|eatery|kitchen|bakery|coffee shop)\b/.test(haystack))
    return 'restaurant';
  return null;
}

function buildBrandBlock(brand: any, client: any): string {
  const lines: string[] = [];
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (text) lines.push(`${label}: ${text}`);
  };

  push('Company name', brand?.company_name || client?.name);
  push('Tagline', brand?.tagline);
  push('About', brand?.description);
  push('Value proposition', brand?.value_proposition);
  push('Target audience', brand?.icp_summary);
  push('Tone of voice', brand?.tone_description);
  push('Location', brand?.location);
  push('Industry', client?.industry);

  const products = Array.isArray(brand?.products_json) ? brand.products_json : [];
  if (products.length) {
    const listed = products
      .map((p: any) => (p?.name ? `- ${p.name}${p.description ? `: ${p.description}` : ''}` : null))
      .filter(Boolean)
      .join('\n');
    if (listed) lines.push(`Products / services:\n${listed}`);
  }

  return lines.join('\n');
}

function buildSystemPrompt(
  platform: Platform,
  days: number,
  brandBlock: string,
  tone: string,
  vertical: string | null,
): string {
  const themes = vertical ? VERTICAL_THEMES[vertical] : null;

  return [
    `You are the social media strategist for the business described below. You write in their exact voice — not in a generic marketing voice.`,
    '',
    'BRAND:',
    brandBlock || '(limited detail on file — stay general and never invent specifics)',
    '',
    `VOICE TO WRITE IN: ${tone}`,
    '',
    `PLATFORM — ${PLATFORM_STYLE[platform]}`,
    '',
    `TASK: write exactly ${days} posts, one per day, numbered day 1 to day ${days}.`,
    '',
    'MIX across the month — roughly even, never the same type twice in a row:',
    '- educational: a genuinely useful tip the reader can act on',
    '- behind_the_scenes: the team, the space, the process',
    '- testimonial_prompt: a post that invites customers to share their experience, or frames a result without inventing a specific named person',
    '- promotional: an offer, service, or reason to book now',
    '',
    themes ? `THEMES specific to this kind of business — work these in:\n${themes}\n` : '',
    'HARD RULES:',
    '- Never invent prices, discounts, percentages, dates, or statistics. If an offer is implied, keep it non-specific ("ask us about…").',
    '- Never fabricate a named customer, a quote, or a review.',
    '- Never make medical, dental, or health claims that promise an outcome.',
    '- Vary the openings. Do not start more than two posts with the same word.',
    '- Write in the brand voice above, not in generic ad copy.',
    '',
    `Return ONLY valid JSON, no prose around it, in exactly this shape:`,
    '{ "posts": [ { "day": 1, "type": "educational", "hook": "string", "content": "string", "cta": "string", "hashtags": ["string"] } ] }',
    `The posts array must contain ${days} objects with day running 1..${days}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

type GeneratedPost = {
  day: number;
  type?: string;
  hook?: string;
  content?: string;
  cta?: string;
  hashtags?: string[];
};

// Keeps only well-formed posts on days inside the window, de-duplicated by day.
function normalizePosts(raw: any, days: number): GeneratedPost[] {
  const list = Array.isArray(raw?.posts) ? raw.posts : [];
  const seen = new Set<number>();
  const out: GeneratedPost[] = [];

  for (const p of list) {
    const day = Number(p?.day);
    const content = String(p?.content || '').trim();
    if (!Number.isInteger(day) || day < 1 || day > days) continue;
    if (!content || seen.has(day)) continue;
    seen.add(day);
    out.push({
      day,
      type: String(p?.type || '').trim() || undefined,
      hook: String(p?.hook || '').trim() || undefined,
      content,
      cta: String(p?.cta || '').trim() || undefined,
      hashtags: Array.isArray(p?.hashtags)
        ? p.hashtags.map((h: any) => String(h).trim()).filter(Boolean)
        : undefined,
    });
  }

  return out.sort((a, b) => a.day - b.day);
}

async function generateForPlatform(params: {
  platform: Platform;
  days: number;
  brandBlock: string;
  tone: string;
  vertical: string | null;
}): Promise<{ posts: GeneratedPost[]; inputTokens: number; outputTokens: number; cost: number; error?: string }> {
  const { platform, days, brandBlock, tone, vertical } = params;
  const system = buildSystemPrompt(platform, days, brandBlock, tone, vertical);
  const user = `Write the ${days}-day ${platform} calendar now. Return only the JSON object.`;

  const MAX_ATTEMPTS = 2;
  let totals = { inputTokens: 0, outputTokens: 0, cost: 0 };
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ai = await callAI({
        model: MODELS.SONNET,
        system,
        user,
        // A 30-post batch runs long; too low a ceiling truncates the JSON.
        maxTokens: 8000,
      });
      totals.inputTokens += ai.inputTokens;
      totals.outputTokens += ai.outputTokens;
      totals.cost += ai.cost;

      const posts = normalizePosts(parseJSON(ai.text), days);
      // A short batch is still worth keeping — a partial month beats nothing —
      // but a near-empty one means the model failed and should be retried.
      if (posts.length >= Math.ceil(days / 2)) {
        return { posts, ...totals };
      }
      lastError = `only ${posts.length}/${days} usable posts returned`;
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.error(`[creative] ${platform} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`);
    }
  }

  return { posts: [], ...totals, error: lastError };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    const client_id = clientId;

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    // platform accepts a single value or a list; omitted means all three.
    const requested: string[] = body?.platform
      ? Array.isArray(body.platform)
        ? body.platform
        : [body.platform]
      : [...PLATFORMS];

    const platforms = requested
      .map((p) => String(p).toLowerCase().trim())
      .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));

    if (platforms.length === 0) {
      return NextResponse.json(
        { error: `platform must be one or more of: ${PLATFORMS.join(', ')}.` },
        { status: 400 },
      );
    }

    const days = Math.min(Math.max(Number(body?.days) || DEFAULT_DAYS, 1), 60);

    // Default start is tomorrow — a calendar that begins today is half spent.
    const start = body?.start_date ? new Date(body.start_date) : new Date(Date.now() + 86400000);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: 'start_date is not a valid date.' }, { status: 400 });
    }
    start.setUTCHours(0, 0, 0, 0);

    const { client, brand } = await getClientContext(client_id);
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }

    const companyName = brand?.company_name || client?.name || 'this business';
    const brandBlock = buildBrandBlock(brand, client);
    const tone =
      brand?.tone_description ||
      'warm, friendly and local — like a small business owner talking to their neighbours.';
    const vertical = detectVertical(client?.industry || '', `${brandBlock} ${companyName}`);

    // Platforms run concurrently: three sequential 30-post completions would
    // outlast the function.
    const generated = await Promise.all(
      platforms.map(async (platform) => ({
        platform,
        ...(await generateForPlatform({ platform, days, brandBlock, tone, vertical })),
      })),
    );

    const endDate = new Date(start.getTime() + (days - 1) * 86400000);

    // Clear only previous drafts in this window so a re-run replaces unreviewed
    // posts without destroying anything already approved or published.
    const { error: clearError } = await supabaseAdmin
      .from('content_calendar')
      .delete()
      .eq('client_id', client_id)
      .eq('status', 'draft')
      .in('platform', platforms)
      .gte('post_date', isoDate(start))
      .lte('post_date', isoDate(endDate));

    if (clearError) {
      console.error('[creative] clearing old drafts failed:', clearError.message);
    }

    const rows: any[] = [];
    for (const g of generated) {
      for (const post of g.posts) {
        const postDate = new Date(start.getTime() + (post.day - 1) * 86400000);
        const hashtags = post.hashtags?.length ? `\n\n${post.hashtags.join(' ')}` : '';

        rows.push({
          client_id,
          platform: g.platform,
          post_date: isoDate(postDate),
          // `content` is the column the content dashboard already reads — the
          // generated copy lives there rather than in a parallel field.
          content: post.content + hashtags,
          hook: post.hook || null,
          cta: post.cta || null,
          status: 'draft',
          // 10:00 UTC keeps the existing scheduled_at ordering meaningful.
          scheduled_at: new Date(postDate.getTime() + 10 * 3600000).toISOString(),
          performance_json: { post_type: post.type || null, day: post.day },
        });
      }
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('content_calendar')
        .insert(rows)
        .select('id');

      if (error) {
        console.error('[creative] insert failed:', error.message);
        await logAgentRun({
          client_id,
          agent_type: 'creative',
          status: 'error',
          output_summary: 'Generated posts but could not store the calendar',
          metadata: { error: error.message, platforms },
        });
        return serverError(error, 'agents/creative');
      }
      inserted = data?.length ?? 0;
    }

    const totals = generated.reduce(
      (acc, g) => ({
        inputTokens: acc.inputTokens + g.inputTokens,
        outputTokens: acc.outputTokens + g.outputTokens,
        cost: acc.cost + g.cost,
      }),
      { inputTokens: 0, outputTokens: 0, cost: 0 },
    );

    const failed = generated.filter((g) => g.error).map((g) => ({ platform: g.platform, error: g.error }));

    await logAgentRun({
      client_id,
      agent_type: 'creative',
      status: failed.length === platforms.length ? 'error' : 'completed',
      input_tokens: totals.inputTokens,
      output_tokens: totals.outputTokens,
      cost_usd: totals.cost,
      output_summary: `Generated ${inserted} posts across ${platforms.join(', ')} for ${companyName}`,
      metadata: {
        platforms,
        days,
        vertical,
        start_date: isoDate(start),
        end_date: isoDate(endDate),
        posts_per_platform: generated.map((g) => ({ platform: g.platform, count: g.posts.length })),
        failed,
      },
    });

    if (inserted === 0) {
      return NextResponse.json(
        { error: 'No posts could be generated.', failed },
        { status: 502 },
      );
    }

    return NextResponse.json({
      client_id,
      company_name: companyName,
      vertical,
      days,
      start_date: isoDate(start),
      end_date: isoDate(endDate),
      platforms,
      generated: inserted,
      per_platform: generated.map((g) => ({ platform: g.platform, count: g.posts.length })),
      // Present only when a platform came back empty — the rest still saved.
      failed: failed.length ? failed : undefined,
    });
  } catch (err: any) {
    console.error('[creative] POST failed:', err);
    return serverError(err, 'agents/creative');
  }
}

// GET /api/agents/creative?client_id=…&platform=instagram&status=draft
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

    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }

    let query = supabaseAdmin
      .from('content_calendar')
      .select('id, client_id, platform, post_date, content, hook, cta, status, scheduled_at, performance_json, created_at')
      .eq('client_id', client_id)
      .order('post_date', { ascending: true, nullsFirst: false })
      .order('platform', { ascending: true });

    const platform = searchParams.get('platform');
    if (platform) query = query.eq('platform', platform.toLowerCase().trim());

    const status = searchParams.get('status');
    if (status) query = query.eq('status', status.toLowerCase().trim());

    const from = searchParams.get('from');
    if (from) query = query.gte('post_date', from);

    const to = searchParams.get('to');
    if (to) query = query.lte('post_date', to);

    const { data, error } = await query;

    if (error) {
      console.error('[creative] GET failed:', error.message);
      return serverError(error, 'agents/creative');
    }

    const posts = data || [];

    return NextResponse.json({
      client_id,
      total: posts.length,
      by_status: posts.reduce((acc: Record<string, number>, p: any) => {
        acc[p.status || 'draft'] = (acc[p.status || 'draft'] || 0) + 1;
        return acc;
      }, {}),
      posts,
    });
  } catch (err: any) {
    console.error('[creative] GET failed:', err);
    return serverError(err, 'agents/creative');
  }
}
