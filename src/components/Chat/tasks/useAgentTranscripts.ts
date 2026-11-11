import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../types';
import { transcriptToChatMessages } from './transcript';

export interface AgentTranscript { messages: ChatMessage[]; finished: boolean; unavailable: boolean }

const POLL_MS = 2000;

interface Chunk {
  finished: boolean;
  messages: Array<{ type: string; uuid: string; message: unknown }>;
  nextOffset: number;
}
interface Entry { raw: Chunk['messages']; offset: number; nulls: number; transcript: AgentTranscript }

/** Consecutive null results tolerated for a live id before it is marked unavailable. */
const MAX_LIVE_NULLS = 3;

const NONE: ReadonlySet<string> = new Set();

/**
 * Fetches each background subagent's transcript once, then re-polls the ids in
 * `liveIds`. Raw messages accumulate per id and are re-converted as a whole so a
 * tool_result in a later chunk pairs with its tool_use from an earlier one.
 *
 * A null (no transcript yet) marks a non-live id unavailable only once its card
 * is finished (`finishedIds`): the subagent may not have written its meta yet.
 * An id entering `liveIds` clears unavailable/nulls; an id leaving it gets one
 * final poll so the transcript's tail isn't lost.
 */
export function useAgentTranscripts(
  sessionId: string | null | undefined,
  toolUseIds: string[],
  liveIds: ReadonlySet<string>,
  finishedIds: ReadonlySet<string> = NONE,
): Map<string, AgentTranscript> {
  const [transcripts, setTranscripts] = useState<Map<string, AgentTranscript>>(() => new Map());
  const entries = useRef(new Map<string, Entry>());
  const sessionRef = useRef(sessionId);
  /** Live ids as of the previous poll-effect run. */
  const prevLive = useRef<ReadonlySet<string>>(NONE);
  /** Ids that left liveIds and still owe a final poll (survives effect re-runs). */
  const needsFinal = useRef(new Set<string>());
  const finishedRef = useRef(finishedIds);
  finishedRef.current = finishedIds;
  const idsKey = toolUseIds.join('\u0000');
  const liveKey = toolUseIds.filter((id) => liveIds.has(id)).join('\u0000');
  const finishedKey = toolUseIds.filter((id) => finishedIds.has(id)).join('\u0000');

  // New session: drop everything.
  useEffect(() => {
    sessionRef.current = sessionId;
    entries.current = new Map();
    prevLive.current = NONE;
    needsFinal.current = new Set();
    setTranscripts((m) => (m.size ? new Map() : m));
  }, [sessionId]);

  // Changed id list: keep ids still present (no refetch from offset 0), drop removed ones.
  useEffect(() => {
    const keep = new Set(toolUseIds);
    let removed = false;
    for (const id of [...entries.current.keys()]) {
      if (!keep.has(id)) { entries.current.delete(id); removed = true; }
    }
    if (!removed) return;
    setTranscripts((m) => {
      if (![...m.keys()].some((id) => !keep.has(id))) return m;
      const next = new Map(m);
      for (const id of m.keys()) if (!keep.has(id)) next.delete(id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    // Per-run guard: a cancelled run's poll can't clear a newer run's entry.
    const inFlight = new Set<string>();

    const poll = async (id: string, isLive: boolean) => {
      if (inFlight.has(id)) return;
      const prev = entries.current.get(id);
      if (prev?.transcript.unavailable) return;
      inFlight.add(id);
      try {
        const chunk = (await (window as any).sai?.claudeSubagentTranscript?.(sessionId, id, prev?.offset ?? 0)) as Chunk | null | undefined;
        if (cancelled) return;
        if (!isLive) needsFinal.current.delete(id);
        let next: Entry;
        let added = 0;
        if (!chunk) {
          const nulls = (prev?.nulls ?? 0) + 1;
          const unavailable = isLive ? nulls >= MAX_LIVE_NULLS : finishedRef.current.has(id);
          next = {
            raw: prev?.raw ?? [], offset: prev?.offset ?? 0, nulls,
            transcript: { messages: prev?.transcript.messages ?? [], finished: false, unavailable },
          };
        } else {
          const fresh = Array.isArray(chunk.messages) ? chunk.messages : [];
          added = fresh.length;
          const raw = [...(prev?.raw ?? []), ...fresh];
          next = {
            raw,
            nulls: 0,
            offset: typeof chunk.nextOffset === 'number' ? chunk.nextOffset : raw.length,
            transcript: added || !prev
              ? { messages: transcriptToChatMessages(raw), finished: chunk.finished === true, unavailable: false }
              : { ...prev.transcript, finished: chunk.finished === true, unavailable: false },
          };
        }
        // Nothing visible changed (no new messages, same finished/unavailable): keep the
        // old transcript object and skip the state update.
        const unchanged = !!prev && added === 0 &&
          prev.transcript.finished === next.transcript.finished &&
          prev.transcript.unavailable === next.transcript.unavailable;
        if (unchanged) {
          entries.current.set(id, { ...next, transcript: prev!.transcript });
          return;
        }
        entries.current.set(id, next);
        setTranscripts((m) => new Map(m).set(id, next.transcript));
      } catch {
        /* keep prior state; next tick retries if live */
      } finally {
        inFlight.delete(id);
      }
    };

    const live = toolUseIds.filter((id) => liveIds.has(id));
    const liveSet = new Set(live);
    const present = new Set(toolUseIds);

    // Entering liveIds: forget earlier nulls so the id is polled again.
    for (const id of live) {
      if (prevLive.current.has(id)) continue;
      needsFinal.current.delete(id);
      const e = entries.current.get(id);
      if (!e || (e.nulls === 0 && !e.transcript.unavailable)) continue;
      const transcript = e.transcript.unavailable ? { ...e.transcript, unavailable: false } : e.transcript;
      entries.current.set(id, { ...e, nulls: 0, transcript });
      if (transcript !== e.transcript) setTranscripts((m) => new Map(m).set(id, transcript));
    }
    // Leaving liveIds: owe one final poll.
    for (const id of prevLive.current) {
      if (!liveSet.has(id) && present.has(id) && !entries.current.get(id)?.transcript.finished) needsFinal.current.add(id);
    }
    for (const id of [...needsFinal.current]) if (!present.has(id) || liveSet.has(id)) needsFinal.current.delete(id);
    prevLive.current = liveSet;

    for (const id of toolUseIds) {
      const e = entries.current.get(id);
      if (!e) { void poll(id, liveSet.has(id)); continue; }
      if (liveSet.has(id)) continue;
      // A non-live id that only ever saw nulls gets one more try once its card is finished.
      const retryFinished = e.nulls > 0 && !e.transcript.unavailable && finishedIds.has(id);
      if (needsFinal.current.has(id) || retryFinished) void poll(id, false);
    }
    const timer = live.length
      ? setInterval(() => {
        for (const id of live) if (!entries.current.get(id)?.transcript.finished) void poll(id, true);
      }, POLL_MS)
      : null;

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, idsKey, liveKey, finishedKey]);

  return transcripts;
}
