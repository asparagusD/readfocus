"""Internal endpoints for scheduled jobs (C24.4). POST /internal/leagues/rollover runs the weekly league rollover
(docs/GAMIFICATION.md G11, backend/xp/league_store.py) for the GitHub workflow .github/workflows/league-rollover.yml,
which calls it on Mondays at 00:05 UTC. It takes no reader's sign-in: only `Authorization: Bearer <CRON_SECRET>`,
compared in constant time; without a configured secret of at least CRON_SECRET_MIN_LENGTH characters it is
unavailable (503). The rollover is idempotent, so a retried, late or repeated call is safe. Neither the secret nor
the header is ever logged; the response carries counts only."""

import hmac
import logging
import os

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool

from backend.agents import policy
from backend.xp import league_store

router = APIRouter()
log = logging.getLogger(__name__)


def _authorised(authorization: str | None) -> None:
    expected = os.getenv("CRON_SECRET", "")
    if len(expected) < policy.CRON_SECRET_MIN_LENGTH:
        raise HTTPException(status_code=503, detail="Scheduled jobs are not configured.")
    scheme, _, token = (authorization or "").partition(" ")
    if scheme != "Bearer" or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Not allowed.")


@router.post("/leagues/rollover")
async def league_rollover(authorization: str | None = Header(default=None)):
    _authorised(authorization)
    result = await run_in_threadpool(league_store.roll_over)
    log.info("league rollover: closed=%d week=%s grouped=%d", len(result["closed"]), result["week"], result["grouped"])
    return result
