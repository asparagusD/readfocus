# Backend image for Render Free (0.1 CPU, 512 MB, ephemeral disk).
# The embedding model is downloaded here, at build time, so a cold start
# loads it from the image instead of fetching it from Hugging Face.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FASTEMBED_CACHE=/app/.cache/fastembed \
    EMBED_THREADS=1

WORKDIR /app

# Pinned dependencies first, so code changes reuse this layer.
COPY requirements.txt .
RUN pip install -r requirements.txt

RUN useradd --create-home --uid 10001 app \
    && mkdir -p "$FASTEMBED_CACHE" \
    && chown -R app:app /app/.cache
USER app

# Bake the model: only the embedder module is copied for this step, so the
# layer is rebuilt when the model changes, not on every code change.
COPY backend/__init__.py backend/__init__.py
COPY backend/nlp/__init__.py backend/nlp/__init__.py
COPY backend/nlp/embedder.py backend/nlp/embedder.py
RUN python -c "from backend.nlp import embedder; v = embedder.embed(['warm up']); assert v.shape == (1, embedder.EMBEDDING_DIM)"

# From here on the model must come from the image, never the network.
ENV HF_HUB_OFFLINE=1

COPY backend/ ./backend/

# Render sets PORT (10000 by default); 8000 locally. exec keeps uvicorn as
# PID 1 so it receives Render's stop signal.
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
