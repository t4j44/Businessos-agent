import { createHmac, timingSafeEqual } from 'node:crypto'

/** https://docs.bland.ai/tutorials/webhook-signing */
export function verifyBlandSignature(body: string, signature: string | null, secret = process.env.BLAND_WEBHOOK_SECRET): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(body).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const phone = value.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null
}

export type InboundNumber = { phone_number: string; webhook?: string; prompt?: string; pathway_id?: string }
export const getBlandClient = () => ({
  async listInboundNumbers(): Promise<InboundNumber[]> {
    if (!process.env.BLAND_API_KEY) throw new Error('Voice provider is not configured.')
    const res = await fetch('https://api.bland.ai/v1/inbound', {
      headers: { authorization: process.env.BLAND_API_KEY }, signal: AbortSignal.timeout(10_000), cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Voice provider returned HTTP ${res.status}.`)
    const body = await res.json()
    if (!Array.isArray(body.inbound_numbers)) throw new Error('Voice provider returned an invalid number list.')
    return body.inbound_numbers
  },
})
