-- 030: how many events the focus API ignored for a session (C23.4,
-- docs/FOCUS_RULES.md F3): resends and events over the rate limit are not
-- stored, only counted here. Additive: one column with a default; nothing
-- else changes.

ALTER TABLE public.focus_sessions ADD COLUMN IF NOT EXISTS ignored_events integer NOT NULL DEFAULT 0
    CHECK (ignored_events >= 0);
