.PHONY: dev-backend dev-frontend dev

# Run the FastAPI backend with hot reloading
dev-backend:
	uvicorn backend.main:app --reload --port 8000

# Run the Vite frontend with hot reloading
dev-frontend:
	cd frontend && npm run dev

# Run both backend and frontend concurrently
dev:
	npx concurrently "make dev-backend" "make dev-frontend"
