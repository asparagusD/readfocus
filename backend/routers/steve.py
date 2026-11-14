"""Steve's settings (C20.1): GET and PUT /steve/settings, the reader's off switch and consent.

Consent is stored with the notice version the reader accepted (backend/steve/consent.py); only the
current version counts as consent. The encrypted key column is never read here (C20.3 owns it).
"""

from datetime import UTC, datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StrictBool, model_validator

from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase
from backend.steve import consent

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
