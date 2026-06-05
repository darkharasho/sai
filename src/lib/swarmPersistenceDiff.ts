import type { SwarmTask } from '../types';

export interface SwarmTaskDiff {
  upserts: SwarmTask[];
  deletes: string[];
}

function shallowEqualTask(a: SwarmTask, b: SwarmTask): boolean {
  const ak = Object.keys(a) as (keyof SwarmTask)[];
  const bk = Object.keys(b) as (keyof SwarmTask)[];
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Compute the persistence actions needed to move the store from `prev` to
 * `next` for a single workspace's task list:
 *  - upserts: tasks in `next` that are new or whose fields changed (shallow).
 *  - deletes: ids present in `prev` but absent from `next`.
 * The in-memory React task object is the full record, so callers persist the
 * whole object (a put), avoiding any partial-patch read-modify-write race.
 */
export function diffSwarmTasks(prev: SwarmTask[], next: SwarmTask[]): SwarmTaskDiff {
  const prevById = new Map(prev.map(t => [t.id, t]));
  const nextById = new Map(next.map(t => [t.id, t]));
  const upserts: SwarmTask[] = [];
  for (const t of next) {
    const before = prevById.get(t.id);
    if (!before || !shallowEqualTask(before, t)) upserts.push(t);
  }
  const deletes: string[] = [];
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) deletes.push(id);
  }
  return { upserts, deletes };
}
