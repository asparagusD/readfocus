import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from backend.routers import auth, books, sessions, agent, dashboard, mastery, lookup
from backend.nlp import embedder
from backend.services import ingestion_worker

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the embedding model on a background thread: /health answers at once
    # and reports model_ready; grading endpoints wait for it (require_model).
    if embedder.preload_enabled():
        embedder.preload()
    # Resume ingestion jobs a stopped server left behind (processing_jobs).
    sweep = asyncio.create_task(ingestion_worker.sweep_forever()) if ingestion_worker.sweep_enabled() else None
    yield
    if sweep:
        sweep.cancel()


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
app.include_router(mastery.router, prefix="/mastery", tags=["Mastery"])
app.include_router(lookup.router, prefix="/lookup", tags=["Lookup"])

@app.get("/health")
def health_check():
    # Never waits on the model: it only reads whether the load has finished.
    return {
        "status": "ok",
        "model_ready": embedder.is_ready(),
        "timestamp": datetime.utcnow().isoformat()
    }
