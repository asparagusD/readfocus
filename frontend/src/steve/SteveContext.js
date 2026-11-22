import { createContext, useContext } from 'react';

/**
 * Asking Steve from anywhere in the reading page (C20.7b): `askAbout({question, mode, anchor, regionId,
 * imagePngB64, label})` opens the panel and asks. The block actions (C20.8) and highlights (C21) use it.
 * The provider also gives `enabled` (false once his settings say he is off, C21.4).
 */
export const SteveContext = createContext(null);

/**
 * C40.6 (issue 24): Steve in Copilot's place: what Explain and Summarize ask about a passage (`anchor`, ANCHORS A1).
 * `kind` is 'explain' or 'summarize'.
 */
export const passageRequest = (anchor, kind) => (kind === 'summarize'
  ? { question: 'Summarize this passage.', mode: 'summarize_selection', anchor, label: 'Summarize this passage' }
  : { question: 'Explain this passage.', mode: 'explain_highlight', anchor, label: 'Explain this passage' });

/**
 * Steve's actions, or null outside the reading page and while he is switched off (steve-guardrails S2), so every
 * caller hides its "Ask Steve" and Explain entry points the same way.
 */
export function useSteveActions() {
  const actions = useContext(SteveContext);
  return actions?.enabled === false ? null : actions;
}
