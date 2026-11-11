// Selectors for the animatable parts of the illustrations, for Motion:
//   const scope = useRef(null);
//   animate(scope.current.querySelectorAll(PARTS.steam), { opacity: [0, 1] });
// Data attributes rather than ids, so two copies of one picture on a page
// stay valid HTML.
export const PARTS = {
  glow: '[data-part="glow"]', // ReadingLamp: glow disc
  cone: '[data-part="cone"]', // ReadingLamp: light cone
  bulb: '[data-part="bulb"]', // ReadingLamp: lit band under the shade
  steam: '[data-part="steam"] path', // TeaCup: three wisps, data-steam 1-3
  sun: '[data-part="sun"]', // DuskWindow
  hill: '[data-part="hill"]', // DuskWindow
  ribbon: '[data-part="ribbon"]', // OpenBook: bookmark ribbon
  stars: '[data-part="stars"] circle', // CrescentMoon
  flame: '[data-part="flame"]', // Candle (its glow is [data-part="glow"], as the lamp's)
};
