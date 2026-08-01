import { createRouteClient } from '@/lib/supabase-route';
import { NextResponse } from 'next/server';

async function resolveClientId(supabase: Awaited<ReturnType<typeof createRouteClient>>, userId: string) {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .single();
  return data?.id as string | undefined;
}

export async function GET() {
  try {
    const supabase = await createRouteClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = await resolveClientId(supabase, user.id);
    if (!clientId) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, settings_json')
      .eq('client_id', clientId)
      .eq('agent_type', 'hunter')
      .maybeSingle();

    return NextResponse.json({ config: campaign?.settings_json ?? {} });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = await resolveClientId(supabase, user.id);
    if (!clientId) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const body = await req.json();

    // Find existing hunter campaign for this client
    const { data: existing } = await supabase
      .from('campaigns')
      .select('id, settings_json')
      .eq('client_id', clientId)
      .eq('agent_type', 'hunter')
      .maybeSingle();

    // The send cap lives on its own column as well as in settings_json, since
    // the sending job reads the column directly.
    const dailyLimit = Number(body?.daily_email_limit) || 50;

    if (existing) {
      await supabase
        .from('campaigns')
        .update({ settings_json: body, daily_volume_limit: dailyLimit })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('campaigns')
        .insert({
          client_id: clientId,
          agent_type: 'hunter',
          name: 'Hunter Outbound',
          status: 'active',
          settings_json: body,
          daily_volume_limit: dailyLimit
        });
    }

    return NextResponse.json({ success: true, config: body });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
