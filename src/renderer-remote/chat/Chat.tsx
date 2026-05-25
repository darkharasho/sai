import { useEffect, useRef, useState } from 'react';
import type { WireClient } from '../wire';
import Transcript, { type TranscriptMessage } from './Transcript';
import Composer from './Composer';
import Approval from './Approval';
import SessionDrawer from './SessionDrawer';

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
        setMessages(raw.map((m: any, i: number) => ({
          id: `h-${i}`, role: m.role ?? 'assistant', text: m.text ?? m.content ?? '',
        })));
        return;
      }
      if (t === 'streaming_start') { setStreaming(true); return; }
      if (t === 'assistant') {
        const text = (msg as any).text ?? '';
        setMessages((arr) => {
          const last = arr[arr.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            return [...arr.slice(0, -1), { ...last, text: (last.text ?? '') + text }];
          }
          return [...arr, { id: `a-${Date.now()}`, role: 'assistant', text, streaming: true }];
        });
        return;
      }
      if (t === 'user_message') {
        const text = (msg as any).text ?? '';
        const origin = (msg as any).origin;
        setMessages((arr) => {
          const last = arr[arr.length - 1];
          if (last && last.role === 'user' && last.text === text && origin === 'remote') return arr;
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
    <div className="flex flex-col h-screen">
      <div className="border-b border-neutral-800 px-3 py-2 flex items-center gap-2">
        <button onClick={() => setDrawerOpen(true)} aria-label="Open sessions" className="text-2xl leading-none">≡</button>
        <div className="text-sm truncate flex-1">
          {active ? <span className="text-neutral-500">{active.projectPath}</span> : <span className="text-neutral-500">No session attached</span>}
        </div>
      </div>
      <Transcript messages={messages} />
      {pendingApproval && (
        <div className="px-3">
          <Approval
            toolName={pendingApproval.toolName}
            command={pendingApproval.command}
            input={pendingApproval.input}
            onDecide={onApprove}
          />
        </div>
      )}
      <Composer streaming={streaming} onSend={onSend} onInterrupt={onInterrupt} />
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
