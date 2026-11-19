/**
 * A drawing in the notepad's list (C22.3): its PNG thumbnail (Lamplight inverts it like Excalidraw's dark mode), or
 * a line. Since C37.2 a drawing is a notebook page: a click or Enter opens the notebook at it.
 */
export function DrawingThumb({ note, reference, onOpen }) {
  const url = note.urls?.[note.thumbnail_path];
  const drawn = (note.content?.elements ?? []).length > 0;
  return (
    <div className="rf-note-read rf-note-drawing" role="button" tabIndex={0} aria-label={`Open notebook page at ${reference}`}
      onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
      {url ? (
        <img className="rf-note-thumb" src={url} alt={`Notebook page at ${reference}`} width={480} height={270} loading="lazy" decoding="async" />
      ) : (
        <p className="rf-note-empty">{drawn ? 'A notebook page (its picture appears when you leave it)' : 'An empty notebook page'}</p>
      )}
    </div>
  );
}
