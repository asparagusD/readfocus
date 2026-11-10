# Manual scripts

These eight files are ad-hoc scripts from before ReadFocus 2.0. They lived in
the repo root until C3.3. They are **not tests**: they have no assertions,
they print what happened, and pytest does not collect them (`pytest.ini`
limits collection to `backend/tests` and `tools/repo_graph/tests`).

They are kept for reference only and are unchanged apart from the move.

## They need live services

Every script talks to real systems using the values in `.env`:

- the Supabase project (reads and writes real rows with the service-role key);
- Groq, for planning, question generation, grading and pacing;
- Google AI Studio, for embeddings.

Groq and Google AI Studio are banned by hard constraint 1 in `CLAUDE.md`, so
**do not run these during the 2.0 sprint**. Running one also changes data in
whichever Supabase project `.env` points at.

## State of each script

| Script | What it does | Known problems |
|---|---|---|
| `test_planner.py` | Runs `plan_session` and prints the plan | Hard-coded user and book ids |
| `test_generator.py` | Generates questions for a book and prints them | Hard-coded book id |
| `test_evaluator.py` | Generates a test, then grades canned answers | Hard-coded ids |
| `test_optimizer.py` | Runs `optimize_pace` with a 7/50 score | Hard-coded ids |
| `test_graph.py` | Invokes the LangGraph workflow | Sets `event_type`, which the graph does not read |
| `test_orchestrator.py` | Meant to call the orchestrator node | Fails at import: `orchestrator_node` does not exist |
| `test_ingest.py` | Creates a user and a book, then ingests `sample.pdf` | Runs at import; creates a user with a fixed password; calls the async `ingest_book` without awaiting it |
| `test_sessions_api.py` | Start, finish-reading and submit-answers through `TestClient` | Authenticates with a raw UUID, which stopped working in C3.1; it now gets 401 |

## If you do need to run one

From the repo root, with the virtualenv active, as a module so that
`backend` can be imported:

```bash
python -m scripts.manual.test_planner
```

`test_ingest.py` opens `sample.pdf` by a relative path, so it only works from
the repo root.

The automated, offline tests are in `backend/tests/`.
