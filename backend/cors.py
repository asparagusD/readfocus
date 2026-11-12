"""Which browser origins may call the API (C14.3).

Production allows only the origins in FRONTEND_URL. The local Vite dev
server origins are added only when ENV is exactly "development", so a
deploy with ENV unset or misspelt allows no localhost origin.

FRONTEND_URL holds one origin or several separated by commas (for example
the vercel.app address and a custom domain); spaces and a trailing slash
are dropped, since a browser's Origin header never has one.

The frontend authenticates with a bearer token in the Authorization header,
not cookies, so credentials are not allowed.
"""

import logging
import os
from collections.abc import Mapping

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

DEV_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
)

log = logging.getLogger(__name__)


def allowed_origins(env: Mapping[str, str]) -> list[str]:
    configured = [o.strip().rstrip("/") for o in env.get("FRONTEND_URL", "").split(",")]
    dev = list(DEV_ORIGINS) if env.get("ENV") == "development" else []
    return list(dict.fromkeys(o for o in [*dev, *configured] if o))


def add_cors(app: FastAPI, env: Mapping[str, str] = os.environ) -> list[str]:
    origins = allowed_origins(env)
    if not origins:
        log.warning("CORS: FRONTEND_URL is not set, so no browser origin may call the API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return origins
