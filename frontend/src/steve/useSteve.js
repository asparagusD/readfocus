import { useCallback, useEffect, useReducer, useRef } from 'react';
import { API_BASE_URL, fetchApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import { askSteve, SteveError } from './sse';
import { initialState, steveReducer } from './steveState';

/**
 * Steve for one book (C20.7b): the panel's state, its settings, and asking. Settings load the first time the
 * panel opens. ask() streams one answer into the conversation; stop() ends it where it stands. Other chunks
 * (C20.8 block actions, C21 highlights) call ask() with a mode and what it explains.
 */
export function useSteve(bookId, open) {
  const [state, dispatch] = useReducer(steveReducer, initialState);
  const controller = useRef(null);
  const thread = useRef(null);
  const last = useRef(null);
  const view = useRef(state.view);
  const queued = useRef(null); // C21.4: a question asked before the settings say Steve may read along
  useEffect(() => { thread.current = state.threadId; view.current = state.view; }, [state.threadId, state.view]);

  const load = useCallback(async () => {
    try {
      dispatch({ type: 'settings', settings: await fetchApi('/steve/settings') });
    } catch {
      dispatch({ type: 'settings_failed' });
    }
  }, []);

  useEffect(() => {
    if (open && state.view === 'loading') load();
  }, [open, state.view, load]);

  useEffect(() => () => controller.current?.abort(), []);

  const ask = useCallback(async ({ question, mode = 'ask', anchor, regionId, imagePngB64, label } = {}) => {
    if (!question?.trim() || controller.current) return;
    if (view.current === 'loading' || view.current === 'consent') { // nothing is sent before consent (S2)
      queued.current = { question, mode, anchor, regionId, imagePngB64, label };
      return;
    }
    last.current = { question, mode, anchor, regionId, imagePngB64, label };
    dispatch({ type: 'ask', question: question.trim(), label });
    const abort = new AbortController();
    controller.current = abort;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await askSteve({
        url: `${API_BASE_URL}/steve/ask`,
        token: session?.access_token,
        signal: abort.signal,
        body: {
          book_id: bookId, question: question.trim(), mode, thread_id: thread.current ?? undefined,
          anchor: anchor ?? undefined, region_id: regionId ?? undefined, image_png_b64: imagePngB64 ?? undefined,
          utc_offset_minutes: -new Date().getTimezoneOffset(),
        },
        onEvent: ({ name, data }) => dispatch(name === 'error' ? { type: 'stream_error', data } : { type: name, data }),
      });
    } catch (error) {
      if (abort.signal.aborted) dispatch({ type: 'stopped' });
      else if (error instanceof SteveError) dispatch({ type: 'failed', error });
      else dispatch({ type: 'failed', error: { code: 'offline', message: 'Steve could not be reached. Check your connection and try again.' } });
    } finally {
      controller.current = null;
    }
  }, [bookId]);

  useEffect(() => { // the queued question goes once the settings are in and consent is given
    if (state.view !== 'chat' || !queued.current) return;
    const next = queued.current;
    queued.current = null;
    ask(next);
  }, [state.view, ask]);

  const stop = useCallback(() => controller.current?.abort(), []);
  const retry = useCallback(() => last.current && ask(last.current), [ask]);

  const accept = useCallback(async () => {
    await fetchApi('/steve/settings', { method: 'PUT', body: JSON.stringify({ consent: true, consent_version: state.notice?.version }) });
    dispatch({ type: 'consented' });
  }, [state.notice]);

  const setEnabled = useCallback(async (on) => {
    await fetchApi('/steve/settings', { method: 'PUT', body: JSON.stringify({ enabled: on }) });
    dispatch({ type: 'enabled', on });
  }, []);

  return { state, dispatch, ask, stop, retry, accept, setEnabled, reload: load };
}
