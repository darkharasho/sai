import { describe, it, expect } from 'vitest';
import { mapSdkMessage, MapperState } from '../../../electron/services/claudeBackend/sdkMessageMap';

const freshState = (): MapperState => ({ streaming: false, sessionIdSeen: false });
const streamingState = (): MapperState => ({ streaming: true, sessionIdSeen: false });

// --- (a) assistant while streaming:true → single assistant emit, state unchanged ---
describe('assistant while streaming:true', () => {
  it('emits only the assistant payload, no re-arm, state unchanged', () => {
    const msg = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } };
    const state = streamingState();
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(1);
    expect(result.emits[0].type).toBe('assistant');
    expect(result.state.streaming).toBe(true);
    expect(result.state.sessionIdSeen).toBe(false);
  });
});

// --- (b) assistant while streaming:false → [streaming_start, assistant], state.streaming becomes true ---
describe('assistant while streaming:false (re-arm)', () => {
  it('prepends streaming_start and sets state.streaming=true', () => {
    const msg = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'resumed' }] } };
    const state = freshState();
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(2);
    expect(result.emits[0].type).toBe('streaming_start');
    expect(result.emits[1].type).toBe('assistant');
    expect(result.state.streaming).toBe(true);
  });
});

// --- (c) result → [result, done], state.streaming false ---
describe('result message', () => {
  it('emits result then done, sets state.streaming=false', () => {
    const msg = { type: 'result', stop_reason: 'end_turn', total_cost_usd: 0.001, duration_ms: 1234, num_turns: 1 };
    const state = streamingState();
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(2);
    expect(result.emits[0].type).toBe('result');
    expect(result.emits[0].stop_reason).toBe('end_turn');
    expect(result.emits[1].type).toBe('done');
    expect(result.state.streaming).toBe(false);
  });
});

// --- (d) system/init → emit carries slash_commands ---
describe('system init message', () => {
  it('emits system init with slash_commands intact', () => {
    const msg = { type: 'system', subtype: 'init', slash_commands: ['/help', '/compact'] };
    const state = freshState();
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(1);
    expect(result.emits[0].type).toBe('system');
    expect(result.emits[0].subtype).toBe('init');
    expect(result.emits[0].slash_commands).toEqual(['/help', '/compact']);
  });
});

// --- (e) scripted wait→resume sequence: assistant, result, assistant ---
describe('wait/restore re-arm sequence', () => {
  it('second assistant (after result) triggers a re-arm streaming_start', () => {
    let state = freshState();

    // First assistant: streaming:false → re-arm
    const msg1 = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'thinking...' }] } };
    const r1 = mapSdkMessage(msg1, state);
    expect(r1.emits[0].type).toBe('streaming_start');
    expect(r1.emits[1].type).toBe('assistant');
    expect(r1.state.streaming).toBe(true);
    state = r1.state;

    // Result (wait pause): streaming → false
    const msg2 = { type: 'result', stop_reason: 'tool_use', num_turns: 1 };
    const r2 = mapSdkMessage(msg2, state);
    expect(r2.emits[0].type).toBe('result');
    expect(r2.emits[1].type).toBe('done');
    expect(r2.state.streaming).toBe(false);
    state = r2.state;

    // Second assistant: streaming:false again → re-arm
    const msg3 = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'resumed' }] } };
    const r3 = mapSdkMessage(msg3, state);
    expect(r3.emits).toHaveLength(2);
    expect(r3.emits[0].type).toBe('streaming_start');
    expect(r3.emits[1].type).toBe('assistant');
    expect(r3.state.streaming).toBe(true);
  });
});

// --- (f) user tool_result forwarded as-is ---
describe('user tool_result', () => {
  it('forwards user message as-is', () => {
    const msg = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_abc', content: 'ok' }],
      },
    };
    const state = streamingState();
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(1);
    expect(result.emits[0].type).toBe('user');
    expect(result.emits[0].message).toEqual(msg.message);
  });
});

// --- (g) unknown type forwarded as-is ---
describe('unknown type', () => {
  it('forwards unknown message type without modification', () => {
    const msg = { type: 'stream_event', delta: { type: 'text_delta', text: 'chunk' } };
    const state = streamingState();
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(1);
    expect(result.emits[0].type).toBe('stream_event');
    expect(result.emits[0].delta).toEqual(msg.delta);
  });
});

// --- session_id capture: emits session_id once and sets sessionIdSeen ---
describe('session_id capture', () => {
  it('emits session_id payload and sets sessionIdSeen on first occurrence', () => {
    const msg = { type: 'system', subtype: 'init', session_id: 'sess-xyz', slash_commands: [] };
    const state = freshState();
    const result = mapSdkMessage(msg, state);
    // Should have captured sessionId
    expect(result.sessionId).toBe('sess-xyz');
    expect(result.state.sessionIdSeen).toBe(true);
    // Should include a session_id emit before the system init
    const sessionIdEmit = result.emits.find(e => e.type === 'session_id');
    expect(sessionIdEmit).toBeDefined();
    expect(sessionIdEmit?.sessionId).toBe('sess-xyz');
  });

  it('does NOT re-emit session_id if already seen', () => {
    const msg = { type: 'assistant', session_id: 'sess-xyz', message: { role: 'assistant', content: [] } };
    const state: MapperState = { streaming: true, sessionIdSeen: true };
    const result = mapSdkMessage(msg, state);
    const sessionIdEmit = result.emits.find(e => e.type === 'session_id');
    expect(sessionIdEmit).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });
});

// --- stream_event re-arm: resumed turns show streaming from the first partial frame ---
describe('stream_event message_start re-arm', () => {
  it('re-arms streaming_start when a message_start arrives while not streaming', () => {
    const msg = { type: 'stream_event', event: { type: 'message_start' } };
    const state: MapperState = { streaming: false, sessionIdSeen: true };
    const result = mapSdkMessage(msg, state);
    expect(result.emits[0].type).toBe('streaming_start');
    expect(result.emits[1].type).toBe('stream_event');
    expect(result.state.streaming).toBe(true);
  });

  it('does NOT re-arm on message_start while already streaming', () => {
    const msg = { type: 'stream_event', event: { type: 'message_start' } };
    const state: MapperState = { streaming: true, sessionIdSeen: true };
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(1);
    expect(result.emits[0].type).toBe('stream_event');
  });

  it('does NOT re-arm on non-message_start stream events while not streaming', () => {
    const msg = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } };
    const state: MapperState = { streaming: false, sessionIdSeen: true };
    const result = mapSdkMessage(msg, state);
    expect(result.emits).toHaveLength(1);
    expect(result.emits[0].type).toBe('stream_event');
    expect(result.state.streaming).toBe(false);
  });
});
