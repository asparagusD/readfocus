"""The Render deploy config (C14.1): Dockerfile, .dockerignore and render.yaml.

Read as text: no YAML parser is a backend dependency, and the checks are
about which lines are present.
"""

import re
from pathlib import Path

from backend.nlp import embedder
from tools.no_paid_ai import BANNED_KEYS

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")
DOCKERIGNORE = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
BLUEPRINT = (ROOT / "render.yaml").read_text(encoding="utf-8")

IMAGE_CACHE = "/app/.cache/fastembed"
SECRETS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY", "FRONTEND_URL"]


def blueprint_env():
    """envVars as {key: the lines under it}, in order."""
    entries, key = {}, None
    for line in BLUEPRINT.splitlines():
        found = re.match(r"\s*- key: (\S+)", line)
        if found:
            key = found.group(1)
            entries[key] = []
        elif key and line.strip():
            entries[key].append(line.strip())
    return entries


def test_image_is_python_311_slim():
    assert re.search(r"^FROM python:3\.11-slim$", DOCKERFILE, re.MULTILINE)


def test_model_is_baked_into_the_image_cache_before_going_offline():
    assert f"FASTEMBED_CACHE={IMAGE_CACHE}" in DOCKERFILE
    bake = DOCKERFILE.index("embedder.embed(")
    assert bake < DOCKERFILE.index("ENV HF_HUB_OFFLINE=1")
    # The bake runs the app's own embedder, so the image holds the model the code loads.
    assert "backend/nlp/embedder.py" in DOCKERFILE
    assert embedder.MODEL_NAME not in DOCKERFILE  # never a second copy of the name to drift


def test_server_binds_render_port_with_one_worker():
    cmd = DOCKERFILE.strip().splitlines()[-1]
    assert cmd.startswith("CMD ")
    assert "--host 0.0.0.0" in cmd
    assert "--port ${PORT:-8000}" in cmd
    assert "--workers 1" in cmd
    assert "exec uvicorn backend.main:app" in cmd


def test_dockerignore_is_an_allowlist_that_keeps_secrets_out():
    rules = [line.strip() for line in DOCKERIGNORE if line.strip() and not line.startswith("#")]
    assert rules[0] == "*"
    allowed = {rule[1:] for rule in rules if rule.startswith("!")}
    assert allowed == {"requirements.txt", "backend/"}


def test_blueprint_is_a_free_docker_service_with_a_health_check():
    assert re.search(r"^\s+runtime: docker$", BLUEPRINT, re.MULTILINE)
    assert not re.search(r"^\s+env: ", BLUEPRINT, re.MULTILINE)  # deprecated field
    assert re.search(r"^\s+plan: free$", BLUEPRINT, re.MULTILINE)
    assert re.search(r"^\s+healthCheckPath: /health$", BLUEPRINT, re.MULTILINE)
    assert re.search(r'^\s+autoDeployTrigger: "off"$', BLUEPRINT, re.MULTILINE)


def test_blueprint_env_vars_secrets_unset_and_config_fixed():
    env = blueprint_env()
    assert list(env) == [*SECRETS, "FASTEMBED_CACHE", "ENV"]
    for key in SECRETS:
        assert env[key] == ["sync: false"], key  # entered in the dashboard, never in git
    assert env["FASTEMBED_CACHE"] == [f"value: {IMAGE_CACHE}"]
    assert env["ENV"] == ["value: production"]


def test_deploy_config_names_no_ai_provider_key():
    for text in (DOCKERFILE, BLUEPRINT):
        assert not BANNED_KEYS.search(text)


def test_health_route_exists():
    from backend.main import app

    assert "/health" in {getattr(route, "path", None) for route in app.routes}
