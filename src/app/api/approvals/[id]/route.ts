import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { isUuid, readJsonBody, ValidationError } from '@/lib/validation';
import { logAgentRun } from '@/lib/log';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { clientId, userId } = await requireSession();
    const { id } = await params;
    const { action } = await readJsonBody(req);
    if (!isUuid(id) || !['approved', 'rejected'].includes(action)) throw new ValidationError('Invalid approval decision.');
    const { data, error } = await supabaseAdmin.rpc('resolve_approval', {
      p_client_id: clientId, p_id: id, p_user_id: userId, p_action: action,
    });
    if (error || !data) return NextResponse.json({ error: 'Decision could not be saved.' }, { status: 503 });
    if (data.outcome === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (['expired', 'conflict'].includes(data.outcome)) return NextResponse.json({ error: 'This approval expired or already has a different decision.' }, { status: 409 });
    if (data.outcome === 'resolved') await logAgentRun({ client_id: clientId, agent_type: 'approval', status: 'completed',
      output_summary: `Owner ${action} an action`, metadata: { approval_id: id, user_id: userId, execution_status: data.execution_status } });
    // Approval records intent. Provider execution requires a separate receipt.
    return NextResponse.json({ success: true, status: data.status, execution_status: data.execution_status, executed: false });
  } catch (error) {
    const auth = authErrorResponse(error);
    if (auth) return auth;
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Decision could not be saved.' }, { status: 503 });
  }
}
