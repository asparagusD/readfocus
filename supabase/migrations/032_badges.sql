-- 032: the badges each reader holds (C24.2, docs/GAMIFICATION.md Badges).
-- Additive: one new table and its row-level security; no existing table changes.
--
-- user_badges  one row per badge a reader holds; badge_id names an entry of
--              the catalogue in backend/xp/badges.py (not checked here, so a
--              new badge needs no migration). The primary key makes each
--              award happen once (G2): a second insert is refused, and the
--              badge's XP row (xp_events, source 'badge', source_id
--              '<user_id>:<badge_id>') is only written after the first.
--
-- Readers read their own rows; only the backend (service role) writes.

CREATE TABLE IF NOT EXISTS public.user_badges (
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    badge_id text NOT NULL CHECK (char_length(badge_id) BETWEEN 1 AND 64),
    awarded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Readers read their own badges" ON public.user_badges
    FOR SELECT USING (auth.uid() = user_id);
