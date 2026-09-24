import { NextResponse } from 'next/server'
import { requireSession, authErrorResponse } from '@/lib/auth-guard'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid, readJsonBody, ValidationError } from '@/lib/validation'
import { processSchedulerDelivery, reconcileSchedulerDelivery } from '@/lib/scheduler-outbox'

export async function GET(req: Request) {
  try {
    const { clientId } = await requireSession()
    const page = Number(new URL(req.url).searchParams.get('page') || 1)
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ValidationError('Invalid page.')
    const { data, error, count } = await supabaseAdmin.from('scheduler_outbox')
      .select('id,appointment_id,kind,version,status,attempts,first_attempt_at,provider_id,last_error,available_at,created_at,updated_at', { count: 'exact' })
      .eq('client_id', clientId).order('created_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1)
    if (error) return NextResponse.json({ error: 'Delivery history unavailable.' }, { status: 503 })
    return NextResponse.json({ deliveries: data, page, total: count })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Delivery history unavailable.' }, { status: 503 })
  }
}

export async function POST(req: Request) {
  try {
    const { clientId, userId } = await requireSession()
    const body = await readJsonBody(req, 2048)
    if (!isUuid(body.id)) throw new ValidationError('A valid delivery id is required.')
    if (body.action === 'reconcile') {
      if (!isUuid(body.provider_id)) throw new ValidationError('Enter the provider email receipt UUID.')
      const verified = await reconcileSchedulerDelivery(clientId, userId, body.id, body.provider_id)
      return NextResponse.json(verified ? { status: 'accepted' } : { error: 'The provider receipt could not be matched to this delivery.' }, { status: verified ? 200 : 409 })
    }
    if (body.action && body.action !== 'retry') throw new ValidationError('Unknown delivery action.')
    const { data, error } = await supabaseAdmin.rpc('retry_scheduler_delivery', { p_client_id: clientId, p_id: body.id })
    if (error) return NextResponse.json({ error: 'Retry could not be saved.' }, { status: 503 })
    if (!data) return NextResponse.json({ error: 'This delivery is unavailable, already accepted, busy, or requires provider reconciliation.' }, { status: 409 })
    const result = await processSchedulerDelivery(clientId, body.id)
    return NextResponse.json(result, { status: ['storage_error','reconciliation_pending'].includes(result.status) ? 503 : 200 })
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: err.status })
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Delivery retry failed.' }, { status: 503 })
  }
}
