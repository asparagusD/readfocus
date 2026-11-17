/**
 * The Steve panel's state (C20.7) as a pure reducer, so every state the handoff draws (screens 13-17) is
 * testable without a browser: loading, consent, off, chat (empty or with answers), paused, key (settings)
 * and a failed load.
 */

export const PAUSES = new Set(['paused_quota', 'daily_limit']);

export const initialState = {
  view: 'loading', // loading | load_error | consent | off | chat | paused | key
  back: 'chat', // where "Back" from the key view returns to
  notice: null, // {version, text, terms_url} from GET /steve/settings
  enabled: true,
  messages: [], // {id, role: 'reader' | 'steve', text, status, citations, usage, error, label}
  threadId: null,
  pages: [], // labels the last answer was given
  pause: null, // {code, until}
};

let counter = 0;
const nextId = () => `local-${(counter += 1)}`;

function settled(state, settings) {
  const view = !settings.consent?.current ? 'consent' : settings.enabled === false ? 'off' : 'chat';
  return { ...state, notice: settings.notice, enabled: settings.enabled !== false, view };
}

function updateLast(state, change) {
  const messages = [...state.messages];
  const i = messages.length - 1;
  if (i < 0 || messages[i].role !== 'steve') return state;
  messages[i] = { ...messages[i], ...change(messages[i]) };
  return { ...state, messages };
}

export function steveReducer(state, action) {
  switch (action.type) {
    case 'settings':
      return settled(state, action.settings);
    case 'settings_failed':
      return { ...state, view: 'load_error' };
    case 'ask':
      return {
        ...state,
        view: 'chat',
        pause: null,
        messages: [
          ...state.messages,
          { id: nextId(), role: 'reader', text: action.question, label: action.label ?? null },
          { id: nextId(), role: 'steve', text: '', status: 'waiting', citations: [], usage: null, error: null },
        ],
      };
    case 'start':
      return { ...updateLast(state, () => ({ status: 'streaming' })), threadId: action.data.thread_id,
        pages: action.data.pages ?? [] };
    case 'token':
      return updateLast(state, (m) => ({ text: m.text + action.data.text, status: 'streaming' }));
    case 'done':
      return updateLast(state, () => ({ text: action.data.text, citations: action.data.citations ?? [],
        usage: action.data.usage ?? null, status: 'done', id: action.data.message_id }));
    case 'stream_error':
      return updateLast(state, () => ({ status: 'error', error: action.data }));
    case 'stopped':
      return updateLast(state, (m) => (m.status === 'done' ? {} : { status: 'stopped' }));
    case 'failed': {
      const { code, message, until } = action.error;
      const asked = state.messages.slice(0, -2);
      if (PAUSES.has(code)) return { ...state, view: 'paused', pause: { code, until }, messages: asked };
      if (code === 'no_consent') return { ...state, view: 'consent', messages: asked };
      if (code === 'disabled') return { ...state, view: 'off', enabled: false, messages: asked };
      return updateLast(state, () => ({ status: 'error', error: { code, message } }));
    }
    case 'consented':
      return { ...state, view: 'chat' };
    case 'enabled':
      return { ...state, enabled: action.on, view: action.on ? state.view === 'off' ? 'chat' : state.view : 'off' };
    case 'show_key':
      return { ...state, back: state.view === 'key' ? state.back : state.view, view: 'key' };
    case 'back':
      return { ...state, view: state.enabled ? (state.back === 'key' ? 'chat' : state.back) : 'off' };
    case 'resume':
      return { ...state, view: 'chat', pause: null };
    default:
      return state;
  }
}

/** "until 00:00" for a pause: the reader's own clock, or tomorrow when Google gave no time. */
export function backAt(until, now = new Date()) {
  if (!until) return 'tomorrow';
  const at = new Date(until);
  if (Number.isNaN(at.getTime())) return 'tomorrow';
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? `at ${time}` : at.getTime() - now.getTime() < 36 * 3600 * 1000 ? `tomorrow at ${time}` : 'soon';
}
