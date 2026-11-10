# ReadFocus 2.0 — benchmarks

Measured numbers only. Each entry says what was run, on what, and when, so
it can be repeated. Numbers from this machine are not Render's: use them to
compare before and after, not as absolute limits.

## Machine

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| Python | 3.11.9 (`.venv`) |
| RAM | 31.9 GB |
| psutil | 7.2.2 |

## Backend memory at idle

Command, from the repo root with the virtualenv active:

```bash
python scripts/dev/measure_rss.py
```

It starts `uvicorn backend.main:app` with the real `.env`, waits for
`GET /health` to answer, waits 8 more seconds, then reads the resident set
size (RSS) of the server process and every child with psutil. No request
other than `/health` is made, so no LLM or embedding API is called.

On Windows each `.venv` Python shows up as two processes: a 4 MB launcher
and the real interpreter. Both are counted.

### C3.4: stop spawning the unused MCP subprocess (2026-11-10)

Three runs each. "Before" is commit `dde7af3`; "after" is the C3.4 commit.

| | Run 1 | Run 2 | Run 3 | Processes |
|---|---|---|---|---|
| Before: total RSS | 216.1 MB | 215.7 MB | 216.1 MB | 4 |
| After: total RSS | 142.0 MB | 141.9 MB | 142.0 MB | 2 |

Per process, run 1:

| Process | Before | After |
|---|---|---|
| uvicorn launcher | 4.2 MB | 4.2 MB |
| uvicorn interpreter (`backend.main:app`) | 138.0 MB | 137.7 MB |
| `backend/mcp_server.py` launcher | 4.2 MB | not started |
| `backend/mcp_server.py` interpreter | 69.7 MB | not started |
| **Total** | **216.1 MB** | **142.0 MB** |

Saved: 74 MB, 34% of the idle total. The server process itself is unchanged
at about 138 MB, which is the import cost of FastAPI, Supabase, LangChain
and the provider clients.

Not measured: Linux or Render, where there is no launcher process and the
numbers will differ; memory under load; memory during book ingestion.
