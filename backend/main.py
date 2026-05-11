import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from backend.routers import auth, books, sessions, agent, dashboard

load_dotenv()

import subprocess
import sys
from datetime import datetime
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the MCP server subprocess on boot
    mcp_process = subprocess.Popen(
        [sys.executable, "backend/mcp_server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    yield
    # Terminate the subprocess on shutdown
    mcp_process.terminate()

app = FastAPI(title="ReadFocus API", lifespan=lifespan)

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")

origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
]

if frontend_url not in origins:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(books.router, prefix="/books", tags=["Books"])
app.include_router(sessions.router, prefix="/sessions", tags=["Sessions"])
app.include_router(agent.router, prefix="/agent", tags=["Agent"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat()
    }
