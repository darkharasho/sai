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
interface Entry { raw: Chunk['messages']; offset: number; transcript: AgentTranscript }

/**
 * Fetches each background subagent's transcript once, then re-polls the ids in
 * `liveIds`. Raw messages accumulate per id and are re-converted as a whole so a
 * tool_result in a later chunk pairs with its tool_use from an earlier one.
 */
export function useAgentTranscripts(
  sessionId: string | null | undefined,
  toolUseIds: string[],
  liveIds: ReadonlySet<string>,
): Map<string, AgentTranscript> {
  const [transcripts, setTranscripts] = useState<Map<string, AgentTranscript>>(() => new Map());
  const entries = useRef(new Map<string, Entry>());
  const inFlight = useRef(new Set<string>());
  const sessionRef = useRef(sessionId);
  const idsKey = toolUseIds.join('\u0000');
  const liveKey = toolUseIds.filter((id) => liveIds.has(id)).join('\u0000');

  // New session or changed id list: drop state so unavailable ids are retried.
  useEffect(() => {
    sessionRef.current = sessionId;
    entries.current = new Map();
    inFlight.current = new Set();
    setTranscripts(new Map());
  }, [sessionId, idsKey]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const poll = async (id: string) => {
      if (inFlight.current.has(id)) return;
      const prev = entries.current.get(id);
      if (prev?.transcript.unavailable) return;
      inFlight.current.add(id);
      try {
        const chunk = (await (window as any).sai?.claudeSubagentTranscript?.(sessionId, id, prev?.offset ?? 0)) as Chunk | null | undefined;
        if (cancelled) return;
        let next: Entry;
        if (!chunk) {
          next = { raw: prev?.raw ?? [], offset: prev?.offset ?? 0, transcript: { messages: prev?.transcript.messages ?? [], finished: false, unavailable: true } };
        } else {
          const raw = [...(prev?.raw ?? []), ...(Array.isArray(chunk.messages) ? chunk.messages : [])];
          next = {
            raw,
            offset: typeof chunk.nextOffset === 'number' ? chunk.nextOffset : raw.length,
            transcript: { messages: transcriptToChatMessages(raw), finished: chunk.finished === true, unavailable: false },
          };
        }
        entries.current.set(id, next);
        setTranscripts((m) => new Map(m).set(id, next.transcript));
      } catch {
        /* keep prior state; next tick retries if live */
      } finally {
        inFlight.current.delete(id);
      }
    };

    for (const id of toolUseIds) if (!entries.current.has(id)) void poll(id);
    const live = toolUseIds.filter((id) => liveIds.has(id));
    const timer = live.length ? setInterval(() => { for (const id of live) void poll(id); }, POLL_MS) : null;

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      inFlight.current = new Set();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, idsKey, liveKey]);

  return transcripts;
}
