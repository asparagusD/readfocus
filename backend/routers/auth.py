from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from backend.dependencies import get_current_user
from backend.services.supabase_client import supabase

router = APIRouter()

class CalibrateRequest(BaseModel):
    wpm: int

@router.get("/profile")
async def get_profile(user_id: str = Depends(get_current_user)):
    try:
        resp = supabase.table("profiles").select("*").eq("user_id", user_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Profile not found.")
        profile = resp.data[0]
        if "is_calibrated" not in profile:
            profile["is_calibrated"] = False
        return profile
    except Exception as e:
        print("Error fetching profile:", e)
        return {"user_id": user_id, "reading_goal_wpm": 200, "is_calibrated": False}

@router.post("/profile/calibrate")
async def calibrate_profile(req: CalibrateRequest, user_id: str = Depends(get_current_user)):
    if req.wpm <= 0:
        raise HTTPException(status_code=400, detail="WPM must be positive.")
        
    try:
        resp = supabase.table("profiles").update({
            "reading_goal_wpm": req.wpm,
            "is_calibrated": True
        }).eq("user_id", user_id).execute()
        
        if not resp.data:
            raise HTTPException(status_code=404, detail="Profile not found.")
            
        return resp.data[0]
    except Exception as e:
        print("Error updating profile (migration missing?):", e)
        resp = supabase.table("profiles").update({
            "reading_goal_wpm": req.wpm
        }).eq("user_id", user_id).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Profile not found.")
        return resp.data[0]
