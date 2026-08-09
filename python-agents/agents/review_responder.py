"""Review responses.

Drafts a reply to a customer review in the client's brand voice and stores it on
the review row. Drafting and publishing are deliberately separate: this writes
`response_text` but leaves `responded` false, so a human (or the approvals
queue) still decides what actually gets posted.
"""

from __future__ import annotations

from typing import Any

from agents.brand_context import build_brand_context
from agents.orchestrator import llm, supabase

# Review sites cap replies; keep drafts publishable on the strictest of them.
MAX_RESPONSE_CHARS = 1000


def _tone_guidance(star_rating: int | None) -> str:
    """What a reply should actually do, by rating."""
    if star_rating is None:
        return (
            "Thank the reviewer and address their points directly. Do not assume "
            "whether the experience was positive or negative."
        )
    if star_rating <= 2:
        return (
            "This is a negative review. Open by acknowledging the specific problem "
            "without excuses, apologise once and plainly, say what will change or "
            "how it will be put right, and offer to continue the conversation "
            "off-platform. Never argue or blame the customer."
        )
    if star_rating == 3:
        return (
            "This is a mixed review. Thank them, acknowledge what fell short as "
            "well as what worked, and say concretely what you are improving."
        )
    return (
        "This is a positive review. Thank them warmly and specifically — reference "
        "the actual detail they praised rather than generic gratitude. Keep it short."
    )


async def fetch_review(review_id: str) -> dict[str, Any]:
    """Return a single reviews row, or {} when it does not exist."""
    result = (
        supabase.table("reviews")
        .select(
            "id, client_id, platform, star_rating, review_text, "
            "reviewer_name, responded, response_text"
        )
        .eq("id", review_id)
        .maybe_single()
        .execute()
    )
    return result.data or {}


async def fetch_pending_reviews(client_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Reviews that have not been answered yet, worst rating first."""
    result = (
        supabase.table("reviews")
        .select("id, platform, star_rating, review_text, reviewer_name")
        .eq("client_id", client_id)
        .eq("responded", False)
        .order("star_rating", desc=False)
        .limit(limit)
        .execute()
    )
    return result.data or []


async def draft_review_response(
    client_id: str,
    review_id: str | None = None,
    review_text: str | None = None,
    star_rating: int | None = None,
    reviewer_name: str | None = None,
    platform: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Draft a reply to one review.

    Pass `review_id` to load the review from the database, or supply the review
    fields directly. Returns the draft; when `persist` is true and a review_id
    was given, also saves it to `response_text`.
    """
    if review_id and review_text is None:
        row = await fetch_review(review_id)
        if not row:
            raise ValueError(f"Review {review_id} not found")
        review_text = row.get("review_text")
        star_rating = row.get("star_rating") if star_rating is None else star_rating
        reviewer_name = reviewer_name or row.get("reviewer_name")
        platform = platform or row.get("platform")

    if not review_text or not review_text.strip():
        raise ValueError("No review text to respond to")

    brand_context = await build_brand_context(client_id, include_rag=False)
    name = reviewer_name or "the reviewer"

    prompt = f"""You are writing a public reply to a customer review on {platform or 'a review site'}.

Brand context:
{brand_context}

Reviewer: {name}
Rating: {star_rating if star_rating is not None else 'not given'} out of 5
Review:
{review_text}

How to handle this one:
{_tone_guidance(star_rating)}

Rules:
- Write in the brand's tone of voice described above.
- Address {name} by name once, naturally.
- Stay under {MAX_RESPONSE_CHARS} characters.
- Never invent facts, discounts, refunds, or policies that were not stated above.
- No placeholders like [Name] or [Manager] — the text must be publishable as-is.

Return ONLY the reply text."""

    response = await llm.ainvoke(prompt)
    draft = (response.content or "").strip()

    if not draft:
        raise ValueError("Review responder returned an empty draft")

    truncated = len(draft) > MAX_RESPONSE_CHARS
    if truncated:
        draft = draft[:MAX_RESPONSE_CHARS].rstrip()

    result: dict[str, Any] = {
        "review_id": review_id,
        "response_text": draft,
        "star_rating": star_rating,
        "truncated": truncated,
        "persisted": False,
    }

    if persist and review_id:
        # response_text only — `responded` stays false until a human approves and
        # the reply is actually posted to the platform.
        supabase.table("reviews").update(
            {"response_text": draft, "response_method": "python_agent"}
        ).eq("id", review_id).execute()
        result["persisted"] = True

    return result


async def draft_pending_responses(client_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Draft replies for every unanswered review, worst rating first."""
    pending = await fetch_pending_reviews(client_id, limit=limit)

    drafts: list[dict[str, Any]] = []
    for review in pending:
        try:
            drafts.append(
                await draft_review_response(
                    client_id=client_id,
                    review_id=review["id"],
                    review_text=review.get("review_text"),
                    star_rating=review.get("star_rating"),
                    reviewer_name=review.get("reviewer_name"),
                    platform=review.get("platform"),
                )
            )
        except ValueError as exc:
            # One malformed review should not abandon the rest of the batch.
            drafts.append({"review_id": review["id"], "error": str(exc)})

    return drafts
