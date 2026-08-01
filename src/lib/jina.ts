// Reads websites via Jina Reader (free, no API key required).

export async function readWebsite(url: string, maxChars: number = 6000): Promise<string> {
  try {
    const response = await fetch('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain' },
    })
    if (!response.ok) return ''
    const text = await response.text()
    return text.slice(0, maxChars)
  } catch (e) {
    console.error('Jina failed:', e)
    return ''
  }
}
