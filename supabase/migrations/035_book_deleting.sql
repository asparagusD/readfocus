-- 035: a book being deleted (C35.2, GitHub issue 18).
-- DELETE /books/{id} now marks the book 'deleting' and answers at once; the file, note pictures and
-- rows are purged in the background (backend/services/book_purge.py), and no listing or lookup
-- shows a 'deleting' book. Migration 001 declared books.status with CHECK (processing, ready,
-- error), so the check is replaced, in one statement, by the same list plus 'deleting'.
--
-- Your decision at C35.2b (2026-11-19, "Widen the check (035)"). No table, column or row is dropped
-- or changed; every existing status stays valid.

ALTER TABLE public.books
    DROP CONSTRAINT IF EXISTS books_status_check,
    ADD CONSTRAINT books_status_check CHECK (status IN ('processing', 'ready', 'error', 'deleting'));
