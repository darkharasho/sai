import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useTranscript, transcriptKey, type TranscriptEvent } from '../../../lib/transcriptStore';
import { useWorkspaces, type Workspace } from '../../../lib/workspaceStore';
import { Transcript } from '../../../components/Transcript';
import { Composer, type SessionOverrides } from '../../../components/Composer';
import { WorkspaceHeader } from '../../../components/WorkspaceHeader';
import { workspaceStatusStore, type WorkspaceStatus } from '../../../lib/workspaceStatusStore';
import { uuid } from '../../../shims/uuid';
import type { WireMsg } from '../../../lib/wire';

const EMPTY_EVENTS: TranscriptEvent[] = [];

export default function Chat() {
  const { machine, client, state } = useConn();
  const setWorkspaces = useWorkspaces((s) => s.setWorkspaces);
  const setActiveWs = useWorkspaces((s) => s.setActive);
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [sessionId, setSessionId] = useState<string>(() => 'default');
  // Follow toggle — PWA defaults to true so the desktop's active session
  // change is mirrored to the mobile UI. Kept here even without UI yet
  // because the wire layer's setFollow is the source of truth.
  const [follow, setFollow] = useState(true);
  const [overrides, setOverrides] = useState<SessionOverrides>({});
  const [streaming, setStreaming] = useState(false);

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
      }));
      setWorkspaces(machine.machineId, ws);
    })().catch(() => { /* surface in UI later */ });
  }, [client, state, machine.machineId, setWorkspaces]);

  // Attach + subscribe on (re)connect or workspace change.
  useEffect(() => {
    if (!client || state !== 'open' || !active) return;
    client.setActiveWorkspace(active.projectPath);
    client.subscribeWorkspaceStatus();
    client.setFollow(follow);
    client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId });
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
      if (t === 'streaming_start') { setStreaming(true); return; }
      if (t === 'result' || t === 'done') { setStreaming(false); return; }
      if (t === 'session.active' && follow) {
        // PWA pattern: when follow is on, the desktop driving a session
        // change updates our active session.
        const projectPath = (m as any).projectPath as string | undefined;
        const sid = (m as any).sessionId as string | undefined;
        if (sid) setSessionId(sid);
        // setActive on workspace store only if it changes.
        if (projectPath && projectPath !== active?.projectPath) {
          const list = useWorkspaces.getState().workspacesByMachine[machine.machineId] ?? [];
          const next = list.find((w) => w.projectPath === projectPath);
          if (next) setActiveWs(machine.machineId, next);
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
  }, [client, tkey, append, follow, machine.machineId, active?.projectPath, setActiveWs]);

  const onPickWorkspace = (w: Workspace) => {
    if (!client) return;
    setActiveWs(machine.machineId, w);
    client.setActiveWorkspace(w.projectPath);
    // When not following, also reset session to default for the new workspace.
    if (!follow) setSessionId('default');
  };

  // Mark follow used so TS doesn't complain (also gives us a path for the
  // NavDrawer to toggle this later).
  void setFollow;

  return (
    <View style={{ flex: 1, backgroundColor: '#0e1114' }}>
      <WorkspaceHeader
        machineId={machine.machineId}
        onOpenNav={() => { /* M11: NavDrawer opens here */ }}
        onPick={onPickWorkspace}
      />
      <View style={{ flex: 1 }}>
        <Transcript
          events={events}
          streaming={streaming}
          onApprove={(toolUseId, decision) => {
            if (!client || !active) return;
            client.approve({
              toolUseId, decision,
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
          const id = uuid();
          append(tkey, { id, type: 'user', text, images });
          client.sendPrompt({
            text,
            projectPath: active.projectPath,
            scope: active.scope,
            model: overrides.model,
            effort: overrides.effort,
            permMode: overrides.permMode,
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
