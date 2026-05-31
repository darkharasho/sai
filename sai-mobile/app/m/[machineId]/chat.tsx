import { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useTranscript, transcriptKey } from '../../../lib/transcriptStore';
import { useWorkspaces } from '../../../lib/workspaceStore';
import { Transcript } from '../../../components/Transcript';
import { Composer } from '../../../components/Composer';
import { WorkspacePicker } from '../../../components/WorkspacePicker';
import { uuid } from '../../../shims/uuid';
import { api, sendPrompt, attachToSession, setActiveWorkspace, subscribeWorkspaceStatus } from '../../../lib/wire';
import type { WireMsg } from '../../../lib/types';

export default function Chat() {
  const { machine, client, state } = useConn();
  const setWorkspaces = useWorkspaces((s) => s.setWorkspaces);
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [sessionId, setSessionId] = useState<string>(() => 'default');
  const tkey = useMemo(() => transcriptKey(machine.machineId, active?.projectPath ?? '_', sessionId), [machine.machineId, active?.projectPath, sessionId]);
  const events = useTranscript((s) => s.byKey[tkey] ?? []);
  const append = useTranscript((s) => s.append);

  // Load workspaces once connected
  useEffect(() => {
    if (state !== 'open') return;
    (async () => {
      const tok = (await import('../../../lib/machinesStore')).useMachines.getState().getToken;
      const t = await tok(machine.machineId);
      if (!t) return;
      const raw = await api.listWorkspaces(machine.hostUrl, t);
      const ws = (raw as any[]).map(w => ({ projectPath: w.projectPath ?? w.path, label: w.label ?? w.name ?? w.projectPath, scope: w.scope }));
      setWorkspaces(machine.machineId, ws);
    })().catch(() => {});
  }, [state, machine.hostUrl, machine.machineId, setWorkspaces]);

  // Attach + subscribe on (re)connect or workspace change
  useEffect(() => {
    if (!client || state !== 'open' || !active) return;
    setActiveWorkspace(client, active.projectPath);
    subscribeWorkspaceStatus(client);
    attachToSession(client, { projectPath: active.projectPath, scope: active.scope, sessionId });
  }, [client, state, active?.projectPath, active?.scope, sessionId]);

  // Inbound transcript
  useEffect(() => {
    if (!client) return;
    const off = client.on((m: WireMsg) => {
      const text = m.text as string | undefined;
      if (m.type === 'chat:user') {
        append(tkey, { id: String(m.id ?? uuid()), type: 'user', text });
      } else if (m.type === 'chat:assistant' || m.type === 'chat:delta') {
        append(tkey, { id: String(m.id ?? 'assistant-current'), type: 'assistant', text });
      } else if (m.type === 'tool:use') {
        append(tkey, {
          id: String(m.toolUseId ?? uuid()), type: 'tool_use',
          toolName: m.name as string, toolInput: m.input, toolUseId: m.toolUseId as string,
        });
      } else if (m.type === 'tool:result') {
        append(tkey, {
          id: `result-${m.toolUseId}`, type: 'tool_result',
          toolUseId: m.toolUseId as string, toolResult: m.result,
        });
      } else if (m.type === 'approval:request') {
        append(tkey, {
          id: `approval-${m.toolUseId}`, type: 'approval',
          toolName: m.name as string, toolInput: m.input, toolUseId: m.toolUseId as string,
        });
      }
    });
    return () => { off(); };
  }, [client, tkey, append]);

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        <WorkspacePicker machineId={machine.machineId} />
        <Text className="text-[#5a6a7a] text-xs flex-1" numberOfLines={1}>session: {sessionId}</Text>
      </View>
      <View className="flex-1">
        <Transcript
          events={events}
          onApprove={(toolUseId, decision) => {
            if (!client || !active) return;
            import('../../../lib/wire').then(({ sendApproval }) => {
              sendApproval(client, { toolUseId, decision, projectPath: active.projectPath, scope: active.scope });
            });
          }}
        />
      </View>
      <Composer
        disabled={state !== 'open' || !active}
        onSend={(text, images) => {
          if (!client || !active) return;
          const id = uuid();
          append(tkey, { id, type: 'user', text, images });
          sendPrompt(client, {
            text, projectPath: active.projectPath, scope: active.scope, images,
          });
        }}
      />
    </View>
  );
}
