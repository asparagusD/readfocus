/**
 * Drawing notes, without Excalidraw (C22.3): what of a scene is saved, and the passage as a text element's lines.
 * The server keeps elements, `appState.viewBackgroundColor` and files in the reader's folder (note_content.py);
 * images are off in the editor, so deleted and image elements are dropped and no files are sent.
 */
export function drawingScene(elements) {
  return {
    elements: (elements ?? []).filter((e) => !e.isDeleted && e.type !== 'image').map((e) => JSON.parse(JSON.stringify(e))),
    appState: { viewBackgroundColor: '#ffffff' },
  };
}

/** The passage's words wrapped at about `width` characters a line, or '' when there is no text (whole pages). */
export function passageLines(passage, width = 36) {
  const words = (passage ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && (last + ' ' + word).length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.join('\n');
}

/** A note's passage: its anchors' text, in reading order. */
export const passageOf = (note) => (note.anchors ?? []).map((a) => a.text ?? '').filter(Boolean).join(' ');

/** A PNG blob as base64, for POST /books/{id}/note-files. */
export async function base64Of(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
