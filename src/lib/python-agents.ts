const PYTHON_AGENTS_URL = process.env.PYTHON_AGENTS_URL || ''

export async function callPythonAgent(
  clientId: string,
  trigger: string,
  payload: Record<string, any> = {}
): Promise<{ output: string, actions: string[] } | null> {
  if (!PYTHON_AGENTS_URL) {
    console.warn('PYTHON_AGENTS_URL not set — skipping Python agent')
    return null
  }
  try {
    const res = await fetch(PYTHON_AGENTS_URL + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, trigger, payload })
    })
    if (!res.ok) throw new Error('Python agent failed: ' + res.status)
    const data = await res.json()
    return data.result
  } catch (e) {
    console.error('Python agent error:', e)
    return null
  }
}

export async function scrapeWithPython(url: string): Promise<string> {
  if (!PYTHON_AGENTS_URL) return ''
  try {
    const res = await fetch(PYTHON_AGENTS_URL + '/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
    const data = await res.json()
    return data.markdown || ''
  } catch { return '' }
}
