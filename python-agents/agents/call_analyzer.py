"""Call analysis.

Turns a raw call transcript into the structured fields `call_transcripts`
stores: summary, sentiment_score, objections_json and escalated.
"""

from __future__ import annotations

import json
import re
from typing import Any

from agents.brand_context import build_brand_context
from agents.orchestrator import llm, supabase

# call_transcripts.sentiment_score is an INT; keep the model inside a range the
# dashboard can render consistently.
SENTIMENT_MIN = -100
SENTIMENT_MAX = 100

_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _parse_json_object(text: str) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from an LLM reply.

    Models wrap JSON in prose or code fences often enough that a bare
    json.loads() fails on otherwise-good output.
    """
    candidate = text.strip()

    fenced = _JSON_FENCE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    else:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start != -1 and end > start:
            candidate = candidate[start : end + 1]

    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _clamp_sentiment(value: Any) -> int | None:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(SENTIMENT_MIN, min(SENTIMENT_MAX, score))


async def fetch_transcript(call_id: str) -> dict[str, Any]:
    """Return a single call_transcripts row, or {} when it does not exist."""
    result = (
        supabase.table("call_transcripts")
        .select("id, client_id, transcript, direction, duration_sec")
        .eq("id", call_id)
        .maybe_single()
        .execute()
    )
    return result.data or {}


async def analyze_call(
    client_id: str,
    transcript: str | None = None,
    call_id: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Analyse a transcript and, by default, write the result back.

    Pass `transcript` directly, or `call_id` to load it from the database.
    Returns the structured analysis regardless of whether it was persisted.
    """
    if transcript is None:
        if not call_id:
            raise ValueError("analyze_call needs either a transcript or a call_id")
        row = await fetch_transcript(call_id)
        transcript = row.get("transcript")

    if not transcript or not transcript.strip():
        raise ValueError(f"No transcript text available for call {call_id or '(inline)'}")

    brand_context = await build_brand_context(client_id, include_rag=False)

    prompt = f"""You are analysing a phone call handled by an AI receptionist.

Brand context:
{brand_context}

Transcript:
{transcript}

Return ONLY a JSON object with exactly these keys:
  "summary": 2-3 sentences describing what the caller wanted and what happened.
  "sentiment_score": integer from {SENTIMENT_MIN} (hostile) to {SENTIMENT_MAX} (delighted).
  "escalated": true if this call needs a human to follow up, otherwise false.
  "escalation_reason": short phrase explaining why, or null when escalated is false.
  "objections": array of short strings naming concerns the caller raised; [] if none.
  "resolved": true if the caller's need was fully handled on the call.

No prose, no code fences — just the JSON object."""

    response = await llm.ainvoke(prompt)
    parsed = _parse_json_object(response.content)

    if not parsed:
        raise ValueError("Call analysis did not return parseable JSON")

    analysis: dict[str, Any] = {
        "summary": (parsed.get("summary") or "").strip(),
        "sentiment_score": _clamp_sentiment(parsed.get("sentiment_score")),
        "escalated": bool(parsed.get("escalated")),
        "escalation_reason": parsed.get("escalation_reason") or None,
        "objections": [str(o) for o in parsed.get("objections") or [] if o],
        "resolved": bool(parsed.get("resolved")),
    }

    if persist and call_id:
        # Only columns that exist on call_transcripts; escalation_reason and
        # resolved are returned to the caller but not written, since neither is
        # in migration 001.
        supabase.table("call_transcripts").update(
            {
                "summary": analysis["summary"],
                "sentiment_score": analysis["sentiment_score"],
                "objections_json": analysis["objections"],
                "escalated": analysis["escalated"],
            }
        ).eq("id", call_id).execute()
        analysis["persisted"] = True
    else:
        analysis["persisted"] = False

    return analysis
