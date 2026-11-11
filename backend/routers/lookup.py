"""GET /lookup: a word or short phrase from the Free Dictionary API or Wikipedia (C12.6)."""

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.dependencies import get_current_user
from backend.services import lookup

router = APIRouter()

SLOW_DOWN = "You're looking words up very quickly. Give it a moment, then try again."
NOT_A_TERM = "Pick a word or a short phrase of up to 5 words."


@router.get("")
def look_up(
    term: str = Query(..., max_length=200),
    lang: str = Query("en", pattern="^en$"),
    proper: bool = False,
    user_id: str = Depends(get_current_user),
):
    """Sync on purpose: FastAPI runs it on a worker thread, so a slow upstream never blocks the loop."""
    normalized = lookup.normalize(term)
    if normalized is None:
        raise HTTPException(status_code=422, detail=NOT_A_TERM)
    wait = lookup.allow(user_id)
    if wait:
        raise HTTPException(status_code=429, detail=SLOW_DOWN, headers={"Retry-After": str(wait)})
    return lookup.look_up(normalized, lang, proper)
