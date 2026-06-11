import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, Folder, Menu } from 'lucide-react-native';
import { useConn } from '../../../lib/connection';
import { useTranscript, transcriptKey, type TranscriptEvent } from '../../../lib/transcriptStore';
import { useWorkspaces, type Workspace } from '../../../lib/workspaceStore';
import { Transcript } from '../../../components/Transcript';
import { Composer, type SessionOverrides } from '../../../components/Composer';
import { WorkspacePicker } from '../../../components/WorkspacePicker';
import { NavDrawer } from '../../../components/NavDrawer';
import { workspaceStatusStore, type WorkspaceStatus } from '../../../lib/workspaceStatusStore';
import { githubWatcherStore } from '../../../lib/githubWatcherStore';
import type { WireMsg } from '../../../lib/wire';

const EMPTY_EVENTS: TranscriptEvent[] = [];

export default function Chat() {
  const { machine, client, state } = useConn();
  const setWorkspaces = useWorkspaces((s) => s.setWorkspaces);
  const setActiveWs = useWorkspaces((s) => s.setActive);
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  // Empty sessionId == "no explicit session selected". The PWA uses this
  // sentinel (see ConnectedShell/onPick in App.tsx + Chat.tsx) — the bridge
  // mints a fresh session on first prompt and announces it via session.active,
  // which we then mirror into local state. Sending the literal string
  // 'default' as a sessionId routes prompts into a phantom "default" session
  // the desktop never opens, so messages never reach the desktop chat.
  const [sessionId, setSessionId] = useState<string>(() => '');
  // Follow toggle — PWA defaults to true so the desktop's active session
  // change is mirrored to the mobile UI. Kept here even without UI yet
  // because the wire layer's setFollow is the source of truth.
  const [follow, setFollow] = useState(true);
  const [overrides, setOverrides] = useState<SessionOverrides>({});
  const [streaming, setStreaming] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [wsPickerOpen, setWsPickerOpen] = useState(false);

  const tkey = useMemo(
    () => transcriptKey(machine.machineId, active?.projectPath ?? '_', sessionId),
    [machine.machineId, active?.projectPath, sessionId]
  );
  const events = useTranscript((s) => s.byKey[tkey] ?? EMPTY_EVENTS);
  const append = useTranscript((s) => s.append);

  // Load workspaces once connected (over the WS, not REST).
  useEffect(() => {
    if (!client || state !== 'open') return;
    (async () => {
      const raw = await client.listWorkspaces();
      const ws = (raw as any[]).map((w) => ({
        projectPath: w.projectPath ?? w.path,
        label: w.label ?? w.name ?? w.projectPath,
        scope: w.scope,
        kind: w.kind,
        members: w.members,
      }));
      setWorkspaces(machine.machineId, ws);
    })().catch(() => { /* surface in UI later */ });
  }, [client, state, machine.machineId, setWorkspaces]);

  // Attach + subscribe on (re)connect or workspace change.
  useEffect(() => {
    if (!client || state !== 'open' || !active) return;
    let cancelled = false;
    client.setActiveWorkspace(active.projectPath);
    client.subscribeWorkspaceStatus();
    client.subscribeGithubWatcher();
    client.setFollow(follow);

    if (sessionId) {
      // Already have a session — attach directly.
      client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId });
    } else {
      // No session yet — fetch the most recent one from the desktop and attach.
      (async () => {
        try {
          const sessions = await client.listSessions(active.projectPath) as any[];
          if (cancelled) return;
          const latest = sessions[0];
          const sid = (latest as any)?.id ?? '';
          if (sid) setSessionId(sid);
          // Attach even with empty sid to set __attachedTopic on the bridge.
          client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId: sid });
        } catch {
          // Fallback: attach with empty session so at least new messages flow.
          if (!cancelled) client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId: '' });
        }
      })();
    }

    return () => {
      cancelled = true;
      try { client.unsubscribeGithubWatcher(); } catch { /* ignore */ }
      try { client.unsubscribeWorkspaceStatus(); } catch { /* ignore */ }
    };
  }, [client, state, active?.projectPath, active?.scope, sessionId, follow]);

  // Inbound transcript — mirror the PWA's event names (Chat.tsx).
  useEffect(() => {
    if (!client) return;
    const off = client.on((m: WireMsg) => {
      const t = m.type;
      if (t === 'workspace.status') {
        // Route into the shared status store. Mirrors App.tsx in the PWA.
        const pp = (m as any).projectPath as string | undefined;
        const status = (m as any).status as WorkspaceStatus | undefined;
        if (pp && status) workspaceStatusStore.set(pp, status);
        return;
      }
      if (t === 'github.watcher') {
        const messageId = (m as any).messageId as string | undefined;
        const url = (m as any).url as string | undefined;
        const snapshot = (m as any).snapshot;
        if (messageId && url && snapshot) githubWatcherStore.set(messageId, url, snapshot);
        return;
      }
      if (t === 'streaming_start') { setStreaming(true); return; }
      if (t === 'result' || t === 'done') {
        setStreaming(false);
        // Stamp duration on the last assistant event so the bubble can show
        // the desktop's `[Nms]` tag. Only `result` carries duration_ms.
        if (t === 'result' && typeof (m as any).duration_ms === 'number') {
          const ms = (m as any).duration_ms as number;
          const list = useTranscript.getState().byKey[tkey] ?? [];
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].type === 'assistant') {
              append(tkey, { ...list[i], durationMs: ms });
              break;
            }
          }
        }
        return;
      }
      if (t === 'session.active') {
        // PWA pattern: when follow is on, the desktop driving a session
        // change updates our active session. Additionally, if our local
        // sessionId is the empty sentinel (a brand-new chat the bridge just
        // minted on first prompt), always adopt the server's id so
        // subsequent attaches/prompts route correctly.
        const projectPath = (m as any).projectPath as string | undefined;
        const sid = (m as any).sessionId as string | undefined;
        if (follow || !sessionId) {
          if (sid) setSessionId(sid);
          if (projectPath && projectPath !== active?.projectPath) {
            const list = useWorkspaces.getState().workspacesByMachine[machine.machineId] ?? [];
            const next = list.find((w) => w.projectPath === projectPath);
            if (next) setActiveWs(machine.machineId, next);
          }
        }
        return;
      }
      if (t === 'assistant') {
        const content = (m as any).message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === 'text' && typeof b.text === 'string' && b.text.length) {
              append(tkey, { id: 'assistant-current', type: 'assistant', text: b.text });
            } else if (b?.type === 'tool_use' && typeof b.id === 'string') {
              append(tkey, {
                id: `tool-${b.id}`, type: 'tool_use',
                toolName: b.name ?? 'tool', toolInput: b.input, toolUseId: b.id,
              });
            }
          }
        } else if (typeof (m as any).text === 'string' && (m as any).text.length) {
          append(tkey, {
            id: String((m as any).id ?? 'assistant-current'),
            type: 'assistant',
            text: (m as any).text as string,
          });
        }
      } else if (t === 'user') {
        const content = (m as any).message?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
              const resultText = typeof b.content === 'string'
                ? b.content
                : Array.isArray(b.content)
                  ? b.content.map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
                  : JSON.stringify(b.content);
              append(tkey, {
                id: `result-${b.tool_use_id}`, type: 'tool_result',
                toolUseId: b.tool_use_id, toolResult: resultText,
              });
            }
          }
        }
      } else if (t === 'user_message') {
        const text = (m as any).text as string | undefined;
        append(tkey, {
          id: String((m as any).id ?? `u-${Date.now()}`),
          type: 'user',
          text,
        });
      } else if (t === 'ask.question') {
        // Standalone ask.question frame (non-tool_use path) — render as a
        // question event. Matches PWA's AskUserQuestion tool handling.
        const toolUseId = String((m as any).toolUseId ?? `q-${Date.now()}`);
        append(tkey, {
          id: `question-${toolUseId}`, type: 'question',
          toolName: 'AskUserQuestion',
          toolInput: (m as any).input ?? { questions: (m as any).questions },
          toolUseId,
        });
      } else if (t === 'approval_needed') {
        const toolUseId = String((m as any).toolUseId);
        append(tkey, {
          id: `approval-${toolUseId}`, type: 'approval',
          toolName: (m as any).toolName as string ?? 'tool',
          toolInput: (m as any).input ?? { command: (m as any).command },
          toolUseId,
        });
      }
    });
    return () => { off(); };
  }, [client, tkey, append, follow, sessionId, machine.machineId, active?.projectPath, setActiveWs]);

  const onPickWorkspace = (w: Workspace) => {
    if (!client) return;
    setActiveWs(machine.machineId, w);
    client.setActiveWorkspace(w.projectPath);
    // When not following, also reset session for the new workspace.
    // Empty sentinel = "new session" — see note on sessionId state init.
    if (!follow) setSessionId('');
  };

  const onAttachSession = (projectPath: string, sid: string) => {
    if (!client) return;
    // Resolve the workspace by projectPath so subsequent prompts go to the
    // right scope. Falls back to the current active if not found.
    const list = useWorkspaces.getState().workspacesByMachine[machine.machineId] ?? [];
    const next = list.find((w) => w.projectPath === projectPath) ?? active;
    if (next && next.projectPath !== active?.projectPath) {
      setActiveWs(machine.machineId, next);
    }
    setSessionId(sid);
    client.attach({
      projectPath,
      scope: next?.scope ?? 'chat',
      sessionId: sid,
    });
  };

  return (
    // No KeyboardAvoidingView here: Composer applies its own bottom padding
    // via a keyboard listener (the same approach TerminalInput uses) because
    // KAV doesn't compose well with expo-router's bottom Tabs on iOS — the
    // tab bar height pushed the input panel below the keyboard.
    <View style={{ flex: 1, backgroundColor: '#0e1114' }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, paddingVertical: 6,
        borderBottomWidth: 1, borderBottomColor: '#1e2228', backgroundColor: '#0c0f11',
      }}>
        <Pressable
          onPress={() => setNavOpen(true)}
          hitSlop={8}
          style={{
            width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: '#1e2228', borderRadius: 6,
          }}
        >
          <Menu size={16} color="#bec6d0" />
        </Pressable>
        <Pressable
          onPress={() => setWsPickerOpen(true)}
          hitSlop={4}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Folder size={12} color="#5a6a7a" strokeWidth={2} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: '#bec6d0' }}>
            {active?.label ?? 'No workspace'}
          </Text>
          <ChevronDown size={12} color="#5a6a7a" />
        </Pressable>
        <View style={{
          width: 8, height: 8, borderRadius: 4,
          backgroundColor: state === 'open' ? '#00a884' : state === 'opening' ? '#c7910c' : '#E35535',
        }} />
      </View>
      <WorkspacePicker
        machineId={machine.machineId}
        open={wsPickerOpen}
        onClose={() => setWsPickerOpen(false)}
        onPick={onPickWorkspace}
        currentProjectPath={active?.projectPath ?? null}
      />
      <NavDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        client={client}
        machineId={machine.machineId}
        workspacePath={active?.projectPath ?? null}
        currentSessionId={sessionId}
        followEnabled={follow}
        onFollowChange={(v) => {
          setFollow(v);
          client?.setFollow(v);
        }}
        onAttach={onAttachSession}
        onPickWorkspace={onPickWorkspace}
      />
      <View style={{ flex: 1 }}>
        <Transcript
          events={events}
          streaming={streaming}
          onApprove={(toolUseId, decision, modifiedCommand) => {
            if (!client || !active) return;
            client.approve({
              toolUseId, decision, modifiedCommand,
              projectPath: active.projectPath, scope: active.scope,
            });
          }}
          onAnswerQuestion={(toolUseId, answers) => {
            if (!client || !active) return;
            client.answerQuestion({
              toolUseId, answers,
              projectPath: active.projectPath, scope: active.scope,
            });
          }}
        />
      </View>
      <Composer
        streaming={streaming}
        disabled={state !== 'open' || !active}
        overrides={overrides}
        onOverridesChange={setOverrides}
        onSend={(text, images) => {
          if (!client || !active) return;
          // No optimistic user append — the server echoes the prompt back
          // as a `user_message` frame within ~100ms over the local LAN, and
          // appending here would double-post (see Bug 4). The composer
          // clears immediately on submit so the UI still feels responsive.
          client.sendPrompt({
            text,
            projectPath: active.projectPath,
            scope: active.scope,
            model: overrides.model,
            effort: overrides.effort,
            permMode: overrides.permMode,
            sessionId: sessionId || undefined,
            images,
          });
          setStreaming(true);
        }}
        onInterrupt={() => {
          if (!client || !active) return;
          client.interrupt(active.projectPath, active.scope);
        }}
      />
    </View>
  );
}
