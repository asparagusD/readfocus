-- 029: focus sessions and their events (C23.2, docs/FOCUS_RULES.md).
-- Additive: two new tables, their indexes, row-level security and a trigger
-- that keeps focus_events append-only; no existing table changes.
--
-- focus_sessions   one focus session: from its start place to the bookmark
--                  (end_anchor). active_seconds, voided_seconds and the
--                  points are written only by the backend, from the events
--                  (F14); rules_version is the FOCUS_RULES version it is
--                  scored under. status: active, paused (focus turned off,
--                  F1), awaiting_quiz (bookmark placed or 3-hour cap, F8-F9),
--                  scored, abandoned. One open (active or paused) session per
--                  reader.
-- focus_events     what the reader's tab reported, timestamped by the server
--                  on arrival (server_ts); client_ts is kept for diagnosis
--                  only and never scored (F3). client_event_id makes a
--                  resent event a duplicate (F3); had_input says whether the
--                  reader scrolled, typed or pointed since the last event
--                  (F6). page_key names the page shown ("p12", or an EPUB
--                  section and screen); position is its A4 position
--                  (docs/ANCHORS.md).
--
-- Readers read their own rows; only the backend (service role) writes. An
-- UPDATE of an event raises, even for the service role; events go only when
-- their session, book or reader is deleted (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS public.focus_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'awaiting_quiz', 'scored', 'abandoned')),
    start_anchor jsonb NOT NULL CHECK (jsonb_typeof(start_anchor) = 'object'),
    start_position float8 NOT NULL CHECK (start_position >= 0),
    end_anchor jsonb CHECK (end_anchor IS NULL OR jsonb_typeof(end_anchor) = 'object'),
    end_position float8 CHECK (end_position >= 0),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
    voided_seconds integer NOT NULL DEFAULT 0 CHECK (voided_seconds >= 0),
    words_in_range integer CHECK (words_in_range >= 0),
    quiz_question_ids uuid[],
    quiz_correct integer CHECK (quiz_correct >= 0),
    quiz_total integer CHECK (quiz_total >= 0),
    points_time integer NOT NULL DEFAULT 0 CHECK (points_time >= 0),
    points_bonus integer NOT NULL DEFAULT 0 CHECK (points_bonus >= 0),
    points_total integer NOT NULL DEFAULT 0 CHECK (points_total >= 0),
    rules_version text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT focus_sessions_quiz_counts CHECK (quiz_correct IS NULL OR quiz_correct <= quiz_total)
);

CREATE UNIQUE INDEX IF NOT EXISTS focus_sessions_one_open
    ON public.focus_sessions (user_id) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_book
    ON public.focus_sessions (user_id, book_id, started_at DESC);

ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own focus sessions" ON public.focus_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.focus_events (
    id bigserial PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES public.focus_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('start', 'heartbeat', 'page_turn', 'hidden', 'visible', 'idle_prompt',
                                       'idle_confirm', 'pause', 'resume', 'end')),
    client_event_id uuid,
    page_key text CHECK (char_length(page_key) <= 64),
    position float8 CHECK (position >= 0),
    had_input boolean,
    client_ts timestamptz,
    server_ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_focus_events_session ON public.focus_events (session_id, server_ts, id);
CREATE UNIQUE INDEX IF NOT EXISTS focus_events_client_id
    ON public.focus_events (session_id, client_event_id) WHERE client_event_id IS NOT NULL;

ALTER TABLE public.focus_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own focus events" ON public.focus_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.focus_events_append_only() RETURNS trigger
    LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'focus_events is append-only';
END;
$$;

CREATE OR REPLACE TRIGGER focus_events_no_update BEFORE UPDATE ON public.focus_events
    FOR EACH ROW EXECUTE FUNCTION public.focus_events_append_only();
