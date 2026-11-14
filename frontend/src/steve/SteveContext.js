import { createContext, useContext } from 'react';

/**
 * Asking Steve from anywhere in the reading page (C20.7b): `askAbout({question, mode, anchor, regionId,
 * imagePngB64, label})` opens the panel and asks. The block actions (C20.8) and highlights (C21) use it.
 * Null outside the reading page, so callers can hide their "Ask Steve" entry points.
 */
export const SteveContext = createContext(null);

export const useSteveActions = () => useContext(SteveContext);
