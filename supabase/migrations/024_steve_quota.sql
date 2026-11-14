-- 024: Steve's atomic daily quota (C20.2, docs/STEVE.md S6).
-- Additive: two functions over steve_usage (migration 023). No table, column
-- or row is dropped or changed.
--
-- steve_take_quota(user, day, limit)  counts one question for the reader's
--     local day in one statement and returns the new count, or -1 when the
--     day's limit is already reached (nothing counted). Two tabs asking at
--     once cannot both take the last question: the upsert's row lock orders
--     them, and the WHERE clause refuses the second.
-- steve_refund_quota(user, day)       gives one back when Google failed;
--     never below zero.
--
-- Only the backend's service role may call them (a reader could otherwise
-- spend or refund their own quota through the Supabase client).

CREATE OR REPLACE FUNCTION public.steve_take_quota(p_user uuid, p_day date, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    taken integer;
BEGIN
    IF p_limit <= 0 THEN RETURN -1; END IF;
    INSERT INTO public.steve_usage (user_id, day, requests)
    VALUES (p_user, p_day, 1)
    ON CONFLICT (user_id, day) DO UPDATE
        SET requests = public.steve_usage.requests + 1
        WHERE public.steve_usage.requests < p_limit
    RETURNING requests INTO taken;
    RETURN coalesce(taken, -1);
END;
$$;

CREATE OR REPLACE FUNCTION public.steve_refund_quota(p_user uuid, p_day date)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
    UPDATE public.steve_usage SET requests = requests - 1
    WHERE user_id = p_user AND day = p_day AND requests > 0;
$$;

REVOKE ALL ON FUNCTION public.steve_take_quota(uuid, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.steve_refund_quota(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.steve_take_quota(uuid, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.steve_refund_quota(uuid, date) TO service_role;
