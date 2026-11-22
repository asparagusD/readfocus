// Motion presets (C10.4). Durations and easings are read from the CSS
// tokens in src/styles/tokens.css (D3) when an animation starts, through
// getters, so the stylesheet stays the single source. Only transform and
// opacity move; under reduced motion MotionRoot drops the transforms.

const FALLBACK = {
  '--dur-1': '150ms', '--dur-2': '200ms', '--dur-3': '250ms',
  '--dur-4': '400ms', '--dur-5': '600ms', '--dur-6': '800ms',
  '--dur-rack': '450ms', '--stagger': '60ms',
  '--ease-settle': 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  '--ease-arrive': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--ease-breathe': 'cubic-bezier(0.45, 0, 0.55, 1)',
};

function cssToken(name) {
  const value = typeof document === 'undefined'
    ? ''
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || FALLBACK[name];
}

/** A duration token in seconds, e.g. seconds('--dur-3') -> 0.25. */
export function seconds(name) {
  const value = cssToken(name);
  return value.endsWith('ms') ? parseFloat(value) / 1000 : parseFloat(value);
}

/** An easing token as Motion's cubic-bezier array. */
export function easing(name) {
  return cssToken(name).match(/-?[\d.]+/g).map(Number);
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const timing = (dur, ease) => ({ duration: seconds(dur), ease: easing(ease) });

/** Plain fade, for anything that should not travel. */
export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, get transition() { return timing('--dur-3', '--ease-settle'); } },
  exit: { opacity: 0, get transition() { return timing('--dur-1', '--ease-settle'); } },
};

/** Fade and rise a short way: cards, panels, a page's content. */
export const rise = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, get transition() { return timing('--dur-4', '--ease-arrive'); } },
};

/** Route change: quick rise in, quicker fade out (each 250 ms or less). */
export const routeTransition = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, get transition() { return timing('--dur-3', '--ease-settle'); } },
  exit: { opacity: 0, get transition() { return timing('--dur-1', '--ease-settle'); } },
};

/** A dialog or toast arriving: small rise and settle in 250 ms, fade out in 150 ms. */
export const pop = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, get transition() { return timing('--dur-3', '--ease-settle'); } },
  exit: { opacity: 0, get transition() { return timing('--dur-1', '--ease-settle'); } },
};

/** Route change under reduced motion: opacity only. Without it the
    incoming page shows its `hidden` 8 px offset for one frame. */
export const routeFade = fadeIn;

/** Parent variants that reveal children one after another (60 ms apart). */
export function stagger(children = seconds('--stagger')) {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: children } },
  };
}

/** Moment 1: a book slides up 28 px, overshoots 3 px and settles. */
export const shelfArrive = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: [0, 1, 1],
    y: [28, -3, 0],
    get transition() { return { ...timing('--dur-5', '--ease-arrive'), times: [0, 0.7, 1] }; },
  },
};

/** Moment 2, opening: the reader swings in from a slight 10 degree turn at the spine. */
export const bookOpen = {
  hidden: { opacity: 0, rotateY: -10, transformPerspective: 1200, originX: 0 },
  visible: { opacity: 1, rotateY: 0, get transition() { return timing('--dur-5', '--ease-settle'); } },
};

/**
 * Moment 2, each later page (C12.4): a leaf hinged at the spine turns over.
 * `custom` is the direction: 1 turns a right-hand leaf to the left (forward),
 * -1 a left-hand leaf to the right (back); `from` starts it already over,
 * for a page arriving on a single-page layout.
 */
export const pageTurn = {
  flat: (dir) => ({ rotateY: dir.from ? dir.from : 0 }),
  turned: (dir) => ({ rotateY: dir.to, get transition() { return timing('--dur-5', '--ease-settle'); } }),
};

/** The shadow travelling with a turning leaf: darkest halfway over, gone when it lands. */
export const turnShade = {
  flat: { opacity: 0 },
  turned: { opacity: [0, 0.6, 0], get transition() { return timing('--dur-5', '--ease-settle'); } },
};

/** Moment 5: a concept chip pops in; use inside stagger(). */
export const chipPop = {
  hidden: { opacity: 0, y: 4, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, get transition() { return timing('--dur-4', '--ease-arrive'); } },
};

/** Moment 6: a chart line or SVG path draws itself (instant under reduced motion). */
export const drawIn = {
  hidden: { pathLength: 0 },
  visible: {
    pathLength: 1,
    get transition() {
      return prefersReducedMotion() ? { duration: 0 } : timing('--dur-6', '--ease-settle');
    },
  },
};

/**
 * C37.7 (issue 26): the notebook's rack focus. The book recedes (scale 0.97, blur 8 px, a light dim) while the
 * notebook slides in on a spring of --dur-rack; both are interruptible (a close midway reverses from where it is).
 * Under reduced motion the notebook crossfades and the book blurs and dims in place: no transform. Opacity and
 * the blur glide without overshoot; at rest the book has no filter (`transitionEnd`: Motion would leave blur(0px)),
 * so nothing fixed inside it is re-parented.
 */
const spring = () => ({ type: 'spring', visualDuration: seconds('--dur-rack'), bounce: 0.12 });
const glide = () => timing('--dur-rack', '--ease-settle');

export const bookRecede = {
  sharp: { scale: 1, opacity: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' },
    get transition() { return { default: glide(), scale: { ...spring(), bounce: 0 } }; } },
  receded: { scale: 0.97, opacity: 0.82, filter: 'blur(8px)',
    get transition() { return { default: glide(), scale: { ...spring(), bounce: 0 } }; } },
  blurred: { scale: 1, opacity: 0.82, filter: 'blur(8px)', get transition() { return glide(); } },
};

export const notebookSlide = {
  away: { x: '12%', opacity: 0, get transition() { return { default: spring(), opacity: glide() }; } },
  here: { x: 0, opacity: 1, get transition() { return { default: spring(), opacity: glide() }; } },
};

export const notebookFade = {
  away: { x: 0, opacity: 0, get transition() { return glide(); } },
  here: { x: 0, opacity: 1, get transition() { return glide(); } },
};
