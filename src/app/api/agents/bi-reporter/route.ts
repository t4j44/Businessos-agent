import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { retrieveContext, storeRAGChunk } from '@/lib/embeddings';

import { getMondayDateString } from '@/lib/week';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';

async function countRows(
  table: string,
  client_id: string,
  since: string,
  extra?: (q: any) => any,
): Promise<number> {
  try {
    let q = supabaseAdmin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .gte('created_at', since);
    if (extra) q = extra(q);
    const { count, error } = await q;
    if (error) {
      console.error(`[bi-reporter] countRows error on ${table}:`, error.message);
      return 0;
    }
    return count || 0;
  } catch (err: any) {
    console.error(`[bi-reporter] countRows exception on ${table}:`, err.message);
    return 0;
  }
}

async function gatherMetrics(client_id: string, since: string) {
  // 1. call_transcripts
  const calls_total = await countRows('call_transcripts', client_id, since);
  const calls_escalated = await countRows('call_transcripts', client_id, since, (q) => q.eq('escalated', true));
  const calls_resolved = calls_total - calls_escalated;
  
  let avg_sentiment = 0;
  try {
    const { data: sentimentRows } = await supabaseAdmin
      .from('call_transcripts')
      .select('sentiment_score')
      .eq('client_id', client_id)
      .gte('created_at', since);
    if (sentimentRows && sentimentRows.length > 0) {
      avg_sentiment = Math.round(
        sentimentRows.reduce((sum, r) => sum + (r.sentiment_score || 0), 0) / sentimentRows.length
      );
    }
  } catch (err) {
    console.error('[bi-reporter] avg_sentiment query failed:', err);
  }

  // 2. reviews
  const reviews_total = await countRows('reviews', client_id, since);
  const reviews_responded = await countRows('reviews', client_id, since, (q) => q.eq('responded', true));
  
  let avg_rating = 0;
  try {
    const { data: ratingRows } = await supabaseAdmin
      .from('reviews')
      .select('star_rating')
      .eq('client_id', client_id)
      .gte('created_at', since);
    if (ratingRows && ratingRows.length > 0) {
      avg_rating = Math.round((ratingRows.reduce((sum, r) => sum + (r.star_rating || 0), 0) / ratingRows.length) * 10) / 10;
    }
  } catch (err) {
    console.error('[bi-reporter] avg_rating query failed:', err);
  }

  // 3. invoices
  const invoices_total = await countRows('invoices', client_id, since);
  const invoices_paid = await countRows('invoices', client_id, since, (q) => q.eq('status', 'paid'));
  const invoices_overdue = await countRows('invoices', client_id, since, (q) => q.eq('status', 'overdue'));
  
  let invoices_sum_amount_due = 0;
  try {
    const { data: invoiceRows } = await supabaseAdmin
      .from('invoices')
      .select('amount_cents')
      .eq('client_id', client_id)
      .gte('created_at', since);
    if (invoiceRows) {
      const sumCents = invoiceRows.reduce((sum, r) => sum + (r.amount_cents || 0), 0);
      invoices_sum_amount_due = sumCents / 100;
    }
  } catch (err) {
    console.error('[bi-reporter] invoices_sum_amount_due query failed:', err);
  }

  // 4. agent_runs
  const agent_runs_total = await countRows('agent_runs', client_id, since);
  
  let agent_runs_sum_cost_usd = 0;
  try {
    const { data: runRows } = await supabaseAdmin
      .from('agent_runs')
      .select('cost_usd')
      .eq('client_id', client_id)
      .gte('created_at', since);
    if (runRows) {
      agent_runs_sum_cost_usd = runRows.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
    }
  } catch (err) {
    console.error('[bi-reporter] agent_runs_sum_cost_usd query failed:', err);
  }

  // 5. contacts
  let contacts_at_risk = 0;
  try {
    const { count } = await supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .gte('created_at', since)
      .lt('score', 30);
    contacts_at_risk = count || 0;
  } catch (err) {
    console.error('[bi-reporter] contacts_at_risk query failed:', err);
  }

  return {
    calls: {
      total: calls_total,
      resolved: calls_resolved,
      escalated: calls_escalated,
      avg_sentiment,
    },
    reviews: {
      total: reviews_total,
      avg_rating,
      responded: reviews_responded,
    },
    invoices: {
      total: invoices_total,
      paid: invoices_paid,
      overdue: invoices_overdue,
      sum_amount_due: invoices_sum_amount_due,
    },
    agent_runs: {
      total: agent_runs_total,
      sum_cost_usd: agent_runs_sum_cost_usd,
    },
    contacts: {
      at_risk: contacts_at_risk,
    },
  };
}

function buildSystemPrompt(
  companyName: string,
  brandContext: string,
  hasIntelligence: boolean,
): string {
  return `You are a brutally honest COO writing a weekly brief for ${companyName}.
Brand context: ${brandContext}

RULES YOU CANNOT BREAK:
1. Never say things are going well if metrics are below target
2. Always flag when call resolution is below 65%
3. Always flag when invoice collection is below 70%
4. Always flag when review response rate is below 80%
5. Include a section called What Is Not Working even if everything looks fine — find something to improve
6. Never use the words: great, amazing, fantastic, excellent, outstanding
7. Recommended Action must be specific and measurable, not generic advice

Generate a brief with exactly these ${hasIntelligence ? '6' : '5'} sections:
1. WARE Score (0-1000): Provide the score and a one-line meaning.
2. What Is Working
3. What Is Not Working
4. Recommended Action (one specific action)
5. Hot Items (bullet list of things needing attention)${hasIntelligence ? `
6. Intelligence Briefing — Nightwatch data is present below. Include a brief section
   summarising the top competitor move, the top audience insight, and the top trend
   opportunity.` : ''}

Format as clean HTML with inline styles (email-safe). Do not include markdown code block syntax like \`\`\`html. 

Return ONLY valid JSON: 
{ 
  "brief_html": "string",
  "what_is_not_working_summary": "a short 1-sentence summary of what is not working" 
}`;
}

function buildUserMessage(
  metrics: any,
  wareScore: number,
  intelligenceReport?: any,
): string {
  const callResolutionPct = metrics.calls.total
    ? Math.round((metrics.calls.resolved / metrics.calls.total) * 100)
    : 0;
  const reviewResponsePct = metrics.reviews.total
    ? Math.round((metrics.reviews.responded / metrics.reviews.total) * 100)
    : 0;
  const invoicePaidPct = metrics.invoices.total
    ? Math.round((metrics.invoices.paid / metrics.invoices.total) * 100)
    : 0;

  const base = `This week's raw metrics (last 7 days):
- Calls: ${metrics.calls.total} total, ${metrics.calls.resolved} resolved (${callResolutionPct}% resolution rate), ${metrics.calls.escalated} escalated, ${metrics.calls.avg_sentiment}/100 avg sentiment
- Reviews: ${metrics.reviews.total} total, ${metrics.reviews.avg_rating} avg rating, ${metrics.reviews.responded} responded (${reviewResponsePct}% response rate)
- Invoices: ${metrics.invoices.total} sent, ${metrics.invoices.paid} paid (${invoicePaidPct}% collection rate), ${metrics.invoices.overdue} overdue, sum amount due: $${metrics.invoices.sum_amount_due}
- Agent Runs: ${metrics.agent_runs.total} total runs, sum cost: $${metrics.agent_runs.sum_cost_usd}
- Contacts: ${metrics.contacts.at_risk} at-risk customers (score < 30)

The WARE Score for this week is ${wareScore}/1000.`;

  if (!intelligenceReport) return base;

  return (
    base +
    '\n\nNIGHTWATCH INTELLIGENCE REPORT (from overnight agents):\n' +
    JSON.stringify(intelligenceReport)
  );
}

async function generateBrief(system: string, user: string) {
  const MAX_ATTEMPTS = 3;
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
      return { ai, analysis };
    } catch (e: any) {
      lastParseError = e;
      console.error(
        `[bi-reporter] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}\nRAW MODEL OUTPUT >>>\n${ai.text}\n<<< END RAW`,
      );
    }
  }

  throw new Error(`Model returned malformed JSON after ${MAX_ATTEMPTS} attempts. Last error: ${lastParseError?.message}`);
}

export async function runBiReporter(client_id: string, overrideMetrics?: any, week_start_date?: string) {
  // ── BEFORE ACTING ────────────────────────────────────────────────────────
  const since = week_start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const brandContext = await retrieveContext('brand identity and business description', client_id, 'performance');
  const metrics = overrideMetrics || await gatherMetrics(client_id, since);

  // ── CORE ACTION ────────────────────────────────────────────────────────
  const { brand } = await getClientContext(client_id);
  const companyName = brand?.company_name || 'your company';

  const call_resolution_rate = metrics.calls.total > 0 ? (metrics.calls.resolved / metrics.calls.total) : 0;
  const invoice_collection_rate = metrics.invoices.total > 0 ? (metrics.invoices.paid / metrics.invoices.total) : 0;
  const review_response_rate = metrics.reviews.total > 0 ? (metrics.reviews.responded / metrics.reviews.total) : 0;

  const ware_score = Math.round(
    (call_resolution_rate * 300) + 
    (invoice_collection_rate * 300) + 
    (review_response_rate * 200) + 
    ((metrics.calls.avg_sentiment / 100) * 200)
  );

  // Nightwatch writes its overnight synthesis onto this week's brief row.
  // Multiple briefs can exist for one week (the cron plus a manual
  // "Generate Brief" click), so this takes the newest rather than
  // .maybeSingle(), which would throw on more than one match.
  const intelligenceWeek = week_start_date ? week_start_date.slice(0, 10) : getMondayDateString();
  let intelligenceReport: any = null;
  try {
    const { data: briefRows } = await supabaseAdmin
      .from('weekly_briefs')
      .select('intelligence_report_json')
      .eq('client_id', client_id)
      .eq('week_start', intelligenceWeek)
      .order('created_at', { ascending: false })
      .limit(1);
    intelligenceReport = briefRows?.[0]?.intelligence_report_json || null;
  } catch (err) {
    // Missing column (migration 015 unapplied) or an unreachable row must not
    // stop the brief — it just loses the intelligence section.
    console.warn('[bi-reporter] intelligence lookup failed:', err);
  }

  const system = buildSystemPrompt(companyName, brandContext, !!intelligenceReport);
  const user = buildUserMessage(metrics, ware_score, intelligenceReport);

  let aiResult;
  let briefHtml = '';
  let whatIsNotWorkingSummary = '';
  try {
    const { ai, analysis } = await generateBrief(system, user);
    aiResult = ai;
    briefHtml = analysis.brief_html || '';
    whatIsNotWorkingSummary = analysis.what_is_not_working_summary || 'Needs improvement.';
  } catch (err: any) {
    await logAgentRun({
      client_id,
      agent_type: 'bi_reporter',
      status: 'error',
      output_summary: 'Failed to generate brief',
      metadata: { error: err?.message || String(err) },
    });
    return { status: 500, body: { success: false, error: err?.message || String(err) } };
  }

  // ── AFTER ACTING ────────────────────────────────────────────────────────
  const week_start = week_start_date ? week_start_date.slice(0, 10) : getMondayDateString();

  const { data: savedBrief, error: dbError } = await supabaseAdmin
    .from('weekly_briefs')
    .insert({
      client_id,
      week_start,
      ware_score,
      brief_html: briefHtml,
      key_metrics_json: metrics,
    })
    .select('id')
    .single();

  if (dbError) {
    console.error('[bi-reporter] Save to weekly_briefs failed:', dbError);
  }

  await storeRAGChunk({
    client_id,
    content: 'Weekly performance: WARE score ' + ware_score + '. ' + whatIsNotWorkingSummary,
    chunk_type: 'performance',
    source_agent: 'bi_reporter',
  });

  await logAgentRun({
    client_id,
    agent_type: 'bi_reporter',
    status: 'completed',
    input_tokens: aiResult?.inputTokens || 0,
    output_tokens: aiResult?.outputTokens || 0,
    cost_usd: aiResult?.cost || 0,
    output_summary: `Generated weekly brief with WARE score ${ware_score}`,
  });

  return {
    status: 200,
    body: {
      success: true,
      brief_id: savedBrief?.id || null, // So generate route can update sent_at
      ware_score,
      brief_html: briefHtml,
      metrics: {
        calls: metrics.calls,
        reviews: metrics.reviews,
        invoices: metrics.invoices,
        agent_runs: metrics.agent_runs,
      },
      saved_to_db: !dbError,
    },
  };
}

export async function POST(req: Request) {
  let clientId: string;
  let reqBody: any = {};
  try {
    reqBody = await req.json().catch(() => ({}));
    ({ clientId } = await requireCronOrSession(req, reqBody?.client_id));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const client_id = clientId;
    const week_start_date = reqBody?.week_start_date;

    if (!client_id) {
      return NextResponse.json(
        { success: false, error: 'client_id is required.' },
        { status: 400 },
      );
    }

    const { status, body } = await runBiReporter(client_id, undefined, week_start_date);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[bi-reporter] POST failed:', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
