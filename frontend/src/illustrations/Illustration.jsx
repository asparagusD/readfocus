import './illustrations.css';

/**
 * Shared wrapper for the original illustration set (C11.1). `svg` is the
 * svgo-optimised markup of one file in ./svg, imported with `?raw`; it is
 * our own static file, never user content.
 *
 * - Decorative by default (`aria-hidden`). Pass `title` when the picture
 *   carries meaning; it becomes the accessible name (role="img").
 * - `size` is the rendered width in px (height follows the viewBox).
 * - `animated` turns on the CSS loops of the parts marked `data-part`
 *   (see parts.js); they stop under prefers-reduced-motion.
 * - Other props (ref, className, data-*) reach the outer span, so Motion
 *   can animate parts with `scope.current.querySelectorAll(PARTS.steam)`.
 */
export function Illustration({ svg, title, size, animated = false, className = '', style, ...rest }) {
  const named = Boolean(title);
  return (
    <span
      {...rest}
      className={`rf-illustration ${className}`.trim()}
      role={named ? 'img' : undefined}
      aria-label={named ? title : undefined}
      aria-hidden={named ? undefined : true}
      data-animated={animated ? 'on' : undefined}
      style={size ? { ...style, '--illustration-size': `${size}px` } : style}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
