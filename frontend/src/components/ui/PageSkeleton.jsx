import { Skeleton } from './Skeleton';

/**
 * C35.5d (issue 20): what a page shows while its code arrives, in place of an empty main area: a heading's
 * width and a block, quiet on --paper-2. aria-busy names the wait.
 */
export function PageSkeleton() {
  return (
    <div className="rf-page-skeleton" aria-busy="true" aria-label="Loading the page">
      <Skeleton width={260} height={44} />
      <Skeleton width={200} height={14} style={{ marginTop: 'var(--space-3)' }} />
      <Skeleton height={240} style={{ marginTop: 'var(--space-6)' }} />
    </div>
  );
}
