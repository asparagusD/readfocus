import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI

from backend.cors import add_cors
from backend.nlp import embedder
from backend.routers import (
    agent,
    annotations,
    auth,
    books,
    dashboard,
    lookup,
    mastery,
    ocr,
    sessions,
    steve,
    steve_ask,
)
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

add_cors(app)  # FRONTEND_URL only; localhost too when ENV=development (backend/cors.py)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(books.router, prefix="/books", tags=["Books"])
app.include_router(ocr.router, prefix="/books", tags=["Books"])
app.include_router(sessions.router, prefix="/sessions", tags=["Sessions"])
app.include_router(agent.router, prefix="/agent", tags=["Agent"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
app.include_router(mastery.router, prefix="/mastery", tags=["Mastery"])
app.include_router(lookup.router, prefix="/lookup", tags=["Lookup"])
app.include_router(steve.router, prefix="/steve", tags=["Steve"])
app.include_router(steve_ask.router, prefix="/steve", tags=["Steve"])
app.include_router(annotations.router, tags=["Annotations"])

@app.get("/health")
def health_check():
    # Never waits on the model: it only reads whether the load has finished.
    return {
        "status": "ok",
        "model_ready": embedder.is_ready(),
        "timestamp": datetime.utcnow().isoformat()
    }
