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
  /** Text deltas were emitted for the in-flight top-level assistant message;
   *  its complete frame must arrive with text blocks stripped (dedupe). */
  deltaTextEmitted?: boolean;
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
    // Live-typing dedupe: when this top-level message's text already streamed
    // out as delta frames, strip the text blocks from the complete frame —
    // the deltas ARE the text; forwarding it again would duplicate the bubble
    // in every consumer (ChatPanel, remote transcript, task buffer). tool_use
    // and other blocks pass through untouched.
    if (msg.parent_tool_use_id == null && state.deltaTextEmitted && Array.isArray(msg.message?.content)) {
      const stripped = (msg.message.content as Array<{ type?: string }>).filter((b) => b?.type !== 'text');
      emits.push({ ...msg, message: { ...msg.message, content: stripped } });
      nextState = { ...nextState, deltaTextEmitted: false };
    } else {
      emits.push({ ...msg });
    }
    return { emits, state: nextState, sessionId: capturedSessionId };
  }

  // --- stream_event: re-arm on message_start so a resumed turn (wait/wakeup)
  // shows the thinking indicator from the first partial frame, not only when
  // the complete assistant message lands — on thinking-heavy models that can
  // be minutes later. Top-level text deltas are converted to the delta-assistant
  // shape ChatPanel/remote/task-buffer already consume (gemini contract), so
  // assistant text types in live instead of landing per complete message. ---
  if (msg.type === 'stream_event') {
    if (!state.streaming && msg.event?.type === 'message_start') {
      emits.push({ type: 'streaming_start' });
      nextState = { ...nextState, streaming: true };
    }
    const ev = msg.event;
    if (
      msg.parent_tool_use_id == null
      && ev?.type === 'content_block_delta'
      && ev.delta?.type === 'text_delta'
      && typeof ev.delta.text === 'string'
      && ev.delta.text.length > 0
    ) {
      emits.push({
        type: 'assistant',
        message: { content: [{ type: 'text', text: ev.delta.text, delta: true }] },
      });
      nextState = { ...nextState, deltaTextEmitted: true };
      return { emits, state: nextState, sessionId: capturedSessionId };
    }
    emits.push({ ...msg });
    return { emits, state: nextState, sessionId: capturedSessionId };
  }

  // --- All other types (user, system non-init, rate_limit_event, stream_event, unknown): forward as-is ---
  emits.push({ ...msg });
  return { emits, state: nextState, sessionId: capturedSessionId };
}
