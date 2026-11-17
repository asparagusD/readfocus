/**
 * Arrow keys, Home and End along a toolbar's buttons with one tab stop (WAI-ARIA toolbar; C21.2, C21.4).
 * True when the key moved focus.
 */
export function rove(event, container) {
  const buttons = [...container.querySelectorAll('button:not(:disabled)')];
  const at = buttons.indexOf(container.ownerDocument.activeElement);
  const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
  if (to === undefined || !buttons.length) return false;
  event.preventDefault();
  const next = buttons[(to + buttons.length) % buttons.length];
  for (const b of buttons) b.tabIndex = b === next ? 0 : -1;
  next.focus();
  return true;
}
