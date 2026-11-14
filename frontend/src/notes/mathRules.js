/**
 * What typing turns into math in a text note (C22.2b): `$x$` (not right after another `$` or a backslash, and
 * neither starting nor ending with a space, so "$5 or $10" stays text) becomes inline math; `$$x$$` alone in
 * its paragraph becomes display math.
 */
export const INLINE_MATH = /(?<![$\\])\$([^$\s](?:[^$\n]*?[^$\s])?)\$$/;
export const BLOCK_MATH = /^\$\$([^$]+)\$\$$/;
