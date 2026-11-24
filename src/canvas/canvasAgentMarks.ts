import { splitBlocks, taskItems, type CanvasBlock, type TaskItem } from './canvasBlocks';
import { diffAgainstBase } from './canvasMerge';

/** Agent-change markers show for this long after the agent's write (or until the user edits). */
export const AGENT_MARK_TTL_MS = 10 * 60 * 1000;

export type MarkKind = 'added' | 'edited';

/**
 * What the most recent agent write changed, at block level and (inside checklists) item level.
 * Indices are into the content right after that write; the store drops the marks on the next
 * user edit, so they never outlive the content they index.
 */
export interface AgentMarks {
  blocks: { index: number; kind: MarkKind }[];
  items: { block: number; item: number; kind: MarkKind }[];
}

const label = (it: TaskItem) => it.text.split('\n')[0].trim();

/** Items keyed by label + occurrence, so duplicates pair up in order. */
function keyed(items: TaskItem[]): Map<string, { at: number; item: TaskItem }> {
  const out = new Map<string, { at: number; item: TaskItem }>();
  const count = new Map<string, number>();
  items.forEach((item, at) => {
    const l = label(item);
    const n = count.get(l) ?? 0;
    count.set(l, n + 1);
    out.set(`${l}\u0000${n}`, { at, item });
  });
  return out;
}

function itemChanges(before: CanvasBlock, after: CanvasBlock): AgentMarks['items'] {
  const old = keyed(taskItems(before.source));
  const out: AgentMarks['items'] = [];
  for (const [key, { at, item }] of keyed(taskItems(after.source))) {
    const prev = old.get(key);
    if (!prev) out.push({ block: after.index, item: at, kind: 'added' });
    else if (prev.item.state !== item.state || prev.item.text !== item.text) out.push({ block: after.index, item: at, kind: 'edited' });
  }
  return out;
}

export function deriveAgentMarks(before: string, after: string): AgentMarks {
  const marks: AgentMarks = { blocks: [], items: [] };
  const beforeBlocks = splitBlocks(before);
  const { states, inserted } = diffAgainstBase(beforeBlocks, splitBlocks(after));
  for (const slot of inserted) for (const b of slot) marks.blocks.push({ index: b.index, kind: 'added' });
  states.forEach((state, i) => {
    if (state.kind !== 'replaced') return;
    const was = beforeBlocks[i];
    const now = state.block;
    if (was.kind === 'checklist' && now.kind === 'checklist') {
      const items = itemChanges(was, now);
      if (items.length) {
        marks.items.push(...items);
        return;
      }
    }
    marks.blocks.push({ index: now.index, kind: 'edited' });
  });
  marks.blocks.sort((a, b) => a.index - b.index);
  marks.items.sort((a, b) => a.block - b.block || a.item - b.item);
  return marks;
}

export function blockMark(marks: AgentMarks | null, index: number): MarkKind | null {
  return marks?.blocks.find((b) => b.index === index)?.kind ?? null;
}

export function itemMark(marks: AgentMarks | null, block: number, item: number): MarkKind | null {
  return marks?.items.find((m) => m.block === block && m.item === item)?.kind ?? null;
}
