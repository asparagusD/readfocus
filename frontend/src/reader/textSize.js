/**
 * Reader text size (C12.5a): the handoff's three sizes, kept in
 * localStorage like the theme (plan answer 3). Storage failures fall back
 * to the default for this visit.
 */
export const SIZES = [16.5, 18, 19.5];
export const DEFAULT_SIZE = 18;
export const SIZE_KEY = 'rf-text-size';

export function parseSize(value) {
  const size = Number(value);
  return SIZES.includes(size) ? size : DEFAULT_SIZE;
}

export function stepSize(size, direction) {
  const index = SIZES.indexOf(size);
  return SIZES[Math.min(SIZES.length - 1, Math.max(0, (index < 0 ? 1 : index) + direction))];
}

export function readSize() {
  try {
    return parseSize(window.localStorage.getItem(SIZE_KEY));
  } catch {
    return DEFAULT_SIZE;
  }
}

export function storeSize(size) {
  try {
    window.localStorage.setItem(SIZE_KEY, String(size));
  } catch {
    // Not persisted; the size still applies for this visit.
  }
}
