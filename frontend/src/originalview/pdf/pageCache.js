// Rendered PDF pages kept around the reader's place (C17.2): the current page
// and `radius` pages either side stay rendered, so turning a page shows a
// finished canvas; every other page is released to free its canvas memory.
// Rendering and releasing are passed in, so this file has no PDF.js or DOM.

/** Pages current-radius..current+radius, clamped to 1..numPages, in page order. */
export function pageWindow(current, numPages, radius = 2) {
  const first = Math.max(1, current - radius);
  const last = Math.min(numPages, current + radius);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/** The window's pages nearest-first: current, +1, -1, +2, -2... */
function nearestFirst(current, pages) {
  return [...pages].sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || b - a);
}

/**
 * render(pageNumber) -> Promise<entry>; release(entry) frees it.
 * focus(current, numPages) renders the window and releases the rest;
 * get(n) returns the entry's promise (rendering it if needed); clear() releases all.
 */
export function createPageCache({ render, release, radius = 2 }) {
  const slots = new Map(); // page -> { promise, entry, dropped }

  function ensure(n) {
    let slot = slots.get(n);
    if (!slot) {
      slot = { entry: null, dropped: false };
      slot.promise = Promise.resolve(render(n)).then((entry) => {
        slot.entry = entry;
        if (slot.dropped) release(entry); // released while it was still rendering
        return entry;
      });
      slot.promise.catch(() => slots.get(n) === slot && slots.delete(n)); // a failed render can be retried
      slots.set(n, slot);
    }
    return slot;
  }

  function drop(n) {
    const slot = slots.get(n);
    if (!slot) return;
    slots.delete(n);
    slot.dropped = true;
    if (slot.entry) release(slot.entry);
  }

  return {
    focus(current, numPages) {
      const keep = pageWindow(current, numPages, radius);
      for (const n of [...slots.keys()]) if (!keep.includes(n)) drop(n);
      for (const n of nearestFirst(current, keep)) ensure(n);
    },
    get: (n) => ensure(n).promise,
    clear() {
      for (const n of [...slots.keys()]) drop(n);
    },
    held: () => [...slots.keys()].sort((a, b) => a - b),
  };
}
