const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ── MODEL SWITCH ── change this ONE line to swap models everywhere ──
const ACTIVE_MODEL = 'anthropic/claude-sonnet-5'

// Options for ACTIVE_MODEL:
//   'google/gemini-2.0-flash-exp:free' → free, fast, good JSON (current)
//   'openai/gpt-oss-20b:free'          → free, alternative
//   'meta-llama/llama-3.3-70b-instruct:free' → free, bigger, slower
//   'anthropic/claude-sonnet-5'        → paid, most reliable (use for pilot)

export const MODELS = {
  SONNET: ACTIVE_MODEL,
  HAIKU: ACTIVE_MODEL,
}

const COSTS: Record<string, { input: number, output: number }> = {
  'google/gemini-2.0-flash-exp:free': { input: 0, output: 0 },
  'openai/gpt-oss-20b:free': { input: 0, output: 0 },
  'meta-llama/llama-3.3-70b-instruct:free': { input: 0, output: 0 },
  'anthropic/claude-sonnet-5': { input: 0.000002, output: 0.00001 },
}

export async function callAI(params: {
  model: string,
  system: string,
  user: string,
  maxTokens?: number,
}): Promise<{ text: string, inputTokens: number, outputTokens: number, cost: number }> {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens || 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  })
  if (response.status === 429) {
    throw new Error('Free model rate limited — try again or switch ACTIVE_MODEL')
  }
  const data = await response.json()
  if (!data.choices) {
    throw new Error('OpenRouter error: ' + JSON.stringify(data))
  }
  const text = data.choices[0].message.content
  const inputTokens = data.usage?.prompt_tokens || 0
  const outputTokens = data.usage?.completion_tokens || 0
  const c = COSTS[params.model] || { input: 0, output: 0 }
  const cost = (inputTokens * c.input) + (outputTokens * c.output)
  return { text, inputTokens, outputTokens, cost }
}

export function parseJSON(text: string): any {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in response: ' + text)
  }
  let cleaned = text.slice(start, end + 1)
  // Free models often emit Unicode smart quotes instead of straight quotes,
  // which JSON.parse rejects — normalize them back to ASCII quotes.
  cleaned = cleaned
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
  return JSON.parse(cleaned)
}
