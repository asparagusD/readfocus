-- 015: shared cache of word and phrase lookups (C12.6).
-- Additive: one new table. It holds no personal data: a row is what the
-- Free Dictionary API or Wikipedia said about a term, shared by all readers.
--
-- term        the normalised term: lower case, or the original casing for a
--             proper noun or name looked up on Wikipedia first
-- lang        language code; only 'en' for now
-- kind        'definition', 'summary', 'ambiguous' or 'none'
-- payload     the compact answer the API returns (backend/services/lookup.py)
-- source      'dictionary', 'wikipedia' or null when nothing was found
-- found       false for a "not found" answer, kept 7 days instead of 90
-- fetched_at  when the answer was fetched; the backend checks its age
--
-- Signed-in users may read; there is no write policy, so only the backend's
-- service role (which bypasses RLS) writes. Failed lookups are never stored.

CREATE TABLE IF NOT EXISTS public.term_lookups (
    term text NOT NULL,
    lang text NOT NULL DEFAULT 'en',
    kind text NOT NULL,
    payload jsonb NOT NULL,
    source text,
    found boolean NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (term, lang)
);

ALTER TABLE public.term_lookups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'term_lookups' AND policyname = 'term_lookups_read_signed_in'
    ) THEN
        CREATE POLICY term_lookups_read_signed_in ON public.term_lookups
            FOR SELECT TO authenticated USING (true);
    END IF;
END
$$;
