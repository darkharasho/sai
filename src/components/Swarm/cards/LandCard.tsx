import React from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall } from '../../../types';
import { cardBase, safeJsonParse, SWARM_GREEN, SWARM_RED, btnPrimary } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  onRebaseRetry?: (taskRef: string) => void;
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

interface LandResult {
  ok?: boolean;
  reason?: string;
  branch?: string;
  baseBranch?: string;
  additions?: number;
  deletions?: number;
}

export default function LandCard({ toolCall, onRebaseRetry, seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const input = safeJsonParse<any>(toolCall.input) ?? {};
  const taskRef: string = input.taskRef ?? '';
  const result = safeJsonParse<LandResult>(toolCall.output);
  const ok = result?.ok !== false; // optimistic on missing output
  const branch = result?.branch ?? input.branch ?? taskRef ?? 'branch';
  const baseBranch = result?.baseBranch ?? 'main';
  const adds = result?.additions ?? 0;
  const dels = result?.deletions ?? 0;

  if (result && result.ok === false) {
    return (
      <motion.div
        data-testid="swarm-land-card"
        style={{ ...cardBase, borderColor: SWARM_RED, ...(grow ? { overflow: 'hidden' } : null) }}
        initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
        animate={grow ? { height: 'auto', paddingTop: 10, paddingBottom: 10, opacity: 1 } : undefined}
        transition={growTransition}
      >
        <div style={{ color: SWARM_RED, fontWeight: 600, marginBottom: 4 }}>
          ✗ Rebase needed: {result.reason ?? 'unknown reason'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => onRebaseRetry?.(taskRef)}
          >
            Rebase + retry
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      data-testid="swarm-land-card"
      style={{ ...cardBase, borderColor: SWARM_GREEN, ...(grow ? { overflow: 'hidden' } : null) }}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 10, paddingBottom: 10, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <div style={{ color: SWARM_GREEN, fontWeight: 600 }}>
        → Landed{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>
          {branch}
        </code>{' '}
        into{' '}
        <code style={{ fontFamily: "'Geist Mono', monospace", background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>
          {baseBranch}
        </code>
      </div>
      {(adds > 0 || dels > 0) && (
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>
          <span style={{ color: SWARM_GREEN }}>+{adds}</span>{' '}
          <span style={{ color: SWARM_RED }}>−{dels}</span>
        </div>
      )}
    </motion.div>
  );
}
