"""Weekly WARE brief.

Aggregates the last seven days of real activity, scores it, has the model write
the narrative, and stores the result in `weekly_briefs`.

The scoring formula mirrors src/app/api/dashboard/metrics/route.ts so the brief
and the dashboard never disagree about the same week.
"""

from __future__ import annotations

import html
from datetime import datetime, timedelta, timezone
from typing import Any

from agents.brand_context import build_brand_context
from agents.orchestrator import llm, supabase

WINDOW_DAYS = 7
WARE_MAX = 1000

# Weights from the Next.js metrics route.
WEIGHT_CALL_RESOLVED = 10
WEIGHT_REVIEW_RESPONDED = 15
WEIGHT_INVOICE_PAID = 20
WEIGHT_AGENT_RUN = 2


def _window_start() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)


def _week_start() -> str:
    """Monday of the current week, as an ISO date for weekly_briefs.week_start."""
    today = datetime.now(timezone.utc).date()
    return (today - timedelta(days=today.weekday())).isoformat()


def _rows(table: str, columns: str, client_id: str, since: str) -> list[dict[str, Any]]:
    result = (
        supabase.table(table)
        .select(columns)
        .eq("client_id", client_id)
        .gte("created_at", since)
        .execute()
    )
    return result.data or []


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


async def collect_metrics(client_id: str) -> dict[str, Any]:
    """Real counts for the trailing seven days. No estimates, no placeholders."""
    since = _window_start().isoformat()

    # `escalated` is the column migration 001 guarantees. The Next.js route reads
    # a `resolved` column that exists in the live database but not in the
    # migration, so resolution is derived here instead — a call that was not
    # escalated was handled by the agent.
    calls = _rows("call_transcripts", "escalated, sentiment_score, duration_sec", client_id, since)
    reviews = _rows("reviews", "star_rating, responded", client_id, since)
    invoices = _rows("invoices", "status, amount_cents", client_id, since)
    runs = _rows("agent_runs", "agent_type, status, cost_usd", client_id, since)
    leads = _rows("leads", "status, last_contacted_at", client_id, since)

    calls_escalated = sum(1 for c in calls if c.get("escalated"))
    calls_resolved = len(calls) - calls_escalated

    reviews_responded = sum(1 for r in reviews if r.get("responded"))
    rated = [_as_int(r.get("star_rating")) for r in reviews if r.get("star_rating")]

    paid = [i for i in invoices if i.get("status") == "paid"]
    collected_cents = sum(_as_int(i.get("amount_cents")) for i in paid)

    runs_failed = sum(1 for r in runs if r.get("status") in ("failed", "error"))

    return {
        "window_days": WINDOW_DAYS,
        "calls_total": len(calls),
        "calls_resolved": calls_resolved,
        "calls_escalated": calls_escalated,
        "reviews_total": len(reviews),
        "reviews_responded": reviews_responded,
        "avg_star_rating": round(sum(rated) / len(rated), 1) if rated else None,
        "invoices_total": len(invoices),
        "invoices_paid": len(paid),
        "collected_cents": collected_cents,
        "agent_runs": len(runs),
        "agent_runs_failed": runs_failed,
        "agent_cost_usd": round(sum(_as_float(r.get("cost_usd")) for r in runs), 4),
        "leads_total": len(leads),
        "leads_contacted": sum(1 for l in leads if l.get("last_contacted_at")),
    }


def score_ware(metrics: dict[str, Any]) -> int:
    """Same weights and clamp as the dashboard."""
    raw = (
        metrics["calls_resolved"] * WEIGHT_CALL_RESOLVED
        + metrics["reviews_responded"] * WEIGHT_REVIEW_RESPONDED
        + metrics["invoices_paid"] * WEIGHT_INVOICE_PAID
        + metrics["agent_runs"] * WEIGHT_AGENT_RUN
    )
    return max(0, min(WARE_MAX, raw))


def _metrics_summary(metrics: dict[str, Any]) -> str:
    """Plain-text metrics block for the prompt."""
    rating = metrics["avg_star_rating"]
    return "\n".join(
        [
            f"Calls handled: {metrics['calls_total']} "
            f"({metrics['calls_resolved']} resolved, {metrics['calls_escalated']} escalated)",
            f"Reviews received: {metrics['reviews_total']} "
            f"({metrics['reviews_responded']} responded to)",
            f"Average star rating: {rating if rating is not None else 'no rated reviews this week'}",
            f"Invoices: {metrics['invoices_paid']} paid of {metrics['invoices_total']} "
            f"(${metrics['collected_cents'] / 100:,.2f} collected)",
            f"Agent runs: {metrics['agent_runs']} ({metrics['agent_runs_failed']} failed), "
            f"${metrics['agent_cost_usd']:.4f} spent",
            f"Leads: {metrics['leads_total']} added, {metrics['leads_contacted']} contacted",
        ]
    )


def _is_quiet_week(metrics: dict[str, Any]) -> bool:
    """True when literally nothing happened — worth saying rather than dressing up."""
    return not any(
        (
            metrics["calls_total"],
            metrics["reviews_total"],
            metrics["invoices_total"],
            metrics["agent_runs"],
            metrics["leads_total"],
        )
    )


def _render_html(narrative: str, metrics: dict[str, Any], ware_score: int) -> str:
    rating = metrics["avg_star_rating"]
    rows = [
        ("WARE score", f"{ware_score} / {WARE_MAX}"),
        ("Calls handled", str(metrics["calls_total"])),
        ("Calls resolved without a human", str(metrics["calls_resolved"])),
        ("Reviews responded to", f"{metrics['reviews_responded']} of {metrics['reviews_total']}"),
        ("Average star rating", f"{rating}" if rating is not None else "—"),
        ("Invoices paid", f"{metrics['invoices_paid']} of {metrics['invoices_total']}"),
        ("Collected", f"${metrics['collected_cents'] / 100:,.2f}"),
        ("Agent runs", str(metrics["agent_runs"])),
        ("Agent spend", f"${metrics['agent_cost_usd']:.4f}"),
        ("Leads added", str(metrics["leads_total"])),
    ]

    # Narrative comes from the model, so escape it before it lands in the DOM.
    paragraphs = "".join(
        f"<p>{html.escape(line.strip())}</p>"
        for line in narrative.split("\n")
        if line.strip()
    )
    table_rows = "".join(
        f"<tr><td>{html.escape(label)}</td><td><strong>{html.escape(value)}</strong></td></tr>"
        for label, value in rows
    )

    return (
        '<div class="brief-content">'
        f"<h2>WARE score: {ware_score}</h2>"
        f"{paragraphs}"
        "<h2>This week by the numbers</h2>"
        f"<table>{table_rows}</table>"
        "</div>"
    )


async def generate_brief(client_id: str, persist: bool = True) -> dict[str, Any]:
    """Build the weekly brief and, by default, store it in weekly_briefs."""
    metrics = await collect_metrics(client_id)
    ware_score = score_ware(metrics)
    brand_context = await build_brand_context(client_id, include_rag=False)

    if _is_quiet_week(metrics):
        narrative = (
            "Nothing ran this week — no calls, reviews, invoices, or agent activity "
            "were recorded. There is no performance to report yet rather than a "
            "week of poor performance."
        )
    else:
        prompt = f"""You are writing the Monday brief for a business owner.

Brand context:
{brand_context}

Real figures for the last {WINDOW_DAYS} days:
{_metrics_summary(metrics)}

WARE score: {ware_score} out of {WARE_MAX}

Write 3-4 short paragraphs, in the brand tone described above:
1. What actually moved this week, citing the numbers above.
2. What needs attention, and why it matters commercially.
3. The single most valuable thing to do next week.

Rules:
- Use only the figures given. Never invent a metric, percentage, or comparison
  to a previous week — you have not been given last week's data.
- Where a number is zero, say so plainly rather than spinning it.
- Plain prose. No headings, no bullet points, no markdown."""

        response = await llm.ainvoke(prompt)
        narrative = (response.content or "").strip()

        if not narrative:
            raise ValueError("Brief generator returned an empty narrative")

    brief_html = _render_html(narrative, metrics, ware_score)
    week_start = _week_start()

    brief: dict[str, Any] = {
        "client_id": client_id,
        "week_start": week_start,
        "ware_score": ware_score,
        "brief_html": brief_html,
        "key_metrics_json": metrics,
        "narrative": narrative,
        "persisted": False,
    }

    if persist:
        result = (
            supabase.table("weekly_briefs")
            .insert(
                {
                    "client_id": client_id,
                    "week_start": week_start,
                    "ware_score": ware_score,
                    "brief_html": brief_html,
                    "key_metrics_json": metrics,
                }
            )
            .execute()
        )
        if result.data:
            brief["id"] = result.data[0].get("id")
        brief["persisted"] = True

    return brief
