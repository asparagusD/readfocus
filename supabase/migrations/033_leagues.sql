-- 033: weekly leagues (C24.3, docs/GAMIFICATION.md G10-G14).
-- Additive: three new tables, their indexes and row-level security; no
-- existing table changes.
--
-- league_weeks    one row per league week, Monday 00:00 UTC to the next
--                 (G11). grouped_at is set once by the rollover that formed
--                 the week's groups (a second rollover sees it and forms
--                 none); status goes open -> closed when the week's ranks and
--                 outcomes are written.
-- league_groups   one group of about 30 readers of one tier in a week (G12).
-- league_members  a reader in a week's group: their tier that week, when they
--                 joined the game (first XP; groups are filled in that
--                 order), weekly_xp and xp_reached_at (when they reached it:
--                 the earlier wins a tie, G13), and at rollover final_rank
--                 and outcome (promoted, stayed, demoted). A reader's tier is
--                 their last membership's tier moved by its outcome;
--                 Pamphlet for a new reader (G10). Opted-out readers are
--                 members too and are hidden from others by the backend
--                 (G14 as changed in C24.3).
--
-- Readers read their own memberships; weeks and groups, and everyone else's
-- standings, go only through the backend (service role), which shows display
-- name and XP alone (G3).

CREATE TABLE IF NOT EXISTS public.league_weeks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    starts_at timestamptz NOT NULL UNIQUE,
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    grouped_at timestamptz,
    closed_at timestamptz,
    CONSTRAINT league_weeks_order CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.league_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week_id uuid NOT NULL REFERENCES public.league_weeks(id) ON DELETE CASCADE,
    tier text NOT NULL CHECK (tier IN ('Pamphlet', 'Paperback', 'Hardcover', 'Folio', 'First Edition', 'Illuminated')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.league_members (
    week_id uuid NOT NULL REFERENCES public.league_weeks(id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES public.league_groups(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    tier text NOT NULL CHECK (tier IN ('Pamphlet', 'Paperback', 'Hardcover', 'Folio', 'First Edition', 'Illuminated')),
    joined_at timestamptz NOT NULL,
    weekly_xp integer NOT NULL DEFAULT 0 CHECK (weekly_xp >= 0),
    xp_reached_at timestamptz,
    final_rank integer CHECK (final_rank >= 1),
    outcome text CHECK (outcome IS NULL OR outcome IN ('promoted', 'stayed', 'demoted')),
    PRIMARY KEY (week_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_groups_week ON public.league_groups (week_id, tier);
CREATE INDEX IF NOT EXISTS idx_league_members_group ON public.league_members (group_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user ON public.league_members (user_id, week_id);

ALTER TABLE public.league_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own league memberships" ON public.league_members
    FOR SELECT USING (auth.uid() = user_id);
