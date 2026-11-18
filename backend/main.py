import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI

from backend.cors import add_cors
from backend.focus import store as focus_store
from backend.nlp import embedder
from backend.routers import (
    agent,
    annotations,
    auth,
    books,
    dashboard,
    device_books,
    focus,
    internal,
    lookup,
    mastery,
    notes,
    ocr,
    progress,
    reading,
    sessions,
    steve,
    steve_ask,
)
from backend.services import ingestion_worker, pdf_text

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # C33.G: the loaded modules stay out of later collections, so release_memory's
    # gc.collect() never holds the event loop for a walk of the whole heap.
    pdf_text.freeze_startup_heap()
    # Load the embedding model on a background thread: /health answers at once
    # and reports model_ready; grading endpoints wait for it (require_model).
    if embedder.preload_enabled():
        embedder.preload()
    # Resume ingestion jobs a stopped server left behind (processing_jobs).
    sweep = asyncio.create_task(ingestion_worker.sweep_forever()) if ingestion_worker.sweep_enabled() else None
    # C23.4: focus sessions left open with no event for two hours are abandoned (FOCUS_RULES F1).
    if focus_store.sweep_enabled():
        try:
            swept = await asyncio.to_thread(focus_store.sweep_abandoned)
            if swept:
                print(f"Focus sweep: {swept} session(s) abandoned")
        except Exception as e:  # noqa: BLE001 - a sweep that fails must not stop the server starting
            print(f"Focus sweep failed: {e}")
    yield
    if sweep:
        sweep.cancel()


app = FastAPI(title="ReadFocus API", lifespan=lifespan)

add_cors(app)  # FRONTEND_URL only; localhost too when ENV=development (backend/cors.py)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(books.router, prefix="/books", tags=["Books"])
app.include_router(ocr.router, prefix="/books", tags=["Books"])
app.include_router(reading.router, prefix="/books", tags=["Books"])
app.include_router(device_books.router, prefix="/books", tags=["Books"])  # C26.7: books over 50 MB  # C26.4: open at the place
app.include_router(sessions.router, prefix="/sessions", tags=["Sessions"])
app.include_router(agent.router, prefix="/agent", tags=["Agent"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
app.include_router(mastery.router, prefix="/mastery", tags=["Mastery"])
app.include_router(lookup.router, prefix="/lookup", tags=["Lookup"])
app.include_router(steve.router, prefix="/steve", tags=["Steve"])
app.include_router(steve_ask.router, prefix="/steve", tags=["Steve"])
app.include_router(annotations.router, tags=["Annotations"])
app.include_router(notes.router, tags=["Notes"])
app.include_router(focus.router, prefix="/focus", tags=["Focus"])
app.include_router(internal.router, prefix="/internal", tags=["Internal"])  # C24.4: scheduled jobs
app.include_router(progress.router, tags=["Progress"])  # C24.5: progress, badges, league

@app.get("/health")
def health_check():
    # Never waits on the model: it only reads whether the load has finished.
    return {
        "status": "ok",
        "model_ready": embedder.is_ready(),
        "timestamp": datetime.utcnow().isoformat()
    }
