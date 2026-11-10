"""The shared service-role Supabase client.

It is used from many threads at once: the request threadpool, ingestion's
background work and FastAPI background tasks. supabase-py's default
transport is one multiplexed HTTP/2 connection, which breaks under that
("Server disconnected", issue 29), so the client gets an HTTP/1.1 httpx
pool instead: thread-safe, one connection per concurrent request.
"""

import os

import httpx
from dotenv import load_dotenv

from supabase import Client, ClientOptions, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
TIMEOUT_SECONDS = 120  # postgrest's own default

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("Supabase URL or Service Key not found in environment variables.")


def make_client(url: str, key: str) -> Client:
    http = httpx.Client(http2=False, timeout=TIMEOUT_SECONDS, follow_redirects=True)
    return create_client(url, key, options=ClientOptions(httpx_client=http))


supabase: Client = make_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
