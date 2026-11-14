/**
 * Autosave for note blocks (C22.2; PATCH /notes/{id} with If-Match, C22.1). Edits to a note are merged and sent
 * `delay` ms after the last one, one save at a time per note, each on the version the last save returned. A save
 * that cannot reach the server (no status, or 5xx) goes to the offline queue and is sent again by `retry()`; a 409
 * means another tab saved first, and nothing more is sent for that note until the reader picks `keepMine` or
 * `takeTheirs`; any other refusal is an error and is kept on screen, not queued. `onChange(id, status)` reports
 * { status: 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'error', serverVersion? }.
 */
export function createAutosave({ save, queue, delay = 800, schedule = setTimeout, cancel = clearTimeout, onChange = () => {} }) {
  const notes = new Map();

  const entry = (id) => {
    if (!notes.has(id)) notes.set(id, { version: null, change: null, timer: null, busy: false, again: false, status: 'saved', serverVersion: undefined });
    return notes.get(id);
  };
  const report = (id, e) => onChange(id, status(id, e));
  const set = (id, e, next, serverVersion) => { e.status = next; e.serverVersion = serverVersion; report(id, e); };
  const status = (id, e = notes.get(id)) => (e ? (e.serverVersion === undefined ? { status: e.status } : { status: e.status, serverVersion: e.serverVersion }) : { status: 'saved' });

  async function send(id) {
    const e = entry(id);
    if (e.timer) { cancel(e.timer); e.timer = null; }
    if (!e.change || e.status === 'conflict') return;
    if (e.busy) { e.again = true; return; }
    const change = e.change;
    e.change = null;
    e.busy = true;
    set(id, e, 'saving');
    try {
      const row = await save(id, change, e.version);
      e.version = row?.version ?? e.version + 1;
      await queue.drop(id);
      set(id, e, e.change ? 'unsaved' : 'saved');
    } catch (error) {
      e.change = { ...change, ...(e.change ?? {}) };
      if (error?.status === 409) {
        set(id, e, 'conflict', error.detail?.version);
      } else if (!error?.status || error.status >= 500) {
        await queue.put({ id, change: e.change, version: e.version });
        set(id, e, 'offline');
      } else {
        set(id, e, 'error');
      }
    } finally {
      e.busy = false;
    }
    if (e.change && (e.again || e.status === 'unsaved')) { e.again = false; await send(id); }
  }

  return {
    status: (id) => status(id),
    /** A note's version as loaded or created, before any edit. */
    track(id, version) { const e = entry(id); if (e.version === null || version > e.version) e.version = version; },
    edit(id, change) {
      const e = entry(id);
      e.change = { ...(e.change ?? {}), ...change };
      if (e.status === 'conflict') { report(id, e); return; }
      if (e.timer) cancel(e.timer);
      e.timer = schedule(() => { e.timer = null; send(id); }, delay);
      if (!e.busy) set(id, e, 'unsaved');
    },
    flush: (id) => send(id),
    flushAll: () => Promise.all([...notes.keys()].filter((id) => notes.get(id).change).map(send)),
    /** Sends every queued change again: on load, and when the browser is back online. */
    async retry() {
      for (const queued of await queue.all()) {
        const e = entry(queued.id);
        if (!e.change) { // a change from an earlier visit goes on the version it was made on, so a newer save is a conflict
          e.change = queued.change;
          e.version = queued.version;
        }
        if (e.status === 'offline' || e.status === 'saved') e.status = 'unsaved';
      }
      await Promise.all([...notes.keys()].filter((id) => notes.get(id).change && notes.get(id).status !== 'conflict').map(send));
    },
    /** Conflict: save this tab's content over the other one. */
    keepMine(id) {
      const e = entry(id);
      if (e.status !== 'conflict') return Promise.resolve();
      e.version = e.serverVersion;
      e.status = 'unsaved';
      e.serverVersion = undefined;
      return send(id);
    },
    /** Conflict: drop this tab's change; the caller shows the saved note at `version`. */
    async takeTheirs(id, version) {
      const e = entry(id);
      e.change = null;
      e.version = version;
      await queue.drop(id);
      set(id, e, 'saved');
    },
    pending: () => [...notes.keys()].filter((id) => notes.get(id).change),
    forget(id) { const e = notes.get(id); if (e?.timer) cancel(e.timer); notes.delete(id); },
  };
}
