import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../../lib/supabase';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface RagChunk {
  content: string;
  similarity: number;
}

async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY not configured');

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'voyage-3-lite', input: [text] }),
  });
  if (!res.ok) throw new Error(`Voyage AI error: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding as number[];
}

async function retrieveChunks(clientId: string, embedding: number[], topK = 5): Promise<RagChunk[]> {
  const { data, error } = await supabaseServer.rpc('match_rag_chunks', {
    query_embedding: embedding,
    match_client_id: clientId,
    match_count: topK,
  });
  if (error) throw new Error(`RAG retrieval error: ${error.message}`);
  return (data ?? []) as RagChunk[];
}

async function callClaude(systemPrompt: string, messages: Message[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text as string;
}

function classifyResponse(text: string): 'qualified_prospect' | 'support' | 'browser' {
  const lower = text.toLowerCase();
  const buySignals = ['price', 'cost', 'plan', 'subscribe', 'sign up', 'get started', 'trial', 'demo', 'book', 'schedule', 'purchase', 'buy'];
  const supportSignals = ['problem', 'issue', 'error', 'broken', 'help', 'not working', 'bug', 'support'];

  const hasBuy = buySignals.some(s => lower.includes(s));
  const hasSupport = supportSignals.some(s => lower.includes(s));

  if (hasBuy && !hasSupport) return 'qualified_prospect';
  if (hasSupport) return 'support';
  return 'browser';
}

async function checkBudget(clientId: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('api_usage')
    .select('tokens_used, token_limit')
    .eq('client_id', clientId)
    .maybeSingle();

  if (!data) return true; // no record = no limit enforced yet
  return data.tokens_used < data.token_limit;
}

async function logAgentRun(
  clientId: string,
  sessionId: string,
  userMessage: string,
  response: string,
  classification: string,
  tokensUsed: number,
) {
  await supabaseServer.from('agent_runs').insert({
    client_id: clientId,
    agent_type: 'receptionist',
    input_text: userMessage,
    output_text: response,
    metadata: { session_id: sessionId, classification, tokens_used: tokensUsed },
    status: 'completed',
  });

  // Increment token counter — ignore failure (non-critical)
  const { error: incrementError } = await supabaseServer.rpc('increment_api_usage', {
    p_client_id: clientId,
    p_tokens: tokensUsed,
  });
  if (incrementError) console.error('increment_api_usage failed:', incrementError);
}

// ── Dev test client constants ────────────────────────────────────────────────

const DEV_SYSTEM_PROMPT = `You are the AI receptionist for DevStack, a developer tools platform.

DevStack helps engineering teams design, test, and ship APIs 10x faster.

Products:
- API Builder: Visual API design with auto-generated SDKs for 12 languages
- Analytics Dashboard: Real-time monitoring, P95/P99 latency, error rates
- Team Collaboration: Shared workspaces, PR-style API reviews, role-based access

Pricing:
- Starter: $49/month — 5 projects, basic analytics, 10K API calls/day, email support
- Pro: $149/month — unlimited projects, real-time analytics, 500K calls/day, team collab
- Enterprise: Custom — SSO, SLA, unlimited calls, audit logs, custom integrations

Free trial available. No credit card required.

Tone: Technical, direct, confident. You speak to developers. Be concise (2-3 sentences max).
If someone asks about pricing, demos, or seems interested in buying, encourage a free trial.`;

function getDemoResponse(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('price') || lower.includes('cost') || lower.includes('how much') || lower.includes('plan')) {
    return "Our plans start at $49/month for Starter. Pro is $149/month with unlimited projects and real-time analytics. Enterprise pricing is custom — want to start a free trial?";
  }
  if (lower.includes('demo') || lower.includes('call') || lower.includes('schedule') || lower.includes('meeting')) {
    return "I'd love to arrange a demo! Our team can walk you through the API Builder, Analytics Dashboard, and Team Collaboration features. What time works best for you?";
  }
  if (lower.includes('help') || lower.includes('problem') || lower.includes('issue') || lower.includes('not work') || lower.includes('broken') || lower.includes('error') || lower.includes('support')) {
    return "I can connect you with our support team right away. For immediate help, our docs at docs.devstack.io cover most common issues. What are you experiencing?";
  }
  return "Great question! DevStack helps teams ship APIs 10x faster — visual API design, real-time monitoring, and team collaboration built in. Anything specific I can help with?";
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { client_id, session_id, message, conversation_history = [] } = body as {
      client_id: string;
      session_id: string;
      message: string;
      conversation_history: Message[];
    };

    if (!client_id || !session_id || !message) {
      return NextResponse.json(
        { error: 'client_id, session_id, and message are required' },
        { status: 400, headers: CORS },
      );
    }

    // ── Dev test client: skip all DB/Voyage lookups ──────────────────────────
    if (client_id === 'dev-test-client') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const response = getDemoResponse(message);
        const classification = classifyResponse(message + ' ' + response);
        return NextResponse.json({ response, classification, session_id }, { headers: CORS });
      }
      const msgs: Message[] = [
        ...(conversation_history as Message[]).slice(-10),
        { role: 'user', content: message },
      ];
      const responseText = await callClaude(DEV_SYSTEM_PROMPT, msgs);
      const classification = classifyResponse(message + ' ' + responseText);
      return NextResponse.json({ response: responseText, classification, session_id }, { headers: CORS });
    }

    // 1. Fetch brand config and verify client exists
    const [profileRes, clientRes] = await Promise.all([
      supabaseServer
        .from('brand_profiles')
        .select('company_name, greeting_text, booking_url')
        .eq('client_id', client_id)
        .maybeSingle(),
      supabaseServer
        .from('clients')
        .select('name, plan_tier')
        .eq('id', client_id)
        .maybeSingle(),
    ]);

    if (!clientRes.data) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: CORS });
    }

    const companyName = profileRes.data?.company_name ?? clientRes.data.name ?? 'us';
    const bookingUrl = profileRes.data?.booking_url ?? null;

    // 2. Check api_usage budget
    const withinBudget = await checkBudget(client_id);
    if (!withinBudget) {
      return NextResponse.json(
        { response: `I'm sorry, I'm unable to process more requests right now. Please contact ${companyName} directly.`, classification: 'browser', session_id },
        { headers: CORS },
      );
    }

    // 3. Embed the user message
    let ragContext = '';
    try {
      const embedding = await embedText(message);
      const chunks = await retrieveChunks(client_id, embedding);
      if (chunks.length > 0) {
        ragContext = chunks.map((c: RagChunk) => c.content).join('\n\n---\n\n');
      }
    } catch {
      // RAG is best-effort — continue without it if Voyage AI or DB fails
    }

    // 4. Build system prompt
    const systemPrompt = [
      `You are the AI receptionist for ${companyName}.`,
      'You are helpful, professional, and concise. Keep responses under 3 sentences.',
      'Only answer questions about this business and its services.',
      'Do not make up information. If you do not know something, say so.',
      ragContext
        ? `\nHere is relevant information about ${companyName}:\n\n${ragContext}`
        : '',
      '\nIf the visitor seems interested in purchasing or scheduling, encourage them to book a call or start a trial.',
    ].filter(Boolean).join('\n');

    // 5. Build message history (cap at last 10 messages to control tokens)
    const history = conversation_history.slice(-10);
    const messages: Message[] = [...history, { role: 'user', content: message }];

    // 6. Call Claude Sonnet 4.6
    const responseText = await callClaude(systemPrompt, messages);

    // 7. Classify based on combined user message + assistant response context
    const combinedContext = message + ' ' + responseText;
    const classification = classifyResponse(combinedContext);

    // 8. Build response payload; include booking offer when appropriate
    const payload: Record<string, unknown> = {
      response: responseText,
      classification,
      session_id,
    };

    if (classification === 'qualified_prospect' && history.length > 3 && bookingUrl) {
      payload.booking_offer = {
        url: bookingUrl,
        label: `Book a call with ${companyName}`,
      };
    }

    // 9. Log to agent_runs (fire-and-forget, don't block response)
    const estimatedTokens = Math.ceil((systemPrompt.length + message.length + responseText.length) / 4);
    logAgentRun(client_id, session_id, message, responseText, classification, estimatedTokens).catch(() => null);

    return NextResponse.json(payload, { headers: CORS });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS });
  }
}
