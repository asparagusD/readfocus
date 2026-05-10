from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.services.supabase_client import supabase

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """
    Extracts the user_id from the Supabase JWT Bearer token.
    """
    token = credentials.credentials
    
    # --- Local Dev Bypass for easy testing ---
    # If you pass a raw UUID instead of a JWT token, we'll accept it as the user_id.
    # This saves you from having to manually generate JWTs while testing the API!
    if len(token) == 36 and token.count("-") == 4:
        return token
    # -----------------------------------------
    
    try:
        user_resp = supabase.auth.get_user(token)
        if user_resp and user_resp.user:
            return user_resp.user.id
        else:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")
