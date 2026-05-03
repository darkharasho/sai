import { AnimatePresence } from 'motion/react';
import type { ReactNode } from 'react';

interface MotionPresenceProps {
  children: ReactNode;
  initial?: boolean;
}

export default function MotionPresence({ children, initial = false }: MotionPresenceProps) {
  return <AnimatePresence mode="popLayout" initial={initial}>{children}</AnimatePresence>;
}
