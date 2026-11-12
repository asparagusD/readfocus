-- 009: agent_decisions, the audit trail of every agent workflow run.
-- One row per node a run visited, in order: which agent, a summary of what
-- it was given and what it decided, its one-line reason and how long it
-- took. The backend writes them after each run so the app can explain its
-- choices ("Revisiting opportunity cost: you missed it twice").
-- Additive: one new table, its indexes and its policy. No existing table,
-- column, index or function is changed.

CREATE TABLE IF NOT EXISTS public.agent_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
    run_id uuid NOT NULL,
    event text NOT NULL CHECK (event IN ('start_session', 'finish_reading', 'submit_answers', 'abandon')),
    step integer NOT NULL CHECK (step >= 1),
    agent text NOT NULL,
    inputs_summary jsonb NOT NULL DEFAULT '{}',
    output_summary jsonb NOT NULL DEFAULT '{}',
    reason text NOT NULL DEFAULT '',
    duration_ms real,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, step)
);

-- session_id     the session the run belongs to; null only if none was made
-- run_id         one workflow run (one event); its rows share it
-- event          which flow ran, as routed in backend/agents/graph.py
-- step           the node's place in the run, from 1
-- agent          planner, test_generator, evaluator, knowledge_state, optimizer
-- inputs_summary, output_summary, reason, duration_ms
--                the node's decisions entry (backend/agents/state.py)

-- What the agents decided for one session, and for one reader and book.
CREATE INDEX IF NOT EXISTS idx_agent_decisions_session
    ON public.agent_decisions (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_user_book
    ON public.agent_decisions (user_id, book_id, created_at);

-- A signed-in reader can read their own rows and nothing else; only the
-- backend's service role, which bypasses RLS, writes them.
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own agent decisions" ON public.agent_decisions
    FOR SELECT
    USING (auth.uid() = user_id);
