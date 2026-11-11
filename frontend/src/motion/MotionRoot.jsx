import { LazyMotion, MotionConfig } from 'motion/react';

// Motion's animation features (domAnimation) arrive in their own chunk
// after first paint; until then <m.*> elements hold their `initial`
// state, so anything visible on first paint should skip it
// (AnimatePresence initial={false}, as the routes do).
const loadFeatures = () => import('./features').then((mod) => mod.default);

// One place for Motion's global settings (C10.4).
// - reducedMotion="user": under prefers-reduced-motion, Motion skips
//   transform animations and keeps opacity (D3).
// - LazyMotion with domAnimation only; `strict` makes a stray
//   <motion.div> throw, so components use <m.div>.
export function MotionRoot({ children }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
