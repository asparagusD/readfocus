-- 023: Steve, the study assistant (C20.1, docs/STEVE.md).
-- Additive: five nullable or defaulted columns on profiles, three new tables
-- with their indexes and read-only own-rows policies, and a guard trigger on
-- profiles. No table, column or row is dropped or changed.
--
-- profiles.steve_enabled          the reader's off switch; off means no call is made
-- profiles.steve_consent_at       when the reader accepted the notice; null = no consent
-- profiles.steve_consent_version  which notice they accepted (backend/steve/consent.py)
-- profiles.steve_key_cipher       the reader's own Gemini key, encrypted with
--                                 KEY_ENCRYPTION_SECRET (C20.3); never returned
-- profiles.steve_key_last4        the key's last four characters, shown to the reader

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steve_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steve_consent_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steve_consent_version text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steve_key_cipher text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS steve_key_last4 text
    CHECK (steve_key_last4 IS NULL OR char_length(steve_key_last4) = 4);

-- profiles has had "Users can CRUD own profile" (FOR ALL) since 001, so a
-- signed-in reader could write these columns straight through the Supabase
-- client. Consent must go through the API (which stores the notice version)
-- and the key cipher only through the backend, so a reader's own role may not
-- set or change them. The backend's service role and the signup trigger
-- (which runs as the table owner) are not affected.
CREATE OR REPLACE FUNCTION public.steve_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            NEW.steve_enabled := true;
            NEW.steve_consent_at := NULL;
            NEW.steve_consent_version := NULL;
            NEW.steve_key_cipher := NULL;
            NEW.steve_key_last4 := NULL;
        ELSIF NEW.steve_enabled IS DISTINCT FROM OLD.steve_enabled
           OR NEW.steve_consent_at IS DISTINCT FROM OLD.steve_consent_at
           OR NEW.steve_consent_version IS DISTINCT FROM OLD.steve_consent_version
           OR NEW.steve_key_cipher IS DISTINCT FROM OLD.steve_key_cipher
           OR NEW.steve_key_last4 IS DISTINCT FROM OLD.steve_key_last4 THEN
            RAISE EXCEPTION 'Steve settings change only through the ReadFocus API';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER steve_profile_guard
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.steve_profile_guard();

-- Questions a reader asked on our key, per day (the reader's local day,
-- docs/STEVE.md S6). Questions on the reader's own key are not counted.
CREATE TABLE IF NOT EXISTS public.steve_usage (
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    day date NOT NULL,
    requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
    PRIMARY KEY (user_id, day)
);

-- A conversation with Steve about one book; deleted with the book.
CREATE TABLE IF NOT EXISTS public.steve_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- role       'reader' (the question) or 'steve' (the answer)
-- content    the question, or the answer's text as streamed
-- anchor     the passage the question was asked about (docs/ANCHORS.md A1), if any
-- citations  [{page} | {section, spine_index}] checked against the context sent
-- model      the Gemini model that answered; tokens_* as Google reported them
CREATE TABLE IF NOT EXISTS public.steve_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES public.steve_threads(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('reader', 'steve')),
    content text NOT NULL,
    anchor jsonb,
    citations jsonb NOT NULL DEFAULT '[]',
    model text,
    tokens_in integer CHECK (tokens_in >= 0),
    tokens_out integer CHECK (tokens_out >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_steve_threads_user_book ON public.steve_threads (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_steve_messages_thread ON public.steve_messages (thread_id, created_at);

-- A signed-in reader can read their own rows; only the backend's service
-- role, which bypasses RLS, writes them (the quota cannot be reset from the
-- browser, and every answer is one the backend produced).
ALTER TABLE public.steve_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.steve_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.steve_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readers read their own Steve usage" ON public.steve_usage
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Readers read their own Steve threads" ON public.steve_threads
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Readers read their own Steve messages" ON public.steve_messages
    FOR SELECT USING (auth.uid() = user_id);
