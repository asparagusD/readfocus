"""CORS (C14.3): production allows only FRONTEND_URL; localhost only when ENV=development."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from backend.cors import DEV_ORIGINS, add_cors, allowed_origins

SITE = "https://readfocus.vercel.app"


def client_for(env):
    app = FastAPI()
    add_cors(app, env)

    @app.get("/books")
    def books():
        return []

    return TestClient(app)


def preflight(client, origin, method="POST"):
    return client.options("/books", headers={
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type",
    })


def test_production_allows_only_the_frontend_url():
    assert allowed_origins({"ENV": "production", "FRONTEND_URL": SITE}) == [SITE]


def test_development_adds_the_localhost_origins():
    origins = allowed_origins({"ENV": "development", "FRONTEND_URL": "http://localhost:5173"})
    assert origins == list(DEV_ORIGINS)  # no duplicate when FRONTEND_URL is one of them
    assert all(o.startswith(("http://localhost:", "http://127.0.0.1:")) for o in DEV_ORIGINS)


def test_localhost_only_when_env_is_exactly_development():
    for env in ({}, {"ENV": "production"}, {"ENV": "test"}, {"ENV": "Development "}):
        assert allowed_origins({**env, "FRONTEND_URL": SITE}) == [SITE], env


def test_frontend_url_is_trimmed_and_may_list_several_origins():
    env = {"ENV": "production", "FRONTEND_URL": f" {SITE}/ , https://readfocus.app ,,"}
    assert allowed_origins(env) == [SITE, "https://readfocus.app"]


def test_unset_frontend_url_in_production_allows_no_origin():
    assert allowed_origins({"ENV": "production"}) == []


def test_preflight_from_the_frontend_is_allowed_without_credentials():
    response = preflight(client_for({"ENV": "production", "FRONTEND_URL": SITE}), SITE)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == SITE
    assert "access-control-allow-credentials" not in response.headers  # bearer tokens, no cookies
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_production_refuses_localhost_and_other_sites():
    client = client_for({"ENV": "production", "FRONTEND_URL": SITE})
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173", "https://evil.example", f"{SITE}.evil.example"):
        response = preflight(client, origin)
        assert response.status_code == 400, origin
        assert "access-control-allow-origin" not in response.headers
        simple = client.get("/books", headers={"Origin": origin})
        assert "access-control-allow-origin" not in simple.headers, origin


def test_development_allows_the_vite_dev_server():
    client = client_for({"ENV": "development"})
    assert preflight(client, "http://localhost:5173").headers["access-control-allow-origin"] == "http://localhost:5173"


def test_the_app_uses_this_policy():
    from backend.main import app

    [cors] = [m for m in app.user_middleware if m.cls is CORSMiddleware]
    assert cors.kwargs["allow_origins"] == allowed_origins(os.environ)
    assert cors.kwargs["allow_credentials"] is False
