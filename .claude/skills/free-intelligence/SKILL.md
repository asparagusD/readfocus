---
name: free-intelligence
description: "Use whenever a change adds or touches anything 'intelligent' in this repo: agents, LangGraph nodes, planning, question generation, grading, pacing, scoring, embeddings, search, region maps, keyword or summary extraction, word lookup, or any new dependency, model or external API. Enforces $0 API cost: no LLM or embedding APIs except Gemini for Steve, approved local libraries and free APIs only, memory measured before and after, and the pure decide() agent pattern."
---

# Free intelligence

ReadFocus 2.0 costs $0 to run. Every "smart" feature is an algorithm or a
small local model running inside the backend on Render Free. The one
exception is Steve, the opt-in study assistant, who calls Gemini through
`backend/steve/` under the `steve-guardrails` skill. This skill enforces
hard constraints 1 and 5 from `CLAUDE.md`.

**Agents, planning, question generation, grading, pacing and every score
(test, focus, XP) stay algorithmic.** They never call Gemini or Steve, and
nothing they decide depends on Steve's output.

## Banned

Never call, import, install or add a key for any of these. Gemini is the
only exception, and only for Steve (see below).

| Banned | Includes |
|---|---|
| Groq | `groq`, `langchain-groq` |
| OpenAI | `openai`, `langchain-openai` |
| Anthropic | `anthropic`, `langchain-anthropic` |
| Gemini outside Steve | any Gemini call outside `backend/steve/provider.py`; `langchain-google-genai` anywhere |
| Cerebras | any SDK or endpoint |
| SambaNova | any SDK or endpoint |
| OpenRouter | any SDK or endpoint |
| Google scraping | fetching or parsing Google search results in any way |
| Paid search APIs | SerpAPI, Bing, Brave, Tavily, Exa and similar |

Also banned: any other hosted LLM or embedding endpoint (including Gemini
embeddings), any service that needs a payment method, free tiers or trial
credits of the providers above, and a fallback provider for Steve. A free
tier is still an API call, and it stops being free.

If a task seems to need one of these, stop and tell the user. Propose an
algorithmic or local-model alternative instead of adding it.

### Existing violations

None since C8.8: the Groq and Google AI Studio clients, their packages and
their keys are gone. Until Steve's backend chunk (C22) the guard below
still bans Gemini everywhere; that chunk narrows it, test first, so only
`backend/steve/` may import the Gemini SDK or read `GEMINI_*` keys.
`backend/tests/test_no_paid_ai.py` fails if a banned
SDK is imported under `backend/`, a provider is named anywhere in
`backend/`, a provider key is read or declared, or a banned package is
added to `requirements.txt`. The deny-list itself is `tools/no_paid_ai.py`,
outside `backend/`. Check by hand with:

```bash
grep -rnilE "groq|openai|anthropic|generativeai|genai|cerebras|sambanova|openrouter" backend --include=*.py
```

It prints nothing. Any file it prints is a violation.

## Approved local libraries

| Library | Use for |
|---|---|
| `fastembed` | Text embeddings from a small local ONNX model, cached under `FASTEMBED_CACHE` |
| `yake` | Keyword and key-phrase extraction |
| `scikit-learn` | TF-IDF, cosine similarity, clustering, simple models |
| `rapidfuzz` | Fuzzy string matching for grading answers |
| `numpy` | Vector maths |
| `langgraph` | Orchestrating the agent graph (no LLM nodes) |
| `pdfplumber` | PDF layout (words, lines, rects, images) for the region map |

Pydantic, httpx and the Python standard library are fine too. Anything else
that does "intelligence" work needs the user's approval and a memory
measurement first.

## Approved free external APIs

| API | Use for |
|---|---|
| Free Dictionary API | Word definitions |
| Wikipedia REST API | Short summaries for names and terms |
| Open Library | Book metadata and covers |
| Gemini (free tier, or the reader's own key) | Steve only, through `backend/steve/provider.py`, under the `steve-guardrails` skill |

Rules for every external call (for Gemini, `steve-guardrails` adds
consent, context, quota and key rules on top, and its key is the one
allowed exception to "no keys"):

- **Backend only.** The frontend calls our FastAPI backend, never the
  external API directly.
- **Cached.** Look in the cache first and store every successful response, so
  a word is fetched at most once. Cache "not found" answers as well.
- **Descriptive User-Agent.** Send a header that names the app and gives a
  contact, in the form `ReadFocus/2.0 (<project URL or contact>)`. Never send
  the default client string.
- **Timeout and graceful failure.** Set a short timeout. If the API is down
  or slow, return an empty result; reading must never block on a lookup.
- **No keys, no payment.** If an API starts requiring either, stop using it
  and tell the user.

## Memory rule

Render Free has very little RAM and CPU. Before adding any model or
dependency, measure resident memory (RSS) with `psutil` before and after, and
record both in `docs/BENCHMARKS.md`.

```python
import os
import psutil

proc = psutil.Process(os.getpid())
before = proc.memory_info().rss

# import the dependency / load the model here

after = proc.memory_info().rss
print(f"before {before / 1e6:.0f} MB, after {after / 1e6:.0f} MB, "
      f"delta {(after - before) / 1e6:.0f} MB")
```

- Run it in a fresh process so nothing else is loaded.
- Also measure the whole backend after startup with the change in place.
- Add a row to `docs/BENCHMARKS.md`:
  `Date | Subchunk | What was added | RSS before | RSS after | Delta | Backend RSS after startup`.
- Put the numbers in the commit's `How verified`.
- If the total approaches the instance limit, stop and ask before committing.
  Check Render's current free-tier limit rather than assuming it.
- Load models once, at startup or lazily on first use, never per request.

## Agent module pattern

Each of the five agents (orchestrator, planner, test generator, evaluator,
optimizer) is a plain Python module with four parts:

1. **Pydantic input and output models.** Typed and validated.
2. **A pure `decide(...)` function.** It takes the input model and returns
   the output model. No I/O: no database, network, files, clock or
   randomness. Anything it needs is passed in. Same input, same output.
3. **Policy constants in one `policy.py`.** Every threshold, weight and limit
   for every agent lives in a single `backend/agents/policy.py`. No magic
   numbers inside `decide`.
4. **Unit tests.** Because `decide` is pure, its tests need no mocks, no
   database and no network. Cover the boundaries of every threshold.

```python
from pydantic import BaseModel

from backend.agents import policy


class OptimizerInput(BaseModel):
    recent_scores: list[float]
    current_chunks: int


class OptimizerOutput(BaseModel):
    next_chunks: int
    reason: str


def decide(data: OptimizerInput) -> OptimizerOutput:
    if not data.recent_scores:
        return OptimizerOutput(next_chunks=data.current_chunks, reason="no history")
    average = sum(data.recent_scores) / len(data.recent_scores)
    if average >= policy.GROW_SCORE:
        return OptimizerOutput(next_chunks=data.current_chunks + 1, reason="scores high")
    if average < policy.SHRINK_SCORE:
        return OptimizerOutput(next_chunks=max(1, data.current_chunks - 1), reason="scores low")
    return OptimizerOutput(next_chunks=data.current_chunks, reason="scores steady")
```

The names and thresholds above are illustrative. `backend/agents/policy.py`
does not exist yet; the chunk that rewrites the first agent creates it.

## LangGraph node pattern

A node is a thin wrapper around `decide`. It has the shape
`node(state) -> partial_state` and does exactly four things:

1. Build the input model from `state` (and from the database if needed).
2. Call `decide`.
3. Persist the result.
4. Return only the keys it changed, including one new entry appended to
   `decisions`.

```python
def optimizer_node(state: AgentState) -> dict:
    data = OptimizerInput(
        recent_scores=load_recent_scores(state["user_id"], state["book_id"]),
        current_chunks=len(state["chunk_indices"]),
    )
    result = decide(data)
    save_pace(state["user_id"], state["book_id"], result)
    return {
        "pace_recommendation": result.model_dump(),
        "decisions": [*state.get("decisions", []), {
            "agent": "optimizer",
            "input": data.model_dump(),
            "output": result.model_dump(),
        }],
    }
```

- All I/O lives in the node or in `backend/services/`, never in `decide`.
- The `decisions` list is the audit trail: every node appends what it was
  given and what it decided, so any outcome can be explained and replayed.
  `AgentState` gains the `decisions` key when the first agent is rewritten.
- **Nodes never call LLMs or LangChain chat models.** No `ChatGroq`, no
  `ChatOpenAI`, no `.invoke()` on a chat model, no prompt templates, no
  output parsers.

## Checklist before committing

- [ ] No banned provider, SDK, key or endpoint added; the grep list did not
  grow. Gemini appears only in `backend/steve/`, and that change also
  follows `steve-guardrails`.
- [ ] Agents, grading, questions and scores call neither Gemini nor Steve.
- [ ] New libraries are on the approved list, or approved by the user.
- [ ] External calls go through the backend, are cached, send the
  User-Agent, have a timeout, and fail gracefully.
- [ ] RSS measured before and after; row added to `docs/BENCHMARKS.md`.
- [ ] Agent logic is a pure `decide` with Pydantic models and unit tests;
  constants are in `policy.py`.
- [ ] The node is a thin wrapper that appends to `decisions` and calls no
  LLM.
