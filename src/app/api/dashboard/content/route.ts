import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

function num(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;

    const { data: rows, error } = await supabaseAdmin
      .from('content_calendar')
      .select('id, platform, content, hook, cta, status, scheduled_at, performance_json, created_at')
      .eq('client_id', client_id)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[dashboard/content] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const posts = (rows || []).map((p: any) => {
      const perf = p.performance_json || {};
      const views = num(perf.views ?? perf.impressions);
      const likes = num(perf.likes ?? perf.reactions);
      const comments = num(perf.comments ?? perf.replies);
      return {
        id: p.id,
        platform: p.platform || 'Unknown',
        content: p.content || '',
        hook: p.hook || null,
        cta: p.cta || null,
        status: p.status || 'draft',
        scheduled_at: p.scheduled_at,
        // Null rather than zero — a published post with no synced analytics is
        // not the same as a post that got zero views.
        metrics: views === null && likes === null && comments === null
          ? null
          : { views, likes, comments },
      };
    });

    const published = posts.filter((p) => p.status === 'published');
    const withMetrics = published.filter((p) => p.metrics);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const publishedThisMonth = published.filter(
      (p) => p.scheduled_at && new Date(p.scheduled_at).getTime() >= monthStart.getTime(),
    ).length;

    const totalViews = withMetrics.reduce((t, p) => t + (p.metrics?.views ?? 0), 0);
    const totalEngagements = withMetrics.reduce(
      (t, p) => t + (p.metrics?.likes ?? 0) + (p.metrics?.comments ?? 0),
      0,
    );

    return NextResponse.json({
      client_id,
      is_empty: posts.length === 0,
      posts,
      stats: {
        posts_published: published.length,
        published_this_month: publishedThisMonth,
        scheduled: posts.filter((p) => p.status === 'scheduled').length,
        drafts: posts.filter((p) => p.status === 'draft').length,
        // These stay null until analytics have actually been synced back.
        total_impressions: withMetrics.length > 0 ? totalViews : null,
        avg_engagement_rate:
          withMetrics.length > 0 && totalViews > 0
            ? Number(((totalEngagements / totalViews) * 100).toFixed(1))
            : null,
      },
    });
  } catch (err: any) {
    console.error('[dashboard/content] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
