/**
 * sdkMessageMap.ts — pure SDKMessage → claude:message mapper
 *
 * Turns the SDK's SDKMessage frames into the same `claude:message` payload
 * shapes that SAI's CLI stdout handler emits. The caller (Task 3 backend)
 * is responsible for adding projectPath / scope / turnSeq to each emit.
 *
 * Pure function — no I/O, no mutation of input state.
 */

export interface MapperState {
  streaming: boolean;
  sessionIdSeen: boolean;
}

/** A claude:message payload, without projectPath/scope/turnSeq (caller adds those). */
export interface MappedEmit {
  type: string;
  [k: string]: unknown;
}

export interface MapResult {
  emits: MappedEmit[];
  state: MapperState;
  /** Set if a new session_id was captured this call. */
  sessionId?: string;
}

/**
 * Map a single SDK message frame to zero-or-more claude:message payloads.
 *
 * Mirrors the logic in `electron/services/claude.ts` `proc.stdout.on('data')`.
 */
export function mapSdkMessage(msg: any, state: MapperState): MapResult {
  const emits: MappedEmit[] = [];
  let nextState: MapperState = { ...state };
  let capturedSessionId: string | undefined;

  // --- Session ID: capture once on the first frame that carries it ---
  if (msg.session_id && !state.sessionIdSeen) {
    capturedSessionId = msg.session_id as string;
    nextState = { ...nextState, sessionIdSeen: true };
    emits.push({ type: 'session_id', sessionId: capturedSessionId });
  }

  // --- system / init ---
  if (msg.type === 'system' && msg.subtype === 'init') {
    emits.push({ ...msg });
    return { emits, state: nextState, sessionId: capturedSessionId };
  }

  // --- result: emit result + done, clear streaming ---
  if (msg.type === 'result') {
    emits.push({ ...msg });
    emits.push({ type: 'done' });
    nextState = { ...nextState, streaming: false };
    return { emits, state: nextState, sessionId: capturedSessionId };
  }

  // --- assistant: re-arm if streaming was false (wait/restore fix) ---
  if (msg.type === 'assistant') {
    if (!state.streaming) {
      emits.push({ type: 'streaming_start' });
      nextState = { ...nextState, streaming: true };
    }
    emits.push({ ...msg });
    return { emits, state: nextState, sessionId: capturedSessionId };
  }

  // --- stream_event: re-arm on message_start so a resumed turn (wait/wakeup)
  // shows the thinking indicator from the first partial frame, not only when
  // the complete assistant message lands — on thinking-heavy models that can
  // be minutes later. ---
  if (msg.type === 'stream_event') {
    if (!state.streaming && msg.event?.type === 'message_start') {
      emits.push({ type: 'streaming_start' });
      nextState = { ...nextState, streaming: true };
    }
    emits.push({ ...msg });
    return { emits, state: nextState, sessionId: capturedSessionId };
  }

  // --- All other types (user, system non-init, rate_limit_event, stream_event, unknown): forward as-is ---
  emits.push({ ...msg });
  return { emits, state: nextState, sessionId: capturedSessionId };
}
