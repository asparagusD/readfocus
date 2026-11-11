/**
 * The reader's blocks from /sessions/start chunks (C12.3b). Chunks stored
 * before C12.1 and not yet backfilled have no blocks; their text becomes
 * paragraphs here, with the same "<chunk>.<n>" ids, so places still work.
 */
export function blocksForChunks(chunks) {
  return [...(chunks ?? [])]
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .flatMap((chunk) => {
      if (chunk.blocks?.length) return chunk.blocks;
      return (chunk.content ?? '')
        .split(/\n\s*\n/)
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((text, n) => ({ id: `${chunk.chunk_index}.${n}`, type: 'paragraph', text, marks: [] }));
    });
}

/** The saved place as a reader anchor when it is in today's chunks, else null (start at today's first page). */
export function placeInChunks(position, chunks) {
  if (!position || !chunks?.some((c) => c.chunk_index === position.chunk_index)) return null;
  return { block_id: position.block_id, char_offset: position.char_offset };
}
