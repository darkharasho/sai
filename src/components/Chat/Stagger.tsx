import { motion } from 'motion/react';
import { STAGGER } from './motion';
import type { ReactNode } from 'react';

type Cadence = keyof typeof STAGGER;

interface StaggerProps {
  children: ReactNode;
  cadence?: Cadence;
  delay?: number;
}

export default function Stagger({ children, cadence = 'default', delay = 0 }: StaggerProps) {
  const ms = STAGGER[cadence];
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: ms / 1000, delayChildren: delay / 1000 } },
      }}
    >
      {children}
    </motion.div>
  );
}
