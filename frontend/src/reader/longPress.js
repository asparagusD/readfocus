// Touch gestures for in-place lookup (C12.9), as small state machines so node --test covers them.

export const HOLD_MS = 450; // handoff: "Tap and hold (450 ms)"
export const MOVE_PX = 8; // more movement is a scroll, a swipe or a selection drag
export const SWIPE_CLOSE_PX = 56; // the sheet closes when dragged down this far

/**
 * A touch long-press: down() starts the timer, moving past MOVE_PX or lifting early cancels it,
 * and onHold(point) runs once at the starting point. up() says whether the press was a long-press,
 * so the caller can ignore the release (no page turn, no tap).
 */
export function createLongPress({ onHold, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let start = null;
  let timer = 0;
  let held = false;
  const stop = () => {
    if (timer) clearTimer(timer);
    timer = 0;
  };
  return {
    down({ x, y, pointerType }) {
      stop();
      held = false;
      if (pointerType !== 'touch') return;
      start = { x, y };
      timer = setTimer(() => {
        timer = 0;
        held = true;
        onHold(start);
      }, HOLD_MS);
    },
    move({ x, y }) {
      if (timer && start && Math.hypot(x - start.x, y - start.y) > MOVE_PX) stop();
    },
    up() {
      stop();
      const was = held;
      held = false;
      return was;
    },
    cancel() {
      stop();
      held = false;
    },
    get held() { return held; },
  };
}

/** The sheet under a downward drag of dy px: it follows the finger down only, and closes past the threshold. */
export function sheetDrag(dy) {
  const offset = Math.max(0, dy);
  return { offset, close: offset >= SWIPE_CLOSE_PX };
}
