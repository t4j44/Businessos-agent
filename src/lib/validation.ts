export class ValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Confirmations use an exact local time; requests can still say "afternoon". */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim())
  if (!match || (!match[2] && !match[3])) return null
  let hour = Number(match[1])
  const minute = Number(match[2] || '0')
  const period = match[3]?.toLowerCase()
  if (minute > 59 || hour > (period ? 12 : 23) || (period && hour < 1)) return null
  if (period) hour = hour % 12 + (period === 'pm' ? 12 : 0)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Bound the actual stream, including chunked requests without Content-Length. */
export async function readJsonBody(req: Request, maxBytes = 32_768): Promise<Record<string, any>> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new ValidationError('Request is too large.', 413)
  const reader = req.body?.getReader()
  if (!reader) throw new ValidationError('A JSON object is required.')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new ValidationError('Request is too large.', 413)
      }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { throw new ValidationError('A valid JSON object is required.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('A JSON object is required.')
  return body as Record<string, any>
}
