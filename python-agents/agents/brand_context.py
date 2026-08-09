"""Brand context loading.

The orchestrator graph inlines a minimal version of this for its own node. This
module is the fuller, shared version the specialised agents use, so every agent
speaks in the same voice off the same record.

Column names here track supabase/migrations/001_initial_schema.sql. Note that
`brand_profiles` has no `value_proposition` column — the closest fields are
`icp_summary` and `products_json`.
"""

from __future__ import annotations

import json
from typing import Any

from agents.orchestrator import supabase

# Selected explicitly rather than `*` so a schema change surfaces here as a
# clear error instead of a silently missing line in every agent prompt.
_BRAND_FIELDS = (
    "company_name, icp_summary, tone_description, products_json, "
    "competitors_json, greeting_text, booking_url"
)

RAG_CHUNK_LIMIT = 5


def _as_list(value: Any) -> list[Any]:
    """products_json / competitors_json arrive as list, JSON string, or None."""
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return [value]
        return parsed if isinstance(parsed, list) else [parsed]
    return []


def _describe_product(product: Any) -> str:
    if isinstance(product, dict):
        name = product.get("name") or product.get("title") or ""
        description = product.get("description") or product.get("what_it_does") or ""
        if name and description:
            return f"{name} — {description}"
        return name or description or ""
    return str(product)


async def fetch_brand_profile(client_id: str) -> dict[str, Any]:
    """Return the brand_profiles row, or an empty dict when the client has none.

    Uses maybe_single() rather than single(), which raises when no row exists —
    a client that has not completed onboarding is a normal state, not an error.
    """
    result = (
        supabase.table("brand_profiles")
        .select(_BRAND_FIELDS)
        .eq("client_id", client_id)
        .maybe_single()
        .execute()
    )
    return result.data or {}


async def fetch_rag_context(client_id: str, limit: int = RAG_CHUNK_LIMIT) -> str:
    """Return the client's active knowledge chunks, newest first."""
    result = (
        supabase.table("rag_chunks")
        .select("content")
        .eq("client_id", client_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    return "\n\n".join(row["content"] for row in rows if row.get("content"))


def format_brand_profile(profile: dict[str, Any]) -> str:
    """Render a brand_profiles row as prompt-ready text.

    Absent fields are omitted rather than rendered as "None", which would
    otherwise teach the model that the business has no tone or no products.
    """
    if not profile:
        return "No brand profile on file — write in a neutral, professional voice."

    lines: list[str] = []

    if profile.get("company_name"):
        lines.append(f"Company: {profile['company_name']}")
    if profile.get("icp_summary"):
        lines.append(f"Ideal customer: {profile['icp_summary']}")
    if profile.get("tone_description"):
        lines.append(f"Tone of voice: {profile['tone_description']}")

    products = [_describe_product(p) for p in _as_list(profile.get("products_json"))]
    products = [p for p in products if p]
    if products:
        lines.append("Products: " + "; ".join(products))

    competitors = [str(c) for c in _as_list(profile.get("competitors_json")) if c]
    if competitors:
        lines.append("Competitors: " + ", ".join(competitors))

    if profile.get("booking_url"):
        lines.append(f"Booking link: {profile['booking_url']}")

    return "\n".join(lines) if lines else "No brand profile on file."


async def build_brand_context(client_id: str, include_rag: bool = True) -> str:
    """Brand profile plus, optionally, the client's knowledge chunks."""
    profile = await fetch_brand_profile(client_id)
    context = format_brand_profile(profile)

    if include_rag:
        rag = await fetch_rag_context(client_id)
        if rag:
            context = f"{context}\n\nAdditional knowledge:\n{rag}"

    return context
