.PHONY: dev-backend dev-frontend dev graph

# Run the FastAPI backend with hot reloading
dev-backend:
	uvicorn backend.main:app --reload --port 8000

# Run the Vite frontend with hot reloading
dev-frontend:
	cd frontend && npm run dev

# Run both backend and frontend concurrently
dev:
	npx concurrently "make dev-backend" "make dev-frontend"

# Regenerate docs/repo-graph/ (inventory -> graph -> map). Needs the virtualenv.
graph:
	python tools/repo_graph/inventory.py
	python tools/repo_graph/build.py
	python tools/repo_graph/render.py
