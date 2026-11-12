"""The shared Supabase client uses an HTTP/1.1 connection pool (issue 29), not one shared HTTP/2 connection."""

import httpx

from backend.services import supabase_client


def test_the_client_gets_an_http1_pool(monkeypatch):
    seen = {}

    def fake_create_client(url, key, options=None):
        seen.update(url=url, key=key, options=options)
        return "client"

    monkeypatch.setattr(supabase_client, "create_client", fake_create_client)
    assert supabase_client.make_client("https://x.invalid", "key") == "client"
    http = seen["options"].httpx_client
    assert isinstance(http, httpx.Client)
    assert http._transport._pool._http2 is False and http._transport._pool._http1 is True
    assert http.timeout.read == supabase_client.TIMEOUT_SECONDS
