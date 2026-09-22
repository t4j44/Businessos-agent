import { NextResponse } from 'next/server';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { supabaseAdmin } from '@/lib/supabase';
import { readJsonBody, ValidationError } from '@/lib/validation';
import { logAgentRun } from '@/lib/log';

export async function GET() {
  try {
    const { clientId } = await requireSession();
    const { data, error } = await supabaseAdmin.from('clients').select('settings_json,status').eq('id', clientId).single();
    if (error) return NextResponse.json({ error: 'Settings unavailable.' }, { status: 503 });
    return NextResponse.json({ enabled: data.settings_json?.agents?.receptionist?.enabled !== false, account_status: data.status });
  } catch (error) { return authErrorResponse(error) ?? NextResponse.json({ error: 'Settings unavailable.' }, { status: 503 }); }
}

export async function PATCH(req: Request) {
  try {
    const { clientId, userId } = await requireSession();
    const { enabled } = await readJsonBody(req);
    if (typeof enabled !== 'boolean') throw new ValidationError('Choose whether the receptionist is enabled.');
    const { data, error } = await supabaseAdmin.rpc('set_receptionist_enabled', { p_client_id: clientId, p_enabled: enabled });
    if (error || !data) return NextResponse.json({ error: 'Settings could not be saved.' }, { status: 503 });
    await logAgentRun({ client_id: clientId, agent_type: 'receptionist', status: 'completed',
      output_summary: enabled ? 'Owner enabled the receptionist' : 'Owner paused the receptionist', metadata: { user_id: userId, enabled } });
    return NextResponse.json({ enabled });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return authErrorResponse(error) ?? NextResponse.json({ error: 'Settings could not be saved.' }, { status: 503 });
  }
}
