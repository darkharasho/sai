import { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useTranscript, transcriptKey, type TranscriptEvent } from '../../../lib/transcriptStore';

const EMPTY_EVENTS: TranscriptEvent[] = [];
import { useWorkspaces } from '../../../lib/workspaceStore';
import { Transcript } from '../../../components/Transcript';
import { Composer } from '../../../components/Composer';
import { WorkspacePicker } from '../../../components/WorkspacePicker';
import { uuid } from '../../../shims/uuid';
import type { WireMsg } from '../../../lib/wire';

export default function Chat() {
  const { machine, client, state } = useConn();
  const setWorkspaces = useWorkspaces((s) => s.setWorkspaces);
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [sessionId, setSessionId] = useState<string>(() => 'default');
  const tkey = useMemo(() => transcriptKey(machine.machineId, active?.projectPath ?? '_', sessionId), [machine.machineId, active?.projectPath, sessionId]);
  const events = useTranscript((s) => s.byKey[tkey] ?? EMPTY_EVENTS);
  const append = useTranscript((s) => s.append);

  // Load workspaces once connected (over the WS, not REST).
  useEffect(() => {
    if (!client || state !== 'open') return;
    (async () => {
      const raw = await client.listWorkspaces();
      const ws = (raw as any[]).map(w => ({ projectPath: w.projectPath ?? w.path, label: w.label ?? w.name ?? w.projectPath, scope: w.scope }));
      setWorkspaces(machine.machineId, ws);
    })().catch(() => {});
  }, [client, state, machine.machineId, setWorkspaces]);

  // Attach + subscribe on (re)connect or workspace change
  useEffect(() => {
    if (!client || state !== 'open' || !active) return;
    client.setActiveWorkspace(active.projectPath);
    client.subscribeWorkspaceStatus();
    client.attach({ projectPath: active.projectPath, scope: active.scope, sessionId });
  }, [client, state, active?.projectPath, active?.scope, sessionId]);

  // Inbound transcript — mirror the PWA's event names (Chat.tsx).
  // SDK shape: `assistant` carries blocks (text + tool_use); `user` carries
  // tool_result blocks; `user_message` is the remote-origin echo; `result`
  // and `done` finalize streaming; `approval_needed` triggers an approval card.
  useEffect(() => {
    if (!client) return;
    const off = client.on((m: WireMsg) => {
      const t = m.type;
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
          append(tkey, { id: String((m as any).id ?? 'assistant-current'), type: 'assistant', text: (m as any).text as string });
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
        append(tkey, { id: String((m as any).id ?? `u-${Date.now()}`), type: 'user', text });
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
            client.approve({ toolUseId, decision, projectPath: active.projectPath, scope: active.scope });
          }}
        />
      </View>
      <Composer
        disabled={state !== 'open' || !active}
        onSend={(text, images) => {
          if (!client || !active) return;
          const id = uuid();
          append(tkey, { id, type: 'user', text, images });
          client.sendPrompt({
            text, projectPath: active.projectPath, scope: active.scope, images,
          });
        }}
      />
    </View>
  );
}
