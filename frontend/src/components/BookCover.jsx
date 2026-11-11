import { useState } from 'react';
import { coverColor } from '../lib/coverColor';
import './BookCover.css';

const RATIO = 1.5; // 2:3

/**
 * A book's cover (handoff D5, components sheet "Book covers").
 *
 * The typographic cover (title, author, a colour from coverColor) is drawn
 * at once and stays underneath; a real cover (`coverUrl`, from our covers
 * bucket) fades in over it when it has loaded and is dropped if it fails,
 * so the typographic cover stays for good. The box is 2:3 at every moment
 * and the image carries width and height, so nothing shifts.
 *
 * - `width`: px, also the image's intrinsic size. Omit to fill the parent.
 * - `processing`: the book is still being read: a soft shimmer runs down
 *   the spine; `progress` (0-100) is added to the accessible name.
 * - `decorative`: hide it from assistive tech when the title is printed
 *   beside it. Otherwise it is one image named "Cover of <title> by <author>".
 * - `priority`: an above-the-fold cover loads eagerly with high priority.
 */
export function BookCover({
  title, author, coverUrl, width, processing = false, progress, decorative = false,
  priority = false, className = '',
}) {
  const [status, setStatus] = useState({ src: null, state: 'loading' });
  const state = status.src === coverUrl ? status.state : 'loading';
  const showImage = Boolean(coverUrl) && state !== 'failed';

  let name = `Cover of ${title || 'an untitled book'}${author ? ` by ${author}` : ''}`;
  if (processing) name += `, still being read${progress != null ? ` (${Math.round(progress)}%)` : ''}`;

  const intrinsic = width ?? 160;
  return (
    <div
      className={`rf-cover ${className}`.trim()}
      data-color={coverColor(title, author)}
      data-image={showImage ? state : 'none'}
      data-processing={processing || undefined}
      style={width ? { '--cover-width': `${width}px` } : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <div className="rf-cover-face" aria-hidden="true">
        <span className="rf-cover-title">{title}</span>
        {author && <span className="rf-cover-author">{author}</span>}
      </div>
      {showImage && (
        <img
          className="rf-cover-image"
          src={coverUrl}
          alt=""
          title="Cover image · Open Library"
          width={intrinsic}
          height={Math.round(intrinsic * RATIO)}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          ref={(img) => {
            // A cached image can finish before React attaches onLoad.
            if (img?.complete && img.naturalWidth > 0 && state === 'loading') {
              setStatus({ src: coverUrl, state: 'loaded' });
            }
          }}
          onLoad={() => setStatus({ src: coverUrl, state: 'loaded' })}
          onError={() => setStatus({ src: coverUrl, state: 'failed' })}
        />
      )}
      <span className="rf-cover-spine" aria-hidden="true" />
    </div>
  );
}
