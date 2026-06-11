import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import type { WireClient } from '../wire';
import Transcript, { type TranscriptMessage } from './Transcript';
import Composer from './Composer';
import Approval from './Approval';
import SaiLogo from '../branding/SaiLogo';
import WorkspaceHeader from './WorkspaceHeader';
import { getOverrides, setOverrides as persistOverrides, clearOverrides, type SessionOverrides } from '../lib/overrides';
import type { WorkspaceStatusStore } from '../lib/workspaceStatusStore';
import type { GithubWatcherStore } from './githubWatcherStore';
import { loadTranscript, saveTranscript } from '../lib/transcriptCache';

export interface ChatActive { projectPath: string; scope: string; sessionId: string }

interface Props {
  client: WireClient;
  statusStore: WorkspaceStatusStore;
  watcherStore?: GithubWatcherStore;
  active: ChatActive | null;
  onActiveChange: (next: ChatActive | null) => void;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onOpenNav: () => void;
}

interface PendingApproval { toolUseId: string; toolName: string; command?: string; input?: Record<string, unknown> }

export default function Chat({ client, statusStore, watcherStore, active, onActiveChange, follow, onFollowChange, onOpenNav }: Props) {
  const setActive = onActiveChange;
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [localStreaming, setLocalStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [overrides, setOverridesState] = useState<SessionOverrides>({});

  // Re-render when the active workspace's status changes in the store, so the
  // thinking indicator stays in sync with the backend across workspace switches.
  const [, setStatusTick] = useState(0);
  useEffect(() => {
    const off = statusStore.subscribe((projectPath) => {
      if (projectPath === active?.projectPath) setStatusTick((n) => n + 1);
    });
    return off;
  }, [statusStore, active?.projectPath]);

  // Gate workspace-level streaming on the session it belongs to. If the desktop
  // carried the streaming turn's sessionId, only show thinking when it matches
  // our attached session (so a lingering prior-session turn doesn't bleed into
  // a freshly switched-into session). Null streamingSessionId = first turn
  // before session_id arrived, where we stay permissive.
  const backendStreaming = (() => {
    if (!active) return false;
    const s = statusStore.get(active.projectPath);
    if (!s?.streaming) return false;
    if (!s.streamingSessionId) return true;
    return s.streamingSessionId === active.sessionId;
  })();
  const streaming = backendStreaming || localStreaming;
  const awaitingQuestion = (() => {
    if (!active) return false;
    const s = statusStore.get(active.projectPath);
    return !!s?.awaitingQuestion;
  })();

  // Load overrides for the new session whenever attached session changes.
  useEffect(() => {
    if (!active?.sessionId) { setOverridesState({}); return; }
    setOverridesState(getOverrides(active.sessionId));
  }, [active?.sessionId]);

  const updateOverrides = (next: SessionOverrides) => {
    setOverridesState(next);
    if (active?.sessionId) {
      if (!next.model && !next.effort && !next.permMode) clearOverrides(active.sessionId);
      else persistOverrides(active.sessionId, next);
    }
  };

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!active) return;
    setMessages([]); setPendingApproval(null); setLocalStreaming(false);
    client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId: active.sessionId });
    // Hydrate from IDB while the server replays history. The server's
    // session.history reply overwrites this whenever it arrives, so the
    // cache is purely a "something visible immediately" hint.
    const sid = active.sessionId;
    let cancelled = false;
    void loadTranscript<TranscriptMessage>(sid).then((cached) => {
      if (cancelled || !cached || cached.length === 0) return;
      setMessages((cur) => (cur.length === 0 ? cached : cur));
    });
    return () => { cancelled = true; };
  }, [active?.projectPath, active?.scope, active?.sessionId]);

  // Debounced persistence of the current transcript. Skips while streaming
  // to avoid burning IDB cycles on every token; the post-stream `result`
  // event finalizes the last bubble and triggers a final save.
  useEffect(() => {
    if (!active?.sessionId) return;
    if (messages.length === 0) return;
    const sid = active.sessionId;
    const snapshot = messages;
    const t = setTimeout(() => { void saveTranscript(sid, snapshot); }, 400);
    return () => clearTimeout(t);
  }, [messages, active?.sessionId]);

  useEffect(() => { client.setFollow(follow); }, [follow]);

  useEffect(() => {
    const off = client.on((msg) => {
      const t = (msg as any).type;
      if (t === 'session.active' && follow) {
        setActive({ projectPath: (msg as any).projectPath, scope: (msg as any).scope, sessionId: (msg as any).sessionId });
        return;
      }
      if (t === 'session.history') {
        const raw = (msg as any).messages ?? [];
        // ChatMessage in chatDb stores text in `content` and tool calls in
        // `toolCalls` (each with stringified input + output). Expand each
        // message into [text-bubble?, tool-card*] so history matches live.
        const out: TranscriptMessage[] = [];
        raw.forEach((m: any, i: number) => {
          const text = typeof m.content === 'string' ? m.content : (typeof m.text === 'string' ? m.text : '');
          if (text) {
            out.push({ id: `h-${i}-t`, role: m.role ?? 'assistant', text });
          }
          if (Array.isArray(m.toolCalls)) {
            m.toolCalls.forEach((tc: any, j: number) => {
              let parsedInput: Record<string, unknown> | undefined;
              if (typeof tc.input === 'string' && tc.input.trim()) {
                try { parsedInput = JSON.parse(tc.input); }
                catch { parsedInput = { command: tc.input }; }
              } else if (tc.input && typeof tc.input === 'object') {
                parsedInput = tc.input;
              }
              const rawOutput = tc.output;
              const toolResult = rawOutput == null
                ? undefined
                : typeof rawOutput === 'string'
                  ? rawOutput
                  : JSON.stringify(rawOutput, null, 2);
              out.push({
                id: `h-${i}-tc-${j}-${tc.id ?? j}`,
                role: 'tool',
                toolName: tc.name ?? tc.type ?? 'tool',
                toolUseId: tc.id,
                toolInput: parsedInput,
                toolResult,
                toolStatus: rawOutput != null ? 'done' : 'running',
              });
            });
          }
        });
        setMessages(out);
        return;
      }
      if (t === 'streaming_start') { setLocalStreaming(true); return; }
      if (t === 'assistant') {
        // SDK shape: { type:'assistant', message: { content: Block[] } }
        // Blocks: { type:'text', text } | { type:'tool_use', id, name, input }
        // Process blocks IN ORDER so text+tool+text sequences interleave correctly.
        const content = (msg as any).message?.content;
        const blocks: Array<
          | { kind: 'text'; text: string }
          | { kind: 'tool'; id: string; name: string; input?: Record<string, unknown> }
        > = [];
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === 'text' && typeof b.text === 'string' && b.text.length) {
              blocks.push({ kind: 'text', text: b.text });
            } else if (b?.type === 'tool_use' && typeof b.id === 'string') {
              blocks.push({ kind: 'tool', id: b.id, name: b.name ?? 'tool', input: b.input });
            }
          }
        } else if (typeof (msg as any).text === 'string' && (msg as any).text.length) {
          blocks.push({ kind: 'text', text: (msg as any).text });
        }
        if (!blocks.length) return;
        setMessages((arr) => {
          let next = arr.slice();
          for (const blk of blocks) {
            if (blk.kind === 'text') {
              const last = next[next.length - 1];
              if (last && last.role === 'assistant' && last.streaming) {
                next[next.length - 1] = { ...last, text: (last.text ?? '') + blk.text };
              } else {
                next.push({ id: `a-${Date.now()}-${next.length}`, role: 'assistant', text: blk.text, streaming: true });
              }
            } else {
              const existingIdx = next.findIndex((m) => m.id === `tool-${blk.id}`);
              if (existingIdx >= 0) {
                // SDK streams cumulative state: same tool_use id arrives
                // repeatedly with progressively richer name/input. Merge the
                // latest fields onto the existing card instead of skipping.
                const cur = next[existingIdx];
                next[existingIdx] = {
                  ...cur,
                  toolName: blk.name && blk.name.length > 0 ? blk.name : cur.toolName,
                  toolInput: blk.input ?? cur.toolInput,
                };
                continue;
              }
              // Finalize any open assistant bubble; drop it entirely if empty
              // (e.g. optimistic pending bubble before the first tool_use).
              next = next.reduce<TranscriptMessage[]>((acc, m) => {
                if (m.streaming && m.role === 'assistant') {
                  if (!m.text) return acc; // drop empty placeholder
                  acc.push({ ...m, streaming: false });
                  return acc;
                }
                acc.push(m);
                return acc;
              }, []);
              next.push({
                id: `tool-${blk.id}`,
                role: 'tool',
                toolName: blk.name && blk.name.length > 0 ? blk.name : 'tool',
                toolUseId: blk.id,
                toolInput: blk.input,
                toolStatus: 'running',
              });
            }
          }
          return next;
        });
        return;
      }
      // Tool results arrive in a `user` SDK message with tool_result blocks
      if (t === 'user') {
        const content = (msg as any).message?.content;
        if (!Array.isArray(content)) return;
        for (const b of content) {
          if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
            const resultText = typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
              ? b.content.map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
              : JSON.stringify(b.content);
            const status: 'done' | 'error' = b.is_error ? 'error' : 'done';
            setMessages((arr) => arr.map((m) =>
              m.id === `tool-${b.tool_use_id}` ? { ...m, toolResult: resultText, toolStatus: status } : m
            ));
          }
        }
        return;
      }
      if (t === 'user_message') {
        const text = (msg as any).text ?? '';
        const origin = (msg as any).origin;
        setMessages((arr) => {
          // Dedup remote-origin echoes against the optimistic user bubble we
          // added in onSend. The optimistic add is followed by a pending
          // assistant bubble, so search a small window from the tail, not just `last`.
          if (origin === 'remote') {
            for (let i = arr.length - 1; i >= Math.max(0, arr.length - 4); i--) {
              const m = arr[i];
              if (m.role === 'user' && m.text === text) return arr;
            }
          }
          return [...arr, { id: `u-${Date.now()}`, role: 'user', text }];
        });
        return;
      }
      if (t === 'question_answered') {
        const toolUseId = (msg as any).toolUseId;
        const answers = (msg as any).answers;
        setMessages((arr) => arr.map((m) =>
          m.role === 'tool' && m.toolUseId === toolUseId
            ? { ...m, toolInput: { ...(m.toolInput ?? {}), answers }, toolStatus: 'done' }
            : m
        ));
        return;
      }
      if (t === 'result' || t === 'done') {
        setLocalStreaming(false);
        // Stamp duration on the last assistant bubble so the header label
        // matches the desktop's `[Nms]` style. Only `result` envelopes
        // carry duration_ms — `done` is just a state signal.
        const durationMs = t === 'result' && typeof (msg as any).duration_ms === 'number'
          ? (msg as any).duration_ms
          : undefined;
        setMessages((arr) => arr.map((m, i) => {
          if (i !== arr.length - 1) return m;
          if (m.role !== 'assistant') return m;
          const next = { ...m, streaming: false };
          if (durationMs != null && m.durationMs == null) next.durationMs = durationMs;
          return next;
        }));
        return;
      }
      if (t === 'approval_needed') {
        setPendingApproval({
          toolUseId: (msg as any).toolUseId,
          toolName: (msg as any).toolName ?? 'tool',
          command: (msg as any).command,
          input: (msg as any).input,
        });
        return;
      }
      if (t === 'error') {
        setMessages((arr) => [...arr, { id: `e-${Date.now()}`, role: 'system', text: `Error: ${(msg as any).message ?? 'unknown'}` }]);
        setLocalStreaming(false);
        return;
      }
    });
    return off;
  }, [client, follow]);

  const onSend = (text: string, images?: string[]) => {
    if (!active) return;
    setMessages((arr) => [...arr, { id: `u-opt-${Date.now()}`, role: 'user', text }]);
    setLocalStreaming(true);
    client.sendPrompt({
      text,
      projectPath: active.projectPath,
      scope: active.scope,
      model: overrides.model,
      effort: overrides.effort,
      permMode: overrides.permMode,
      sessionId: active.sessionId,
      images,
    });
  };

  const onInterrupt = () => { if (active) client.interrupt(active.projectPath, active.scope); };

  const onAnswerQuestion = (toolUseId: string, answers: Record<string, string | string[]>) => {
    if (!active) return;
    client.answerQuestion({
      toolUseId,
      answers,
      projectPath: active.projectPath,
      scope: active.scope,
    });
  };

  const onApprove = (decision: 'approve' | 'deny', modifiedCommand?: string) => {
    if (!pendingApproval || !active) return;
    client.approve({
      toolUseId: pendingApproval.toolUseId,
      decision,
      modifiedCommand,
      projectPath: active.projectPath,
      scope: active.scope,
    });
    setPendingApproval(null);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        // Body is position: fixed + inset: 0 (theme.css), so we just fill it.
        // interactive-widget=resizes-content shrinks the layout viewport when
        // the keyboard opens; 100% of the locked body tracks that.
        width: '100%',
        height: '100%',
        background: 'var(--bg-secondary)',
        paddingTop: 'env(safe-area-inset-top)',
        // Bottom inset is owned by the Composer so its background color
        // bleeds into the home-indicator strip — otherwise a band of
        // bg-primary shows under the input on iOS.
      }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          minWidth: 0,
        }}
      >
        <button
          onClick={onOpenNav}
          aria-label="Open sessions"
          style={{
            flexShrink: 0,
            width: 32, height: 32,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <Menu size={18} />
        </button>
        <SaiLogo mode="idle" size={20} color="var(--accent)" />
        <WorkspaceHeader
          client={client}
          statusStore={statusStore}
          currentProjectPath={active?.projectPath ?? null}
          onPick={(projectPath) => {
            client.setActiveWorkspace(projectPath);
            if (!follow) {
              setActive({ projectPath, scope: 'chat', sessionId: '' });
            }
          }}
        />
      </div>
      {/* position: relative on the parent + absolute on Transcript sidesteps
          an iOS Safari quirk where `overflow: auto` inside a flex chain can
          fail to become a scroll container (transcript becomes frozen). */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Transcript messages={messages} streaming={streaming} awaitingQuestion={awaitingQuestion} onAnswerQuestion={onAnswerQuestion} watcherStore={watcherStore} />
      </div>
      {pendingApproval && (
        <div style={{ flexShrink: 0, padding: '0 14px' }}>
          <Approval
            toolName={pendingApproval.toolName}
            command={pendingApproval.command}
            input={pendingApproval.input}
            onDecide={onApprove}
          />
        </div>
      )}
      <div style={{ flexShrink: 0 }}>
        <Composer
          streaming={streaming}
          onSend={onSend}
          onInterrupt={onInterrupt}
          overrides={overrides}
          onOverridesChange={updateOverrides}
        />
      </div>
    </div>
  );
}
