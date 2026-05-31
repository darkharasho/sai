import { useEffect, useRef, useState } from 'react';
import { View, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useWorkspaces } from '../../../lib/workspaceStore';
import { TerminalView, type TerminalHandle } from '../../../components/TerminalView';
import type { WireMsg } from '../../../lib/wire';

export default function TerminalScreen() {
  const { machine, client, state } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [termId, setTermId] = useState<number | null>(null);
  const termRef = useRef<TerminalHandle>(null);

  // Pick the first terminal for the active workspace (or create-by-attach semantics handled by desktop).
  useEffect(() => {
    if (!client || state !== 'open' || !active) return;
    (async () => {
      const list = await client.listTerminals(active.projectPath).catch(() => []);
      const first = (list as any[]).find((x) => x.alive) ?? null;
      if (first) setTermId(first.termId);
    })();
  }, [client, state, active?.projectPath]);

  // Forward terminal.output to webview (PWA wire emits `terminal.output`).
  useEffect(() => {
    if (!client) return;
    return client.on((m: WireMsg) => {
      if (m.type === 'terminal.output' && m.termId === termId && typeof m.data === 'string') {
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
            client.attachTerminal(termId, cols, rows).catch(() => {});
          }}
          onInput={(data) => { if (client) client.inputTerminal(termId, data); }}
          onResize={(cols, rows) => { if (client) client.resizeTerminal(termId, cols, rows); }}
        />
      )}
    </KeyboardAvoidingView>
  );
}
