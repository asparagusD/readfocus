-- 031: the XP ledger and each reader's progress (C24.1, docs/GAMIFICATION.md G2, G4-G9).
-- Additive: two new tables, an index, row-level security and a trigger that keeps
-- xp_events append-only; no existing table changes.
--
-- xp_events      one row per thing that earned XP. source: focus (a scored
--                focus session that passed its quiz, source_id its id), badge
--                and adjustment (reserved: nothing writes them in C24.1;
--                GAMIFICATION G4 says only focus earns XP). UNIQUE (source,
--                source_id) makes every award idempotent: a retried grade
--                writes nothing. earned_at is when the XP was earned (the
--                focus session's end, G4); local_day is that moment's calendar
--                day in the reader's time zone at award time (G6). Only an
--                adjustment may be negative.
-- user_progress  one row per reader: total_xp (the ledger's sum), the daily
--                goal in XP (G5), the IANA time zone (G6), the stored streak
--                (streak_days, streak_freezes held, last_goal_day: the last
--                day the goal was met), which moves only on a goal day; the
--                days since are worked out on read (G7-G8). display_name and
--                leaderboard_opt_out are for the leaderboards (G3, G14).
--
-- Readers read their own rows; only the backend (service role) writes. An
-- UPDATE of a ledger row raises, even for the service role; rows go only
-- when their reader is deleted (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS public.xp_events (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source IN ('focus', 'badge', 'adjustment')),
    source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 200),
    amount integer NOT NULL CHECK (amount > 0 OR (source = 'adjustment' AND amount <> 0)),
    earned_at timestamptz NOT NULL,
    local_day date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user_day ON public.xp_events (user_id, local_day);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own XP" ON public.xp_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.xp_events_append_only() RETURNS trigger
    LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'xp_events is append-only';
END;
$$;

CREATE OR REPLACE TRIGGER xp_events_no_update BEFORE UPDATE ON public.xp_events
    FOR EACH ROW EXECUTE FUNCTION public.xp_events_append_only();

CREATE TABLE IF NOT EXISTS public.user_progress (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    total_xp integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
    daily_goal integer NOT NULL DEFAULT 50 CHECK (daily_goal BETWEEN 10 AND 500),
    timezone text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 64),
    streak_days integer NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
    streak_freezes integer NOT NULL DEFAULT 0 CHECK (streak_freezes BETWEEN 0 AND 2),
    last_goal_day date,
    display_name text CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40),
    leaderboard_opt_out boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own progress" ON public.user_progress
    FOR SELECT USING (auth.uid() = user_id);
