import { useEffect, useRef, useState } from 'react';
import { View, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useWorkspaces } from '../../../lib/workspaceStore';
import { TerminalView, type TerminalHandle } from '../../../components/TerminalView';
import { api, termInput, termResize, termAttach } from '../../../lib/wire';
import { useMachines } from '../../../lib/machinesStore';
import type { WireMsg } from '../../../lib/types';

export default function TerminalScreen() {
  const { machine, client, state } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const getToken = useMachines((s) => s.getToken);
  const [termId, setTermId] = useState<number | null>(null);
  const termRef = useRef<TerminalHandle>(null);

  // Pick the first terminal for the active workspace (or create-by-attach semantics handled by desktop).
  useEffect(() => {
    if (state !== 'open' || !active) return;
    (async () => {
      const t = await getToken(machine.machineId);
      if (!t) return;
      const list = await api.listTerminals(machine.hostUrl, t, active.projectPath).catch(() => []);
      const first = (list as any[]).find((x) => x.alive) ?? null;
      if (first) setTermId(first.termId);
    })();
  }, [state, active?.projectPath, machine.hostUrl, machine.machineId, getToken]);

  // Forward term:data to webview
  useEffect(() => {
    if (!client) return;
    return client.on((m: WireMsg) => {
      if (m.type === 'term:data' && m.termId === termId && typeof m.data === 'string') {
        termRef.current?.write(m.data);
      }
    });
  }, [client, termId]);

  if (!active) {
    return <View className="flex-1 bg-[#0e1114] items-center justify-center"><Text className="text-[#a0acbb]">Pick a workspace in Chat first.</Text></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#0e1114' }}>
      {termId == null ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-[#a0acbb] mb-3">No active terminal.</Text>
        </View>
      ) : (
        <TerminalView
          ref={termRef}
          onReady={(cols, rows) => {
            if (!client) return;
            termAttach(client, termId, cols, rows);
          }}
          onInput={(data) => { if (client) termInput(client, termId, data); }}
          onResize={(cols, rows) => { if (client) termResize(client, termId, cols, rows); }}
        />
      )}
    </KeyboardAvoidingView>
  );
}
