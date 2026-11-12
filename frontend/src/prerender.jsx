// Build-time render of the public landing page (C13.10e). scripts/prerender.mjs puts this
// HTML into dist/index.html, so a signed-out visitor sees the headline before any script runs
// (it is the page's LCP). The app then renders over it with createRoot, as before.
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { ThemeContext } from './theme/themeContext';
import { Landing } from './pages/Landing';

// The colours come from <html data-theme>, set by index.html's inline script; the markup only
// needs a theme for the toggle, which starts on "Match system" until the app takes over.
const THEME = { choice: 'system', theme: 'paper', accent: 'terracotta', setChoice() {}, setAccent() {} };

export function render() {
  return renderToString(
    <ThemeContext.Provider value={THEME}>
      <StaticRouter location="/">
        <Landing />
      </StaticRouter>
    </ThemeContext.Provider>,
  );
}
