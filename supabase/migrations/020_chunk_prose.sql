-- 020: prose-only text for the agents, per chunk (C18.6b, docs/ANCHORS.md A6).
-- Additive: three nullable columns on chunks; chunks.content, chunks.blocks
-- and chunks.block_paths are unchanged, and row-level security is as before.
--
-- prose              the chunk's content with every math, code, figure and
--                    table region replaced by one placeholder ("[Equation
--                    3.2, p. 45]", "[Code listing, p. 46]", "[Figure 3.4:
--                    <caption or alt>, p. 47]"; "sec. N" in an EPUB), from
--                    backend/regions/prose.py. Question generation, grading
--                    and Steve read it when set, else content. Null until the
--                    book's regions job has run.
-- anchors            the chunk's place: PDF {kind, pages, spans: [{page,
--                    char_start, char_end}], placeholders}; EPUB {kind, start,
--                    end: {spine_index, cfi, location}, placeholders}.
-- garbled_sentences  sentences of prose the garble detector flags; they are
--                    left out of questions and grading evidence.

ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS prose text;
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS anchors jsonb;
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS garbled_sentences integer CHECK (garbled_sentences >= 0);
