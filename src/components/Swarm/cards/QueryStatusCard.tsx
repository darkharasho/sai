import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall } from '../../../types';
import { cardBase, cardHeader, safeJsonParse } from './cardStyles';

interface Props {
  toolCall: ToolCall;
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

interface SnapshotShape {
  active?: number;
  approvals?: number;
  ready?: number;
  tasks?: Array<{ id: string; title: string; status: string; branch?: string }>;
}

/** Try to pull a snapshot out of either the tool's `output` or its `input.filter` */
function parseSnapshot(toolCall: ToolCall): SnapshotShape | null {
  const out = safeJsonParse<any>(toolCall.output);
  if (out && typeof out === 'object') {
    const snap = out.snapshot ?? out;
    if (snap && typeof snap === 'object') return snap as SnapshotShape;
  }
  return null;
}

export default function QueryStatusCard({ toolCall, seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const [expanded, setExpanded] = useState(false);
  const snap = parseSnapshot(toolCall);
  const active = snap?.active ?? 0;
  const approvals = snap?.approvals ?? 0;
  const ready = snap?.ready ?? 0;
  const tasks = snap?.tasks ?? [];

  return (
    <motion.div
      data-testid="swarm-query-card"
      style={grow ? { ...cardBase, overflow: 'hidden' } : cardBase}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 10, paddingBottom: 10, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <div style={cardHeader}>
        <span>● Status</span>
        {tasks.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: 10, cursor: 'pointer', padding: 0,
            }}
          >
            {expanded ? 'collapse' : `expand (${tasks.length})`}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12 }}>
        <b style={{ color: 'var(--accent)' }}>{active}</b> active{' · '}
        <b style={{ color: '#b44' }}>{approvals}</b> approvals{' · '}
        <b style={{ color: '#3a8' }}>{ready}</b> ready
      </div>
      {expanded && tasks.length > 0 && (
        <ul style={{
          listStyle: 'none', padding: 0, margin: '8px 0 0',
          display: 'flex', flexDirection: 'column', gap: 3,
          fontSize: 11,
        }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title}
              </span>
              <span style={{ opacity: 0.7, fontFamily: "'Geist Mono', monospace" }}>{t.status}</span>
            </li>
          ))}
        </ul>
      )}
      {!snap && (
        <div style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>Awaiting snapshot…</div>
      )}
    </motion.div>
  );
}
