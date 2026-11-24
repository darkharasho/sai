import { mergeBlocks, type MergeConflict } from './canvasMerge';
import { describeUserEdits, buildCanvasUpdateMessage } from './canvasDiff';
import { splitBlocks, replaceBlock } from './canvasBlocks';

export interface CanvasStoreDeps {
  writeFile(path: string, content: string): Promise<void>;
  now(): number;
}

export interface CanvasState {
  path: string;
  content: string;
  lastEditor: 'user' | 'agent';
  lastEditedAt: number;
  /** Last user edit or emit (0 = none since first sight): drives the auto-send idle window. */
  lastUserActivityAt: number;
  conflicts: MergeConflict[];
  autoSend: boolean;
}

interface Emit {
  label: string;
  data: unknown;
}

interface Entry {
  content: string;
  /** Latest content that includes every user edit (equals `content` after any change). */
  userContent: string;
  /** Content at the previous agent write or delivery: the merge base for the next agent write. */
  agentBase: string;
  lastEditor: 'user' | 'agent';
  lastEditedAt: number;
  lastUserActivityAt: number;
  conflicts: MergeConflict[];
  autoSend: boolean;
  /** Per-chat content last delivered (agent edits applied on top). */
  seen: Map<string, string>;
  emits: Emit[];
  /** Contents SAI wrote that the watcher has not reported yet (oldest first). */
  saiWrites: string[];
  view: CanvasState;
}

/** `.sai/canvas/<file>.md` from an absolute canvas path. */
function relPathOf(path: string): string {
  const i = path.lastIndexOf('/.sai/canvas/');
  return i >= 0 ? path.slice(i + 1) : path;
}

function makeView(path: string, e: Omit<Entry, 'view'>): CanvasState {
  return {
    path,
    content: e.content,
    lastEditor: e.lastEditor,
    lastEditedAt: e.lastEditedAt,
    lastUserActivityAt: e.lastUserActivityAt,
    conflicts: e.conflicts,
    autoSend: e.autoSend,
  };
}

export function createCanvasStore(deps: CanvasStoreDeps) {
  const canvases = new Map<string, Entry>();
  const agentTouched = new Set<string>();
  const listeners = new Set<() => void>();
  const chains = new Map<string, Promise<void>>();
  let listView: CanvasState[] | null = null;

  /** Rebuild cached snapshots for `path` (if it still exists) and notify subscribers. */
  const changed = (path: string) => {
    const e = canvases.get(path);
    if (e) e.view = makeView(path, e);
    listView = null;
    for (const fn of [...listeners]) {
      // A broken listener must not abort the operation (e.g. a pending merge-back write).
      try {
        fn();
      } catch (err) {
        console.error('[canvasStore] subscriber threw', err);
      }
    }
  };

  /** Run `fn` after every earlier operation on `path` has settled. */
  const serialize = (path: string, fn: () => Promise<void>): Promise<void> => {
    const prev = chains.get(path) ?? Promise.resolve();
    const next = prev.then(fn);
    const tail = next.catch(() => {});
    chains.set(path, tail);
    void tail.then(() => {
      if (chains.get(path) === tail) chains.delete(path);
    });
    return next;
  };

  /** Write `content` as SAI. State must already reflect it. A failed write is dropped from echo tracking and rethrown. */
  const saiWrite = async (path: string, e: Entry, content: string) => {
    e.saiWrites.push(content);
    try {
      await deps.writeFile(path, content);
    } catch (err) {
      const i = e.saiWrites.lastIndexOf(content);
      if (i >= 0) e.saiWrites.splice(i, 1);
      throw err;
    }
  };

  /**
   * Re-point conflicts at the block that still holds their `ours` text (nearest the old index);
   * drop those whose text is gone. Conflicts whose index is in `taken` are dropped as superseded.
   */
  const reanchor = (conflicts: MergeConflict[], content: string, taken = new Set<number>()): MergeConflict[] => {
    if (conflicts.length === 0) return conflicts;
    const blocks = splitBlocks(content).map((b) => b.source.trim());
    const out: MergeConflict[] = [];
    for (const c of conflicts) {
      let best = -1;
      blocks.forEach((src, i) => {
        if (src === c.ours && !taken.has(i) && (best < 0 || Math.abs(i - c.index) < Math.abs(best - c.index))) best = i;
      });
      if (best < 0) continue;
      taken.add(best);
      out.push(best === c.index ? c : { ...c, index: best });
    }
    return out;
  };

  const applyUserContent = (e: Entry, content: string) => {
    e.content = content;
    e.userContent = content;
    e.conflicts = reanchor(e.conflicts, content);
    e.lastEditor = 'user';
    e.lastEditedAt = deps.now();
    e.lastUserActivityAt = e.lastEditedAt;
  };

  const newEntry = (path: string, content: string, agentBase: string, lastEditor: 'user' | 'agent'): Entry => {
    const base = {
      content,
      userContent: content,
      agentBase,
      lastEditor,
      lastEditedAt: deps.now(),
      lastUserActivityAt: 0,
      conflicts: [],
      autoSend: true,
      seen: new Map<string, string>(),
      emits: [],
      saiWrites: [],
    };
    return { ...base, view: makeView(path, base) };
  };

  const onAgentWrite = async (path: string, e: Entry, disk: string) => {
    const res = mergeBlocks(e.agentBase, e.userContent, disk);
    const final = res.changed ? res.merged : disk;
    // Carry the agent's own block changes (agentBase -> disk) into every chat's seen-snapshot,
    // so they never read as user edits while undelivered user edits still do.
    for (const [chat, seen] of e.seen) e.seen.set(chat, mergeBlocks(e.agentBase, seen, disk).merged);
    e.content = final;
    e.userContent = final;
    // Base the next merge on what the agent actually wrote, so a later write built from that
    // (still missing the merged-back user edits) gets them merged back again.
    e.agentBase = disk;
    const fresh = res.conflicts;
    const older = reanchor(e.conflicts, final, new Set(fresh.map((c) => c.index)));
    e.conflicts = [...fresh, ...older].sort((a, b) => a.index - b.index);
    e.lastEditor = 'agent';
    e.lastEditedAt = deps.now();
    agentTouched.add(path);
    changed(path);
    if (res.changed) await saiWrite(path, e, final);
  };

  const pendingMessage = (path: string, chatKey: string): string | null => {
    const e = canvases.get(path);
    if (!e) return null;
    const relPath = relPathOf(path);
    const seen = e.seen.get(chatKey);
    if (seen === undefined) {
      // Never seen: only pending when the user changed something since the agent last wrote.
      if (e.emits.length === 0 && describeUserEdits(e.agentBase, e.content).length === 0) return null;
      return buildCanvasUpdateMessage({ relPath, lines: [], emits: e.emits, fullContent: e.content });
    }
    const lines = describeUserEdits(seen, e.content);
    if (lines.length === 0 && e.emits.length === 0) return null;
    return buildCanvasUpdateMessage({ relPath, lines, emits: e.emits });
  };

  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    get(path: string): CanvasState | undefined {
      return canvases.get(path)?.view;
    },

    list(): CanvasState[] {
      if (!listView) listView = [...canvases.values()].map((e) => e.view);
      return listView;
    },

    /** Watcher event. agentLive = workspace has a live chat turn or background task. */
    onDiskChange(path: string, content: string | null, agentLive: boolean): Promise<void> {
      return serialize(path, async () => {
        const e = canvases.get(path);
        if (content === null) {
          if (!e) return;
          canvases.delete(path);
          agentTouched.delete(path);
          changed(path);
          return;
        }
        if (!e) {
          // First sight is a baseline, never a user edit.
          canvases.set(path, newEntry(path, content, content, agentLive ? 'agent' : 'user'));
          if (agentLive) agentTouched.add(path);
          changed(path);
          return;
        }
        const echo = e.saiWrites.lastIndexOf(content);
        if (echo >= 0) {
          // Our own write (possibly coalesced with older ones the watcher skipped): drop it
          // and everything older. Matching the newest copy keeps A->B->A from leaving a stale B.
          e.saiWrites.splice(0, echo + 1);
          return;
        }
        // The disk moved past every SAI write not yet observed; they can never echo now.
        e.saiWrites = [];
        if (content === e.content) return;
        if (agentLive) {
          await onAgentWrite(path, e, content);
        } else {
          applyUserContent(e, content);
          changed(path);
        }
      });
    },

    /** User edit from the pane; writes the file (caller debounces). */
    userWrite(path: string, content: string, conflicts?: MergeConflict[]): Promise<void> {
      return serialize(path, async () => {
        let e = canvases.get(path);
        if (!e) {
          // A canvas the user created: its whole content counts as a user edit.
          e = newEntry(path, content, '', 'user');
          e.lastUserActivityAt = e.lastEditedAt;
          canvases.set(path, e);
        } else {
          applyUserContent(e, content);
        }
        if (conflicts && conflicts.length > 0) {
          // The caller's merge found blocks both sides changed: keep them visible.
          const idx = new Set(conflicts.map((c) => c.index));
          e.conflicts = [...conflicts, ...e.conflicts.filter((c) => !idx.has(c.index))].sort((a, b) => a.index - b.index);
        }
        changed(path);
        await saiWrite(path, e, content);
      });
    },

    userEmit(path: string, label: string, data: unknown): void {
      const e = canvases.get(path);
      if (!e) return;
      e.emits.push({ label, data });
      e.lastUserActivityAt = deps.now();
      changed(path);
    },

    setAutoSend(path: string, on: boolean): void {
      const e = canvases.get(path);
      if (!e || e.autoSend === on) return;
      e.autoSend = on;
      changed(path);
    },

    resolveConflict(path: string, index: number, take: 'ours' | 'theirs'): Promise<void> {
      return serialize(path, async () => {
        const e = canvases.get(path);
        // Indices are current: every content change re-anchors conflicts (reanchor).
        const conflict = e?.conflicts.find((c) => c.index === index);
        if (!e || !conflict) return;
        e.conflicts = e.conflicts.filter((c) => c !== conflict);
        if (take === 'ours') {
          changed(path);
          return;
        }
        // Conflict texts are trimmed; keep the block's original trailing separator.
        const old = splitBlocks(e.content)[index];
        const trailing = old ? /\s*$/.exec(old.source)![0] : '';
        const next = replaceBlock(e.content, index, conflict.theirs + trailing);
        applyUserContent(e, next);
        changed(path);
        await saiWrite(path, e, next);
      });
    },

    /** Pending message for chatKey, or null if nothing to send. Does not mark seen. */
    pendingMessage,

    /** Marks the current content (+ emits) as seen by chatKey. */
    markDelivered(path: string, chatKey: string): void {
      const e = canvases.get(path);
      if (!e) return;
      e.seen.set(chatKey, e.content);
      e.emits = [];
      e.agentBase = e.content;
      changed(path);
    },

    hasPending(path: string, chatKey: string): boolean {
      return pendingMessage(path, chatKey) !== null;
    },

    /** Paths whose last change was an agent write not yet auto-opened. Clears them. */
    takeAgentTouched(): string[] {
      const out = [...agentTouched];
      agentTouched.clear();
      return out;
    },
  };
}

export type CanvasStore = ReturnType<typeof createCanvasStore>;
