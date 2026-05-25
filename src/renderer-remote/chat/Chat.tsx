import { useEffect, useRef, useState } from 'react';
import type { WireClient } from '../wire';
import Transcript, { type TranscriptMessage } from './Transcript';
import Composer from './Composer';
import Approval from './Approval';
import SessionDrawer from './SessionDrawer';
import SaiLogo from '../branding/SaiLogo';

interface Props {
  client: WireClient;
  initialActive?: { projectPath: string; scope: string; sessionId: string };
}

interface PendingApproval { toolUseId: string; toolName: string; command?: string; input?: Record<string, unknown> }

export default function Chat({ client, initialActive }: Props) {
  const [active, setActive] = useState<{ projectPath: string; scope: string; sessionId: string } | null>(initialActive ?? null);
  const [follow, setFollow] = useState(true);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!active) return;
    setMessages([]); setPendingApproval(null); setStreaming(false);
    client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId: active.sessionId });
  }, [active?.projectPath, active?.scope, active?.sessionId]);

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
              out.push({
                id: `h-${i}-tc-${j}-${tc.id ?? j}`,
                role: 'tool',
                toolName: tc.name ?? tc.type ?? 'tool',
                toolInput: parsedInput,
                toolResult: typeof tc.output === 'string' ? tc.output : undefined,
                toolStatus: tc.output !== undefined ? 'done' : 'running',
              });
            });
          }
        });
        setMessages(out);
        return;
      }
      if (t === 'streaming_start') { setStreaming(true); return; }
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
              if (next.some((m) => m.id === `tool-${blk.id}`)) continue;
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
                toolName: blk.name,
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
      if (t === 'result' || t === 'done') {
        setStreaming(false);
        setMessages((arr) => arr.map((m, i) => i === arr.length - 1 && m.streaming ? { ...m, streaming: false } : m));
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
        setStreaming(false);
        return;
      }
    });
    return off;
  }, [client, follow]);

  const onSend = (text: string) => {
    if (!active) return;
    setMessages((arr) => [...arr, { id: `u-opt-${Date.now()}`, role: 'user', text }]);
    setMessages((arr) => [...arr, { id: `a-pending-${Date.now()}`, role: 'assistant', text: '', streaming: true }]);
    setStreaming(true);
    client.sendPrompt({ text, projectPath: active.projectPath, scope: active.scope });
  };

  const onInterrupt = () => { if (active) client.interrupt(active.projectPath, active.scope); };

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
        width: '100vw',
        height: '100svh',
        background: 'var(--bg-primary)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
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
          onClick={() => setDrawerOpen(true)}
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
            fontSize: 18,
          }}
        >
          ≡
        </button>
        <SaiLogo mode="idle" size={20} color="var(--accent)" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>SAI</div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: '"Geist Mono", ui-monospace, monospace',
          }}>
            {active ? active.projectPath.split('/').pop() : 'no session attached'}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Transcript messages={messages} />
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
      <div className="shrink-0">
        <Composer streaming={streaming} onSend={onSend} onInterrupt={onInterrupt} />
      </div>
      <SessionDrawer
        client={client}
        followEnabled={follow}
        onFollowChange={setFollow}
        onAttach={(projectPath, sessionId) => setActive({ projectPath, scope: 'chat', sessionId })}
        currentProjectPath={active?.projectPath ?? null}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
