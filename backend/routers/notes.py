"""Note blocks (C22.1, docs/ANCHORS.md): the notepad's blocks, each anchored to the passage it was written about.

GET /books/{id}/notes lists a reader's live blocks in reading order (from/to: those overlapping a range), with
signed URLs for their files. POST creates one at version 1. PATCH /notes/{id} needs If-Match with the version it
was made on: a stale one is 409 and changes nothing, so two tabs never overwrite each other. DELETE sets
deleted_at. POST /books/{id}/note-files stores a WebP or PNG in the reader's folder of the private "notes" bucket.
Owner only: every query filters by the caller's id (the service role bypasses RLS; migration 027's SELECT policies
are the second wall), and another reader's book, block or file is 404.
"""

import base64
import binascii
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.services.anchor_checks import MAX_POSITION, Anchor, check_anchors
from backend.services.book_purge import live
from backend.services.note_content import check_content, owned_path
from backend.services.supabase_client import supabase
from backend.xp import badge_award

router = APIRouter()

BUCKET = "notes"
SIGNATURES = {"image/png": (b"\x89PNG\r\n\x1a\n",), "image/webp": (b"RIFF", b"WEBP")}
EXTENSIONS = {"image/png": "png", "image/webp": "webp"}


class _Anchored(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: str = "selection"
    anchors: list[Anchor] | None = Field(default=None, min_length=1, max_length=policy.ANNOTATION_ANCHORS_MAX)
    position_start: float | None = Field(default=None, ge=0, lt=MAX_POSITION)
    position_end: float | None = Field(default=None, ge=0, lt=MAX_POSITION)
    thumbnail_path: str | None = None

    def _check_anchors(self):
        if self.scope not in policy.NOTE_SCOPES:
            raise ValueError(f"scope is one of {policy.NOTE_SCOPES}")
        given = (self.anchors, self.position_start, self.position_end)
        if any(v is None for v in given) and any(v is not None for v in given):
            raise ValueError("anchors come with both positions")
        if self.anchors is not None:
            check_anchors(self.anchors, self.position_start, self.position_end, text=self.scope == "selection")


class NewNote(_Anchored):
    kind: str
    anchors: list[Anchor] = Field(min_length=1, max_length=policy.ANNOTATION_ANCHORS_MAX)
    position_start: float = Field(ge=0, lt=MAX_POSITION)
    position_end: float = Field(ge=0, lt=MAX_POSITION)
    content: dict
    annotation_id: str | None = None
    region_id: str | None = None

    @model_validator(mode="after")
    def valid(self):
        self._check_anchors()
        return self


class NoteChange(_Anchored):
    scope: str | None = None
    content: dict | None = None
    orphaned: bool | None = None

    @model_validator(mode="after")
    def valid(self):
        if self.scope is not None or self.anchors is not None:
            self.scope = self.scope or "selection"
            self._check_anchors()
        return self


class NoteFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content_type: str
    data: str = Field(max_length=(policy.NOTE_FILE_BYTES_MAX * 4) // 3 + 8)


def _refuse(detail) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


def _owned(book_id: str, user_id: str) -> None:
    if not live(supabase.table("books").select("id, status").eq("id", book_id).eq("user_id", user_id).execute().data):
        raise HTTPException(status_code=404, detail="Book not found")


def _live(note_id: str, user_id: str) -> dict:
    rows = (supabase.table("note_blocks").select("id, book_id, kind, version").eq("id", note_id)
            .eq("user_id", user_id).is_("deleted_at", "null").execute().data)
    if not rows:
        raise HTTPException(status_code=404, detail="Note not found")
    return rows[0]


def _version(if_match: str | None) -> int:
    if if_match is None:
        raise HTTPException(status_code=428, detail="Send If-Match with the note's version")
    value = if_match.strip().strip('"')
    if not value.isdigit():
        raise HTTPException(status_code=412, detail="If-Match is the note's version")
    return int(value)


def _check_links(row: dict, user_id: str, book_id: str) -> None:
    if row.get("thumbnail_path") is not None and not owned_path(row["thumbnail_path"], user_id, book_id):
        raise _refuse("thumbnail_path is a file in your notes folder")
    if row.get("annotation_id") and not supabase.table("annotations").select("id").eq("id", row["annotation_id"]) \
            .eq("user_id", user_id).eq("book_id", book_id).execute().data:
        raise _refuse("annotation_id is one of your highlights in this book")
    if row.get("region_id") and not supabase.table("page_regions").select("id").eq("id", row["region_id"]) \
            .eq("user_id", user_id).eq("book_id", book_id).execute().data:
        raise _refuse("region_id is a region of this book")


def _content(kind: str, content: dict, user_id: str, book_id: str) -> dict:
    try:
        return check_content(kind, content, user_id=user_id, book_id=book_id)
    except ValueError as error:
        raise _refuse(str(error)) from error


def _with_etag(response: Response, row: dict) -> dict:
    response.headers["ETag"] = f'"{row["version"]}"'
    return row


def _signed(bucket, path: str) -> str:
    signed = bucket.create_signed_url(path, policy.NOTE_FILE_URL_SECONDS)
    return signed.get("signedURL") or signed.get("signedUrl")


def _files_of(row: dict) -> set[str]:
    content = row.get("content") or {}
    paths = {row.get("thumbnail_path"), content.get("image_path")}
    paths |= {f.get("path") for f in (content.get("files") or {}).values() if isinstance(f, dict)}
    return {p for p in paths if isinstance(p, str)}


@router.get("/books/{book_id}/notes")
def list_notes(book_id: str, start: float | None = Query(default=None, alias="from", ge=0),
               end: float | None = Query(default=None, alias="to", ge=0),
               user_id: str = Depends(get_current_user)):
    """The reader's live blocks in this book in reading order (then oldest first); with from/to, those
    overlapping that range. Each has `urls`: its files' signed URLs."""
    if start is not None and end is not None and end < start:
        raise _refuse("from is at most to")
    _owned(book_id, user_id)
    query = (supabase.table("note_blocks").select("*").eq("user_id", user_id).eq("book_id", book_id)
             .is_("deleted_at", "null"))
    if start is not None:
        query = query.gte("position_end", start)
    if end is not None:
        query = query.lte("position_start", end)
    rows = query.order("position_start").order("created_at").limit(policy.NOTES_LIST_MAX).execute().data
    bucket = supabase.storage.from_(BUCKET)
    for row in rows:
        row["urls"] = {p: _signed(bucket, p) for p in sorted(_files_of(row))}
    return {"notes": rows}


@router.post("/books/{book_id}/notes", status_code=201)
def create_note(book_id: str, req: NewNote, response: Response, user_id: str = Depends(get_current_user)):
    _owned(book_id, user_id)
    if req.kind not in policy.NOTE_KINDS:
        raise _refuse(f"kind is one of {policy.NOTE_KINDS}")
    row = {"user_id": user_id, "book_id": book_id, "kind": req.kind, "scope": req.scope,
           "anchors": [a.model_dump() for a in req.anchors], "position_start": req.position_start,
           "position_end": req.position_end, "content": _content(req.kind, req.content, user_id, book_id),
           "thumbnail_path": req.thumbnail_path, "annotation_id": req.annotation_id, "region_id": req.region_id,
           "orphaned": False, "version": 1, "deleted_at": None, "created_at": datetime.now(UTC).isoformat()}
    _check_links(row, user_id, book_id)
    saved = supabase.table("note_blocks").insert(row).execute().data[0]
    badge_award.check_quietly(user_id, "note")  # C24.2: First note, First drawing
    return _with_etag(response, saved)


@router.patch("/notes/{note_id}")
def update_note(note_id: str, req: NoteChange, response: Response, user_id: str = Depends(get_current_user),
                if_match: str | None = Header(default=None)):
    change = req.model_dump(exclude_none=True)
    if not change:
        raise _refuse("Give content, anchors with positions, a thumbnail or orphaned")
    version = _version(if_match)
    note = _live(note_id, user_id)
    if "content" in change:
        change["content"] = _content(note["kind"], change["content"], user_id, note["book_id"])
    if "anchors" in change:
        change["anchors"] = [a.model_dump() for a in req.anchors]
    _check_links(change, user_id, note["book_id"])
    change |= {"version": version + 1, "updated_at": datetime.now(UTC).isoformat()}
    # The version filter makes the write conditional: it changes nothing unless no one saved in between.
    rows = (supabase.table("note_blocks").update(change).eq("id", note_id).eq("user_id", user_id)
            .eq("version", version).is_("deleted_at", "null").execute().data)
    if not rows:
        current = _live(note_id, user_id)["version"]
        raise HTTPException(status_code=409, detail={"message": "This note changed since you opened it",
                                                     "version": current})
    return _with_etag(response, rows[0])


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: str, user_id: str = Depends(get_current_user)):
    """Soft delete: the row stays with deleted_at set (and its version bumped), hidden from lists and edits."""
    note = _live(note_id, user_id)
    now = datetime.now(UTC).isoformat()
    supabase.table("note_blocks").update({"deleted_at": now, "updated_at": now, "version": note["version"] + 1}) \
        .eq("id", note_id).eq("user_id", user_id).execute()
    return Response(status_code=204)


@router.post("/books/{book_id}/note-files", status_code=201)
def upload_note_file(book_id: str, req: NoteFile, user_id: str = Depends(get_current_user)):
    """A WebP or PNG for a note (an equation, a figure, a drawing's image or thumbnail), at most
    NOTE_FILE_BYTES_MAX, stored at <user_id>/<book_id>/<uuid>.<ext>. Returns its path and a signed URL."""
    _owned(book_id, user_id)
    if req.content_type not in policy.NOTE_FILE_TYPES:
        raise _refuse(f"content_type is one of {policy.NOTE_FILE_TYPES}")
    try:
        data = base64.b64decode(req.data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise _refuse("data is base64") from error
    head, *tail = SIGNATURES[req.content_type]
    if not data.startswith(head) or any(mark not in data[:16] for mark in tail):
        raise _refuse("the file is not what content_type says")
    if len(data) > policy.NOTE_FILE_BYTES_MAX:
        raise _refuse(f"a note file is at most {policy.NOTE_FILE_BYTES_MAX} bytes")
    path = f"{user_id}/{book_id}/{uuid.uuid4().hex}.{EXTENSIONS[req.content_type]}"
    bucket = supabase.storage.from_(BUCKET)
    bucket.upload(file=data, path=path, file_options={"content-type": req.content_type, "upsert": "false"})
    return {"path": path, "url": _signed(bucket, path)}
