---
name: repo-graph
description: "Use before editing any file and after any structural change. Before an edit, query the repo graph to see what the file imports, what depends on it, and which endpoints, tables and agents it touches. After adding, removing, renaming or rewiring files, endpoints, tables or agent nodes, regenerate the graph with `make graph` and commit docs/repo-graph/ with the change."
---

# Repo graph

The repo graph is a generated map of how the code fits together: which files
import which, which endpoints call which services, which code reads and
writes which tables, and how the LangGraph agents connect. Use it so that an
edit accounts for everything upstream and downstream of the file.

> **Status: the tooling is built in C2.** Until then `make graph`,
> `tools/repo_graph/` and `docs/repo-graph/` do not exist. Use the
> [manual fallback](#until-c2-manual-fallback) and do not claim the graph was
> queried or regenerated.

## Where it lives

Everything is under `docs/repo-graph/` and is generated. Never edit these
files by hand.

| File | For | Contents |
|---|---|---|
| `graph.json` | Tools | The machine-readable graph that `query.py` reads |
| `REPO_MAP.md` | People and Claude | The readable map of files, endpoints and tables |
| `AGENT_GRAPH.md` | People and Claude | The LangGraph agents and how they connect |

C2 defines the exact format of each file. If this table and the generated
files disagree, the generated files are right; fix this skill.

## Before editing a file

Query the graph for the thing you are about to change:

```bash
python tools/repo_graph/query.py <file|endpoint|table>
```

For example (shapes to be confirmed in C2):

```bash
python tools/repo_graph/query.py backend/routers/sessions.py
python tools/repo_graph/query.py /sessions/start
python tools/repo_graph/query.py reading_progress
```

Then:

1. Read the upstream files (what this one depends on) that the change relies
   on.
2. Read the downstream files (what depends on this one) that the change could
   break.
3. If the change alters a function signature, an endpoint's request or
   response, or a table's columns, every downstream user is in scope for the
   same subchunk, or the change must stay backward compatible.

Skip the query only for files with no code relationships, such as prose in
`docs/` or `README.md`.

## After a structural change

A change is structural if it does any of these:

- adds, deletes, moves or renames a source file;
- adds or removes an import between project modules;
- adds, removes or renames an endpoint;
- adds a migration, or changes which code reads or writes a table;
- adds, removes or rewires an agent node or edge in `backend/agents/`.

Editing the body of an existing function without changing what it imports or
calls is not structural.

After a structural change:

```bash
make graph
git status --short docs/repo-graph/
```

Stage `docs/repo-graph/` explicitly and include it in the **same commit** as
the change, so the graph at any commit matches the code at that commit.
Generated graph files do not count towards the ~200-line commit limit.

If `make graph` changes `docs/repo-graph/` when you made no structural
change, the committed graph was stale. Commit the refresh on its own as
`chore(graph): regenerate repo graph` and mention it to the user.

## Other uses

- **Debugging**: step 3 of `debug-protocol` uses the same query to find the
  files around a failure.
- **Orientation**: read `REPO_MAP.md` at the start of a chunk instead of
  listing directories, and `AGENT_GRAPH.md` before touching
  `backend/agents/`.

## Until C2: manual fallback

Find a file's neighbours by search. For a backend module such as
`backend/services/book_ingestor.py`:

- **Upstream**: read the `import` lines at the top of the file.
- **Downstream**: search `backend/` for `book_ingestor`.
- **Endpoints**: search `backend/routers/` for the path, and `frontend/src/`
  for where it is called.
- **Tables**: search `backend/` for `.table("<name>")` and
  `supabase/migrations/` for the table name.
- **Agents**: read `backend/agents/graph.py`, which wires the nodes.

For a frontend file, search `frontend/src/` for its import path.

Say in the commit's `Notes` that neighbours were found by search, not by the
graph.
