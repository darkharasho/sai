import { AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

export default function MotionPresence({ children, initial = false }: { children: ReactNode; initial?: boolean }) {
  return <AnimatePresence mode="popLayout" initial={initial}>{children}</AnimatePresence>;
}
