import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, KeyRound } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/TextInput';
import { AI_STUDIO_KEYS_URL, canSend, cleanKey, saveError, savedKeyLabel } from './ownKey';
import './OwnKeyForm.css';

/**
 * "Use your own free Gemini key" (C20.3, handoff screen 17): a disclosure that opens a password field,
 * a link to Google AI Studio and Save key, which the server checks with Google before it encrypts and
 * stores the key. Once saved, only the last four characters are ever shown, with Remove key. The key
 * is held in this component only until it is sent. Used in the account panel and, open from the start
 * (`defaultOpen`), in Steve's panel (C20.7b).
 */
export function OwnKeyForm({ defaultOpen = false }) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState(null); // {has_key, last4} from the server
  const [loadError, setLoadError] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || status) return undefined;
    let live = true;
    fetchApi('/steve/key')
      .then((s) => live && setStatus(s))
      .catch(() => live && setLoadError('Your key settings could not be loaded. Try again in a minute.'));
    return () => { live = false; };
  }, [open, status]);

  const save = async (event) => {
    event.preventDefault();
    if (!canSend(value)) {
      setError('Paste the whole key from Google AI Studio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = await fetchApi('/steve/key', { method: 'PUT', body: JSON.stringify({ key: cleanKey(value) }) });
      setStatus(saved);
    } catch (e) {
      setError(saveError(e));
    } finally {
      setValue(''); // the key is never kept after it is sent, saved or not
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      setStatus(await fetchApi('/steve/key', { method: 'DELETE' }));
    } catch (e) {
      setError(saveError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rf-ownkey">
      <button
        type="button"
        className="rf-ownkey__toggle"
        aria-expanded={open}
        aria-controls={open ? `${id}-body` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <KeyRound size={18} strokeWidth={1.75} aria-hidden="true" />
        <span>Use your own free Gemini key</span>
      </button>
      {open && (
        <div id={`${id}-body`} className="rf-ownkey__body">
          <p className="rf-ownkey__why">
            Steve then uses your own daily quota, not the shared one. The key is encrypted and never shown again.
          </p>
          {!status && !loadError && <p className="rf-ownkey__note" role="status">Loading…</p>}
          {loadError && <p className="rf-ownkey__note" role="alert">{loadError}</p>}
          {status?.has_key && (
            <div className="rf-ownkey__saved">
              <p className="rf-ownkey__note" role="status">{savedKeyLabel(status.last4)}</p>
              <Button variant="secondary" onClick={remove} loading={busy} loadingLabel="Removing…">Remove key</Button>
              {error && <p className="rf-ownkey__note" role="alert">{error}</p>}
            </div>
          )}
          {status && !status.has_key && (
            <form className="rf-ownkey__form" onSubmit={save} noValidate>
              <TextInput
                label="Gemini API key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your key"
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(''); }}
                error={error}
              />
              <a className="rf-ownkey__link" href={AI_STUDIO_KEYS_URL} target="_blank" rel="noopener noreferrer">
                <span>Get a free key in Google AI Studio</span>
                <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                <span className="rf-ownkey__hidden">(opens in a new tab)</span>
              </a>
              <Button type="submit" loading={busy} loadingLabel="Checking with Google…">Save key</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
