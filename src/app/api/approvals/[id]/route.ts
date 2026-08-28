import { createRouteClient } from '@/lib/supabase-route';
import { NextResponse } from 'next/server';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const supabase = await createRouteClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action } = await req.json();

    if (!['approved', 'rejected'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Get item
    const { data: item } = await supabase
      .from('approvals_queue')
      .select('*')
      .eq('id', id)
      .eq('client_id', clientId)
      .single();

    // Use mock data locally if DB misses for demo
    const actionType = item?.action_type || 'unknown';
    const payload = item?.payload_json || {};

    // Update status
    await supabase
      .from('approvals_queue')
      .update({ status: action })
      .eq('id', id)
      .eq('client_id', clientId);

    // Trigger downstream n8n webhook
    const n8nWebhookBase = process.env.N8N_WEBHOOK_BASE_URL;
    if (n8nWebhookBase) {
      // Fire and forget
      fetch(`${n8nWebhookBase}/approvals-resolved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: id,
          action_type: actionType,
          status: action,
          payload_json: payload
        })
      }).catch(err => console.error('n8n webhook failed:', err));
    }

    return NextResponse.json({ success: true, status: action });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
