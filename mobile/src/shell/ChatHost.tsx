// Mounts the desktop's real ChatPanel for one chat. The panel reads the chat
// through window.sai.chatlog (the shim); the host derives the props the
// desktop App would pass from the mirrored ChatState and the desktop's
// app settings.
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import ChatPanel from '../../../src/components/Chat/ChatPanel';
import { renderToolCallFor } from '../../../src/components/Chat/renderToolCallFor';
import { isTerminalDetail, type BackgroundTaskDetail } from '../../../electron/services/claudeBackend/backgroundTasks';
import type { WaitMeta } from '../../../electron/services/waitClassifier';
import type { ChatSettings, ChatState } from '../../../src/lib/chat/types';
import type { ChatMirror } from './chatMirror';
import { defaultProviderOf, type Connection } from './connection';

type Provider = ChatSettings['provider'];

export interface ChatHostProps {
  chatId: string;
  projectPath: string;
  /** The connection this chat is read through (closed through it, whatever window.sai points at later). */
  conn: Pick<Connection, 'sai' | 'mirror'>;
  /** The desktop's phone-visible settings (defaults: aiProvider and the nested claude/codex/gemini/kimi objects; per-workspace claude overrides don't cross). */
  appSettings: Record<string, unknown>;
}

/** The chat's mirrored state (null until the panel's first open resolves). */
export function useMirroredState(mirror: ChatMirror, chatId: string | null): ChatState | null {
  const subscribe = useCallback((cb: () => void) => (chatId ? mirror.subscribe(chatId, cb) : () => {}), [mirror, chatId]);
  return useSyncExternalStore(subscribe, () => (chatId ? mirror.get(chatId) : null));
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback);
/** A nested provider-defaults object from app.settings (`claude`, `codex`, `gemini`, `kimi`). */
const nested = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const noop = () => {};
const EMPTY_TABS: never[] = [];

/** A provider's model list from models.list (the desktop IPC returns `{ models }`). */
function modelsOf(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  const m = (raw as { models?: unknown } | null)?.models;
  return Array.isArray(m) ? m : [];
}

/** ChatState.waiting → ChatPanel's `waiting` prop. */
export function waitingProp(state: ChatState | null): { wait: WaitMeta; startedAtMs: number } | null {
  const w = state?.waiting;
  if (!w) return null;
  return {
    wait: { kind: w.kind, resumeInSeconds: w.resumeInSeconds ?? null, taskCount: w.taskCount ?? null },
    startedAtMs: w.since,
  };
}

/** ChatState.followUp → ChatPanel's `followUp` prop. */
export function followUpProp(state: ChatState | null): { state: 'following' | 'resuming' | 'stalled'; waitingFor: string | null } | null {
  const f = state?.followUp;
  return f ? { state: f.state, waitingFor: f.waitingFor ?? null } : null;
}

export function ChatHost({ chatId, projectPath, conn, appSettings }: ChatHostProps) {
  const state = useMirroredState(conn.mirror, chatId);
  // A chat with no log yet: the mirror reduced it from the same default provider.
  const provider: Provider = state?.settings.provider ?? defaultProviderOf(appSettings);

  // Stop following the chat when it's switched away or the host unmounts,
  // on this chat's own connection (after a machine switch window.sai reaches
  // the new one). chatlog.close settles the shim's pending opens and drops
  // the mirror; a raw unsubscribe would do neither.
  const chatlog = conn.sai.chatlog;
  useEffect(() => () => { chatlog?.close?.(chatId); }, [chatlog, chatId]);

  // Model lists, per provider, fetched once the provider is known.
  const [models, setModels] = useState<Partial<Record<Provider, any[]>>>({});
  useEffect(() => {
    if (models[provider]) return;
    let alive = true;
    const fn = window.sai?.[`${provider}Models`] as (() => Promise<unknown>) | undefined;
    if (typeof fn !== 'function') return;
    Promise.resolve(fn()).then((r) => {
      if (alive) setModels((m) => ({ ...m, [provider]: modelsOf(r) }));
    }, () => { /* the composer keeps its built-in defaults */ });
    return () => { alive = false; };
  }, [provider, models]);

  // chat.background → the chat's background tasks.
  const [tasks, setTasks] = useState<BackgroundTaskDetail[]>([]);
  useEffect(() => {
    setTasks([]);
    const off = window.sai?.claudeOnBackgroundTasks?.((p: { scope: string; tasks: BackgroundTaskDetail[] }) => {
      if (p?.scope === chatId) setTasks(Array.isArray(p.tasks) ? p.tasks : []);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [chatId]);

  // A dismissed follow-up row stays hidden until the next verdict.
  const [dismissedFollowUp, setDismissedFollowUp] = useState<unknown>(null);
  const followUp = state?.followUp && state.followUp !== dismissedFollowUp && provider === 'claude' ? followUpProp(state) : null;

  const renderToolCall = useMemo(() => renderToolCallFor(projectPath, noop), [projectPath]);
  const waiting = useMemo(() => waitingProp(state), [state?.waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveCount = tasks.filter((t) => !isTerminalDetail(t)).length;
  const s = appSettings;

  return (
    <div className="sai-phone-chat" data-testid="chat-host" data-chat-id={chatId}>
      <ChatPanel
        key={chatId}
        projectPath={projectPath}
        claudeScope={chatId}
        sessionId={chatId}
        aiProvider={provider}
        permissionMode={(nested(s.claude).permission === 'bypass' ? 'bypass' : 'default')}
        onPermissionChange={noop}
        effortLevel={str(nested(s.claude).effort, 'high') as 'high'}
        onEffortChange={noop}
        modelChoice={str(nested(s.claude).model, 'sonnet')}
        onModelChange={noop}
        availableModels={models.claude}
        renderToolCall={renderToolCall}
        codexModel={str(nested(s.codex).model, '')}
        onCodexModelChange={noop}
        codexModels={models.codex ?? EMPTY_TABS}
        codexPermission={str(nested(s.codex).permission, 'auto') as 'auto'}
        onCodexPermissionChange={noop}
        codexEffort={str(nested(s.codex).effort, 'high') as 'high'}
        onCodexEffortChange={noop}
        geminiModel={str(nested(s.gemini).model, '')}
        onGeminiModelChange={noop}
        geminiModels={models.gemini ?? EMPTY_TABS}
        geminiApprovalMode={str(nested(s.gemini).approvalMode, 'default') as 'default'}
        onGeminiApprovalModeChange={noop}
        geminiConversationMode={str(nested(s.gemini).conversationMode, 'planning') as 'planning'}
        onGeminiConversationModeChange={noop}
        kimiModel={str(nested(s.kimi).model, 'kimi-k3')}
        onKimiModelChange={noop}
        kimiModels={models.kimi ?? EMPTY_TABS}
        kimiApprovalMode={str(nested(s.kimi).approvalMode, 'default') as 'default'}
        onKimiApprovalModeChange={noop}
        activeFilePath={null}
        onFileOpen={noop}
        isActive
        isStreaming={state?.turn.streaming ?? false}
        waiting={waiting}
        followUp={followUp}
        onDismissFollowUp={() => setDismissedFollowUp(state?.followUp ?? null)}
        awaitingQuestion={state?.awaitingQuestion ?? false}
        liveBackgroundTaskCount={liveCount}
        backgroundTasks={provider === 'claude' ? tasks : undefined}
        onStopBackgroundTask={(taskId: string) => window.sai?.claudeStopTask?.(projectPath, chatId, taskId) ?? Promise.resolve(false)}
        terminalTabs={EMPTY_TABS}
        onSlashCommandsUpdate={noop}
      />
    </div>
  );
}
