"""Unit tests for the chunk_text function in book_ingestor."""

import re

from backend.services.book_ingestor import chunk_text

# A sample multi-paragraph text (~180 words) used across tests.
SAMPLE_TEXT = (
    "Reading is one of the most fundamental skills a person can develop. "
    "It opens the door to knowledge, imagination, and critical thinking. "
    "From early childhood, exposure to books shapes cognitive development "
    "and language acquisition. Studies consistently show that children who "
    "read regularly perform better academically across all subjects.\n\n"
    "Beyond academics, reading fosters empathy and emotional intelligence. "
    "When we immerse ourselves in a story, we experience the world through "
    "another person's eyes. Fiction, in particular, has been shown to "
    "improve our ability to understand and relate to others. This makes "
    "reading not just an intellectual exercise, but a deeply human one.\n\n"
    "In the digital age, the way we read is changing rapidly. E-readers, "
    "audiobooks, and online articles have expanded access to literature. "
    "However, research suggests that deep reading — the slow, immersive "
    "kind — is declining. Cultivating the habit of focused reading remains "
    "essential for developing sustained attention and analytical thinking."
)


class TestChunkText:
    """Tests for chunk_text with controlled sample input."""

    def test_returns_non_empty_list(self):
        """chunk_text should return at least one chunk."""
        chunks = chunk_text([SAMPLE_TEXT])
        assert isinstance(chunks, list)
        assert len(chunks) > 0

    def test_chunk_count(self):
        """With ~180 words and target=600, all text should fit in one chunk."""
        chunks = chunk_text([SAMPLE_TEXT], target_words=600)
        assert len(chunks) == 1

    def test_chunk_count_small_target(self):
        """With a small target, the text should split into multiple chunks."""
        chunks = chunk_text([SAMPLE_TEXT], target_words=50)
        assert len(chunks) >= 2

    def test_word_count_bounds(self):
        """Each chunk's word count should stay within reasonable bounds."""
        chunks = chunk_text([SAMPLE_TEXT], target_words=50)
        for chunk in chunks:
            wc = len(chunk.split())
            assert wc > 0, "Chunk must not be empty"
            assert wc <= 900, f"Chunk has {wc} words, exceeding the 900-word ceiling"

    def test_no_mid_paragraph_splits(self):
        """Chunks should not split in the middle of a paragraph.

        Each chunk must consist of complete paragraphs — i.e. every
        paragraph boundary (double-newline) present in the original text
        that falls inside a chunk should be intact, and no chunk should
        start or end with a partial sentence fragment from a paragraph
        that continues in the next chunk.
        """
        chunks = chunk_text([SAMPLE_TEXT], target_words=50)

        # Reconstruct original paragraphs for comparison
        full_text = SAMPLE_TEXT
        original_paragraphs = [
            p.strip() for p in re.split(r"\n\s*\n", full_text) if p.strip()
        ]

        # Every original paragraph must appear fully inside exactly one chunk
        for para in original_paragraphs:
            containing = [c for c in chunks if para in c]
            assert len(containing) == 1, (
                f"Paragraph starting with '{para[:50]}...' found in "
                f"{len(containing)} chunks (expected exactly 1)"
            )

    def test_all_content_preserved(self):
        """No words should be lost during chunking."""
        chunks = chunk_text([SAMPLE_TEXT], target_words=50)
        reassembled = " ".join(chunks)
        original_words = set(SAMPLE_TEXT.split())
        reassembled_words = set(reassembled.split())
        missing = original_words - reassembled_words
        assert not missing, f"Words lost during chunking: {missing}"
