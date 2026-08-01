import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';

const CALL_RESOLUTION_TARGET_PCT = 65;

const FORBIDDEN_PHRASES = [
  'things are generally positive',
  'overall performance is strong',
  'great week overall',
  'on the right track',
];

type Metrics = {
  calls_handled: number;
  calls_resolved: number;
  calls_escalated: number;
  avg_sentiment: number;
  reviews_total: number;
  reviews_responded: number;
  invoices_sent: number;
  invoices_paid: number;
  invoices_overdue: number;
};

function getMondayDateString(d = new Date()): string {
  const date = new Date(d);
  const day = date.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day; // days back to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

async function countRows(
  table: string,
  client_id: string,
  since: string,
  extra?: (q: any) => any,
): Promise<number> {
  let q = supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client_id)
    .gte('created_at', since);
  if (extra) q = extra(q);
  const { count } = await q;
  return count || 0;
}

// Gathers the last-7-days KPIs from Supabase when the caller doesn't supply them.
// Note: call_transcripts has no `resolved` column, only `escalated` — a call
// that didn't need to escalate is treated as resolved.
async function gatherMetrics(client_id: string, since: string): Promise<Metrics> {
  const calls_handled = await countRows('call_transcripts', client_id, since);
  const calls_escalated = await countRows('call_transcripts', client_id, since, (q) =>
    q.eq('escalated', true),
  );
  const calls_resolved = calls_handled - calls_escalated;

  const { data: sentimentRows } = await supabaseAdmin
    .from('call_transcripts')
    .select('sentiment_score')
    .eq('client_id', client_id)
    .gte('created_at', since);
  const avg_sentiment = sentimentRows?.length
    ? Math.round(
        sentimentRows.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) /
          sentimentRows.length,
      )
    : 0;

  const reviews_total = await countRows('reviews', client_id, since);
  const reviews_responded = await countRows('reviews', client_id, since, (q) =>
    q.eq('responded', true),
  );

  const invoices_sent = await countRows('invoices', client_id, since);
  const invoices_paid = await countRows('invoices', client_id, since, (q) =>
    q.eq('status', 'paid'),
  );
  const invoices_overdue = await countRows('invoices', client_id, since, (q) =>
    q.eq('status', 'overdue'),
  );

  return {
    calls_handled,
    calls_resolved,
    calls_escalated,
    avg_sentiment,
    reviews_total,
    reviews_responded,
    invoices_sent,
    invoices_paid,
    invoices_overdue,
  };
}

function computeWareScore(metrics: Metrics, agentRunsCount: number): number {
  const raw =
    metrics.calls_resolved * 10 +
    metrics.reviews_responded * 15 +
    metrics.invoices_paid * 20 +
    agentRunsCount * 2;
  return Math.max(0, Math.min(1000, raw));
}

function buildSystemPrompt(companyName: string): string {
  return `You are the BI Reporter for ${companyName}. Write an HONEST Monday Brief. Tell the truth, no spin.

MANDATORY sections (all 5):
1) WARE Score with one-line meaning
2) What's Working — one specific win with a number
3) What's Not Working — MANDATORY, must name at least one below-target metric, never skip, never spin positive
4) Recommended Action — ONE specific thing
5) Hot Items — anything needing attention

Format as clean HTML with inline styles (email-safe).

FORBIDDEN phrases, never use: 'things are generally positive', 'overall performance is strong', 'great week overall', 'on the right track'.

Return ONLY JSON: { brief_html: string, ware_score: number, has_negative_section: boolean, summary: string }`;
}

function buildUserMessage(metrics: Metrics, agentRunsCount: number, wareScore: number): string {
  const callResolutionPct = metrics.calls_handled
    ? Math.round((metrics.calls_resolved / metrics.calls_handled) * 100)
    : 0;
  const reviewResponsePct = metrics.reviews_total
    ? Math.round((metrics.reviews_responded / metrics.reviews_total) * 100)
    : 0;
  const invoicePaidPct = metrics.invoices_sent
    ? Math.round((metrics.invoices_paid / metrics.invoices_sent) * 100)
    : 0;

  return `This week's raw metrics (last 7 days):
- Calls handled: ${metrics.calls_handled}, resolved: ${metrics.calls_resolved} (${callResolutionPct}% resolution rate), escalated: ${metrics.calls_escalated}
- Average call sentiment: ${metrics.avg_sentiment}/100
- Reviews: ${metrics.reviews_total} total, ${metrics.reviews_responded} responded (${reviewResponsePct}% response rate)
- Invoices: ${metrics.invoices_sent} sent, ${metrics.invoices_paid} paid (${invoicePaidPct}%), ${metrics.invoices_overdue} overdue
- Agent automation runs: ${agentRunsCount}

Target benchmark: call resolution rate should be at or above ${CALL_RESOLUTION_TARGET_PCT}%.

The WARE Score for this week has already been calculated as ${wareScore}/1000 — use this exact number, do not recalculate it.`;
}

function hasForbiddenPhrase(html: string): boolean {
  const lower = html.toLowerCase();
  return FORBIDDEN_PHRASES.some((p) => lower.includes(p));
}

// Retries on malformed JSON AND on content that fails the anti-sycophancy
// requirements (no negative section, or a forbidden spin phrase slipped in).
async function generateBrief(
  system: string,
  user: string,
): Promise<{ ai: Awaited<ReturnType<typeof callAI>>; analysis: any }> {
  const MAX_ATTEMPTS = 3;
  let lastGood: { ai: Awaited<ReturnType<typeof callAI>>; analysis: any } | undefined;
  let lastParseError: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ai = await callAI({
      model: MODELS.SONNET,
      system,
      user,
      maxTokens: 3000,
    });
    try {
      const analysis = parseJSON(ai.text);
      lastGood = { ai, analysis };
      const failsContent =
        analysis.has_negative_section !== true || hasForbiddenPhrase(analysis.brief_html || '');
      if (!failsContent) {
        return { ai, analysis };
      }
      console.error(
        `[bi-reporter] Attempt ${attempt}/${MAX_ATTEMPTS} parsed but failed anti-sycophancy check (has_negative_section=${analysis.has_negative_section}, forbidden phrase=${hasForbiddenPhrase(analysis.brief_html || '')}).`,
      );
    } catch (e: any) {
      lastParseError = e;
      console.error(
        `[bi-reporter] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}\nRAW MODEL OUTPUT >>>\n${ai.text}\n<<< END RAW`,
      );
    }
  }

  if (lastGood) {
    console.error('[bi-reporter] Returning best-effort brief after failing anti-sycophancy check on all attempts.');
    return lastGood;
  }

  throw new Error(
    `Model returned malformed JSON after ${MAX_ATTEMPTS} attempts (try again or switch ACTIVE_MODEL). Last parse error: ${lastParseError?.message}`,
  );
}

// Shared logic, reused by the test route.
export async function runBiReporter(
  client_id: string,
  metrics?: Metrics,
): Promise<{ status: number; body: any }> {
  const { brand } = await getClientContext(client_id);
  const companyName = brand?.company_name || 'your company';

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const resolvedMetrics = metrics || (await gatherMetrics(client_id, since));
  const agentRunsCount = await countRows('agent_runs', client_id, since);
  const wareScore = computeWareScore(resolvedMetrics, agentRunsCount);

  const system = buildSystemPrompt(companyName);
  const user = buildUserMessage(resolvedMetrics, agentRunsCount, wareScore);

  const { ai, analysis } = await generateBrief(system, user);
  const tokensUsed = ai.inputTokens + ai.outputTokens;

  // The formula-computed score is authoritative regardless of what the model echoed back.
  const finalWareScore = wareScore;
  const briefHtml = analysis.brief_html;
  const hasNegativeSection = !!analysis.has_negative_section;

  await supabaseAdmin.from('weekly_briefs').insert({
    client_id,
    week_start: getMondayDateString(),
    ware_score: finalWareScore,
    brief_html: briefHtml,
    has_negative_section: hasNegativeSection,
  });

  await logAgentRun({
    client_id,
    agent_type: 'bi_reporter',
    status: 'completed',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary: `Monday Brief generated (WARE ${finalWareScore}/1000)`,
  });

  return {
    status: 200,
    body: {
      brief_html: briefHtml,
      ware_score: finalWareScore,
      has_negative_section: hasNegativeSection,
      summary: analysis.summary,
      cost_usd: ai.cost,
      tokens_used: tokensUsed,
    },
  };
}

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { client_id, metrics } = await req.json();

    if (!client_id) {
      return NextResponse.json(
        { error: 'client_id is required.' },
        { status: 400 },
      );
    }

    const { status, body } = await runBiReporter(client_id, metrics);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[bi-reporter] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
