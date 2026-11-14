"""A reader's own Gemini key (C20.3, docs/STEVE.md S7): encrypted at rest, decrypted only here for a call.

Fernet (AES-128-CBC with HMAC-SHA256, from `cryptography`) with a key derived by HKDF-SHA256 from
KEY_ENCRYPTION_SECRET. The cipher lives in profiles.steve_key_cipher with the last four characters beside it; the
key itself is never returned, logged or put in an error. No secret on the server means no own keys (fail closed).
"""

import base64
import logging
import os
import re

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from backend.services.supabase_client import supabase
from backend.steve.errors import SteveUnavailable

logger = logging.getLogger("steve.keys")
SECRET_ENV = "KEY_ENCRYPTION_SECRET"
KEY_SHAPE = re.compile(r"[A-Za-z0-9_\-]{30,100}")  # Google's keys today: "AIza" and 35 more of these
SALT, INFO = b"readfocus-steve-keys", b"reader gemini key v1"


class KeysNotConfigured(Exception):
    """KEY_ENCRYPTION_SECRET is missing or too short: own keys are off on this server."""


def _fernet() -> Fernet:
    secret = os.environ.get(SECRET_ENV, "")
    if len(secret) < 32:
        raise KeysNotConfigured
    derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=SALT, info=INFO).derive(secret.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(derived))


def looks_like_key(key: str) -> bool:
    return bool(KEY_SHAPE.fullmatch(key))


def last4(key: str) -> str:
    return key[-4:]


def encrypt(key: str) -> str:
    return _fernet().encrypt(key.encode("utf-8")).decode("ascii")


def decrypt(cipher: str) -> str:
    return _fernet().decrypt(cipher.encode("ascii")).decode("utf-8")


def status(user_id: str) -> dict:
    rows = supabase.table("profiles").select("steve_key_last4").eq("user_id", user_id).execute().data or []
    last = rows[0].get("steve_key_last4") if rows else None
    return {"has_key": last is not None, "last4": last}


def store(user_id: str, key: str) -> None:
    supabase.table("profiles").update({"steve_key_cipher": encrypt(key), "steve_key_last4": last4(key)}).eq(
        "user_id", user_id).execute()


def remove(user_id: str) -> None:
    supabase.table("profiles").update({"steve_key_cipher": None, "steve_key_last4": None}).eq(
        "user_id", user_id).execute()


def reader_key(user_id: str) -> str | None:
    """The reader's own key, decrypted for one call, or None (Steve then uses ours). A cipher that no longer
    decrypts (the secret changed) or a server with no secret is key_rejected: the reader adds the key again."""
    rows = supabase.table("profiles").select("steve_key_cipher").eq("user_id", user_id).execute().data or []
    cipher = rows[0].get("steve_key_cipher") if rows else None
    if not cipher:
        return None
    try:
        return decrypt(cipher)
    except (InvalidToken, KeysNotConfigured):
        logger.warning("steve.keys a stored key could not be decrypted; the reader must add it again")
        raise SteveUnavailable("key_rejected") from None
