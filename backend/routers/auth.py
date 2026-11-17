
from typing import Any, cast
from fastapi import APIRouter, HTTPException, Depends
from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase

router = APIRouter()

@router.get("/profile")
async def get_profile(user_id: str = Depends(get_current_user)):
    try:
        resp = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Profile not found.")
        profile: dict[str, Any] = cast(dict[str, Any], resp.data[0])
        profile.pop("steve_key_cipher", None)  # the reader's encrypted Gemini key never leaves the server (C20.1)
        if "is_calibrated" not in profile:
            profile["is_calibrated"] = False
        return profile
    except Exception as e:
        print("Error fetching profile:", e)
        return {"user_id": user_id, "reading_goal_wpm": 200, "is_calibrated": False}

