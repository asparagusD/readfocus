---
name: repo-graph
description: "Use before editing any file and after any structural change. Before an edit, query the repo graph to see what the file imports, what depends on it, and which endpoints, tables and agents it touches. After adding, removing, renaming or rewiring files, endpoints, tables or agent nodes, regenerate the graph with `make graph` and commit docs/repo-graph/ with the change."
---

# Repo graph

The repo graph is a generated map of how the code fits together: which files
import which, which endpoints call which services, which code reads and
writes which tables, and how the LangGraph agents connect. Use it so that an
edit accounts for everything upstream and downstream of the file.

The tooling is in `tools/repo_graph/` (built in C2) and uses only the Python
standard library. Run it from the repo root with the virtualenv active.

## Where it lives

Everything is under `docs/repo-graph/` and is generated. Never edit these
files by hand.

| File | For | Contents |
|---|---|---|
| `inventory.json` | Tools | Every tracked file: language, lines, size, role, one-line purpose; plus the excluded files |
| `graph.json` | Tools | The typed graph that `query.py` reads: files, endpoints, tables, database functions, env vars, external services, LangGraph nodes |
| `REPO_MAP.md` | People and Claude | Layer diagram, LangGraph diagram, and lookup tables for endpoints, tables, services, env vars and files |

If this table and the generated files disagree, the generated files are
right; fix this skill.

A new tracked file needs a one-line purpose in
`tools/repo_graph/purposes.json`, written after reading the file, or
`make graph` fails and names the file. Remove the purpose when the file is
deleted.

## Before editing a file

Query the graph for the thing you are about to change:

```bash
python tools/repo_graph/query.py <file|endpoint|table>
```

For example:

```bash
python tools/repo_graph/query.py backend/routers/sessions.py
python tools/repo_graph/query.py "POST /sessions/start"
python tools/repo_graph/query.py reading_progress
```

It also accepts a database function, env var, external service or LangGraph
node name. An endpoint can be given without its method (`/sessions/start`)
in PowerShell; Git Bash rewrites an argument that starts with `/`, so give
the method there. Exit code 2 means nothing matched, and the output suggests
close names.

The query reads the committed `graph.json`. If you have already changed the
code, run `make graph` first.

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
  listing directories, and its "LangGraph wiring" section before touching
  `backend/agents/`.

## What the graph does not see

Search by hand for these, and say so in the commit's `Notes`:

- **Columns.** Table edges say which file reads or writes a table, not
  which columns. Before changing a column, search for its name.
- **Text matches.** Table, env var and RPC edges come from regexes on the
  file text, so a commented-out call still counts and a table name built at
  run time is missed.
- **Processes and storage.** `backend/main.py` starting
  `backend/mcp_server.py` through `subprocess`, and Supabase Storage bucket
  use, are not edges.
- **The tooling itself.** Files under `tools/repo_graph/` are scanned for
  imports only.
