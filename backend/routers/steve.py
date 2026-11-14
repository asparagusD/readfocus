"""Steve's settings (C20.1): GET and PUT /steve/settings, the reader's off switch and consent; and (C20.3)
GET, PUT and DELETE /steve/key, the reader's own Gemini key.

Consent is stored with the notice version the reader accepted (backend/steve/consent.py); only the
current version counts as consent. The key is checked with Google, encrypted and stored by backend/steve/keys.py;
responses carry only {has_key, last4}. PUT /steve/key reads its body by hand: FastAPI's validation errors echo the
input, and the input is the key.
"""

import json
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, StrictBool, model_validator

from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase
from backend.steve import consent, keys, provider
from backend.steve.errors import SteveUnavailable

router = APIRouter()

SETTINGS_FIELDS = "steve_enabled, steve_consent_at, steve_consent_version"


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: StrictBool | None = None
    consent: StrictBool | None = None
    consent_version: str | None = None

    @model_validator(mode="after")
    def something_to_change(self):
        if self.enabled is None and self.consent is None:
            raise ValueError("Send enabled, consent or both.")
        return self


def _profile(user_id: str) -> dict[str, Any]:
    rows = supabase.table("profiles").select(SETTINGS_FIELDS).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return cast(dict[str, Any], rows[0])


def _settings(row: dict[str, Any]) -> dict[str, Any]:
    at, version = row.get("steve_consent_at"), row.get("steve_consent_version")
    return {
        "enabled": row.get("steve_enabled") is not False,
        "consent": {"given": at is not None, "at": at, "version": version,
                    "current": at is not None and version == consent.CONSENT_VERSION},
        "notice": {"version": consent.CONSENT_VERSION, "text": consent.CONSENT_TEXT, "terms_url": consent.TERMS_URL},
    }


@router.get("/settings")
async def get_settings(user_id: str = Depends(get_current_user)):
    return _settings(_profile(user_id))


@router.put("/settings")
async def put_settings(req: SettingsUpdate, user_id: str = Depends(get_current_user)):
    _profile(user_id)
    changes: dict[str, Any] = {}
    if req.enabled is not None:
        changes["steve_enabled"] = req.enabled
    if req.consent is True:
        if req.consent_version != consent.CONSENT_VERSION:
            raise HTTPException(status_code=409, detail="Accept the current notice to turn on Steve.")
        changes["steve_consent_at"] = datetime.now(UTC).isoformat()
        changes["steve_consent_version"] = consent.CONSENT_VERSION
    elif req.consent is False:
        changes["steve_consent_at"] = None
        changes["steve_consent_version"] = None
    supabase.table("profiles").update(changes).eq("user_id", user_id).execute()
    return _settings(_profile(user_id))


KEY_MALFORMED = "Send {\"key\": \"...\"} with a Gemini API key from Google AI Studio."
KEY_REJECTED = "Google did not accept this key. Check that you copied all of it, from Google AI Studio."
KEY_UNCHECKED = "Google could not check the key just now. Try again in a minute."
KEYS_OFF = "Own keys are not available on this server yet."


@router.get("/key")
async def get_key(user_id: str = Depends(get_current_user)):
    return keys.status(user_id)


@router.put("/key")
async def put_key(request: Request, user_id: str = Depends(get_current_user)):
    try:
        body = json.loads(await request.body())
    except ValueError:
        body = None
    key = body.get("key") if isinstance(body, dict) and set(body) == {"key"} else None
    key = key.strip() if isinstance(key, str) else ""
    if not keys.looks_like_key(key):
        raise HTTPException(status_code=422, detail=KEY_MALFORMED)
    try:
        keys.encrypt("check")  # the server can store keys at all, before asking Google
        await provider.check_key(key)
        keys.store(user_id, key)
    except keys.KeysNotConfigured:
        raise HTTPException(status_code=503, detail=KEYS_OFF) from None
    except SteveUnavailable as unavailable:
        if unavailable.reason == "key_rejected":
            raise HTTPException(status_code=400, detail=KEY_REJECTED) from None
        raise HTTPException(status_code=503, detail=KEY_UNCHECKED) from None
    return keys.status(user_id)


@router.delete("/key")
async def delete_key(user_id: str = Depends(get_current_user)):
    keys.remove(user_id)
    return keys.status(user_id)
