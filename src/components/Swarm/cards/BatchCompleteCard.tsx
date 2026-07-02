import React from 'react';
import { motion } from 'motion/react';
import { useSeedGrow } from '../../Chat/seedGrow';
import { SPRING, useReducedMotionTransition } from '../../Chat/motion';
import type { ToolCall } from '../../../types';
import { cardBase, SWARM_GREEN, SWARM_RED, safeJsonParse, btnPrimary } from './cardStyles';
import Sparkline from '../Sparkline';

interface Input {
  totalTasks?: number;
  landed?: number;
  discarded?: number;
  failed?: number;
  totalCost?: number;
  durationMs?: number;
  completionBuckets?: number[];
}

interface Props {
  toolCall: ToolCall;
  /** When provided, hooked up to "Land all green" — only fires for `done` task ids. */
  onLandAll?: () => void;
  /** True if there are still tasks in `done` state we could land. */
  hasLandable?: boolean;
  /** Card is born from the tail thinking row: mount with the grow-in entry. */
  seedGrow?: boolean;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  color?: string;
  emphasized?: boolean;
}

function Stat({ label, value, color, emphasized }: StatProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        padding: '10px 12px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 9,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          opacity: 0.55,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: emphasized ? 22 : 18,
          fontWeight: 600,
          color: color ?? 'var(--text)',
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function BatchCompleteCard({ toolCall, onLandAll, hasLandable, seedGrow }: Props) {
  const grow = useSeedGrow(seedGrow);
  const growTransition = useReducedMotionTransition(SPRING.pop);
  const input = safeJsonParse<Input>(toolCall.input) ?? {};
  const total = input.totalTasks ?? 0;
  const landed = input.landed ?? 0;
  const discarded = input.discarded ?? 0;
  const failed = input.failed ?? 0;
  const buckets = Array.isArray(input.completionBuckets) ? input.completionBuckets : [];
  const hasBuckets = buckets.some(v => v > 0);
  const showCost = typeof input.totalCost === 'number';

  return (
    <motion.div
      data-testid="swarm-batch-complete-card"
      style={{
        ...cardBase,
        width: '100%',
        padding: 16,
        margin: '12px 0',
        ...(grow ? { overflow: 'hidden' } : null),
      }}
      initial={grow ? { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0 } : false}
      animate={grow ? { height: 'auto', paddingTop: 16, paddingBottom: 16, opacity: 1 } : undefined}
      transition={growTransition}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 1,
              textTransform: 'uppercase',
              opacity: 0.55,
              marginBottom: 2,
            }}
          >
            Batch complete
          </div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            🎯 {total} task{total === 1 ? '' : 's'} done
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {formatDuration(input.durationMs)} elapsed
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${showCost ? 5 : 4}, 1fr)`,
          gap: 8,
          marginBottom: 14,
        }}
      >
        <Stat label="Total" value={total} emphasized />
        <Stat label="Landed" value={landed} color={SWARM_GREEN} emphasized />
        <Stat label="Discarded" value={discarded} color="var(--text-muted)" />
        <Stat label="Failed" value={failed} color={SWARM_RED} />
        {showCost && <Stat label="Cost" value={`$${input.totalCost!.toFixed(2)}`} />}
      </div>

      {hasBuckets && (() => {
        const peak = buckets.reduce((a, b) => Math.max(a, b), 0);
        const totalSec = Math.max(0, Math.round((input.durationMs ?? 0) / 1000));
        const startLabel = totalSec >= 60
          ? `−${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
          : `−${totalSec}s`;
        return (
          <div
            data-testid="swarm-batch-complete-sparkline"
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  opacity: 0.55,
                  color: 'var(--text)',
                }}
              >
                Completion timeline
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                peak {peak} task{peak === 1 ? '' : 's'} / bucket
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  fontSize: 9,
                  fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
                  color: 'var(--text-muted)',
                  width: 16,
                  textAlign: 'right',
                  paddingTop: 1,
                  paddingBottom: 1,
                }}
              >
                <span>{peak}</span>
                <span>0</span>
              </div>
              <div style={{ flex: 1, color: 'var(--accent)' }}>
                <Sparkline data={buckets} width={800} height={56} fillOpacity={0.22} strokeWidth={1.5} fullWidth />
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 4,
                fontSize: 9,
                fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
                color: 'var(--text-muted)',
                paddingLeft: 22,
              }}
            >
              <span>{startLabel}</span>
              <span>now</span>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onLandAll && hasLandable && (
          <button type="button" style={btnPrimary} onClick={onLandAll}>
            Land all green
          </button>
        )}
      </div>
    </motion.div>
  );
}
