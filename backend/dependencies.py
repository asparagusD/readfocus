import os

from fastapi import Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.nlp import embedder
from backend.services.supabase_client import supabase

DEFAULT_WAIT_SECONDS = 20
RETRY_AFTER_SECONDS = 5

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Extracts the user_id from the Supabase JWT Bearer token.
    """
    token = credentials.credentials

    try:
        user_resp = supabase.auth.get_user(token)
        if user_resp and user_resp.user:
            return user_resp.user.id
        else:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")


async def require_model() -> None:
    """Wait for the embedding model before an endpoint that grades with it; 503 if it is not ready in time.

    It runs before the endpoint, so nothing has been written when it refuses.
    EMBED_WAIT_SECONDS sets the wait (default 20).
    """
    if embedder.is_ready():
        return
    embedder.ensure_loading()
    timeout = float(os.getenv("EMBED_WAIT_SECONDS") or DEFAULT_WAIT_SECONDS)
    if not await run_in_threadpool(embedder.wait_ready, timeout):
        raise HTTPException(
            status_code=503,
            detail="The reading model is still loading. Please try again in a few seconds.",
            headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
        )
