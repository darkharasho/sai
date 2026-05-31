// Terminal surface: toolbar (picker + new + kill) on top, xterm.js WebView below.
// Mirrors src/renderer-remote/terminal/Terminal.tsx wiring; reuses TerminalView
// (a thin WebView host) plus the new TerminalToolbar + TerminalPicker.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useWorkspaces } from '../../../lib/workspaceStore';
import { TerminalView, type TerminalHandle } from '../../../components/TerminalView';
import { TerminalInput } from '../../../components/TerminalInput';
import TerminalToolbar from '../../../components/TerminalToolbar';
import TerminalPicker, { type TerminalSummary } from '../../../components/TerminalPicker';
import type { WireMsg } from '../../../lib/wire';

const C = {
  bgPrimary: '#0e1114',
  textMuted: '#5a6a7a',
};

export default function TerminalScreen() {
  const { machine, client, state } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [term, setTerm] = useState<TerminalSummary | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyNew, setBusyNew] = useState(false);
  const [busyKill, setBusyKill] = useState(false);
  const termRef = useRef<TerminalHandle>(null);
  // Guard against duplicate openTerminal() calls (re-renders, double-tap, or
  // races between list-empty auto-open and an explicit Plus tap).
  const openingRef = useRef(false);

  const cwd = active?.projectPath ?? null;

  // Auto-pick the first alive terminal for this workspace once connected.
  // Note: we deliberately do NOT call openTerminal here. The picker / Plus
  // button are the only paths that create terminals — this avoids the
  // "phantom 2nd terminal" bug where mount-time openTerminal duplicated
  // the desktop's already-running PTY.
  useEffect(() => {
    if (!client || state !== 'open' || !cwd) return;
    (async () => {
      const list = await client.listTerminals(cwd).catch(() => [] as TerminalSummary[]);
      const first = (list as TerminalSummary[]).find((x) => x.alive) ?? null;
      if (first && !term) setTerm(first);
    })();
  }, [client, state, cwd, term]);

  // Forward terminal.output to the WebView for the active term.
  useEffect(() => {
    if (!client || !term) return;
    return client.on((m: WireMsg) => {
      if (m.type === 'terminal.output' && (m as { termId?: number }).termId === term.termId) {
        const data = (m as { data?: string }).data;
        if (typeof data === 'string') termRef.current?.write(data);
      }
    });
  }, [client, term]);

  const onNew = useCallback(async () => {
    if (!client || !cwd) return;
    if (openingRef.current) return; // prevent double-fire (rapid taps / races)
    openingRef.current = true;
    setBusyNew(true);
    try {
      const r = await client.openTerminal(cwd, 80, 24);
      setTerm({
        termId: r.termId, cwd, cols: r.cols, rows: r.rows,
        alive: true, origin: 'phone',
      });
    } catch { /* surfaced elsewhere */ }
    finally {
      setBusyNew(false);
      openingRef.current = false;
    }
  }, [client, cwd]);

  const onKill = useCallback(async () => {
    if (!client || !term) return;
    setBusyKill(true);
    try {
      await client.killTerminal(term.termId);
      setTerm(null);
    } catch { /* ignore */ }
    finally { setBusyKill(false); }
  }, [client, term]);

  const onPickFromSheet = useCallback((picked: TerminalSummary) => {
    setTerm(picked);
    setPickerOpen(false);
  }, []);

  const onKillFromSheet = useCallback(async (picked: TerminalSummary) => {
    if (!client) return;
    try { await client.killTerminal(picked.termId); }
    catch { /* ignore */ }
    if (term?.termId === picked.termId) setTerm(null);
  }, [client, term]);

  if (!active) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgPrimary }}>
        <Text style={{ color: C.textMuted }}>Pick a workspace in Chat first.</Text>
      </View>
    );
  }

  return (
    // No KeyboardAvoidingView here: TerminalInput owns its own keyboard
    // listener and applies bottom padding to lift itself above the keyboard.
    // KAV doesn't compose well with react-navigation's bottom Tabs on iOS.
    <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
      <TerminalToolbar
        termId={term?.termId ?? null}
        termCwd={term?.cwd}
        origin={term?.origin}
        onOpenPicker={() => setPickerOpen(true)}
        onNew={onNew}
        onKill={onKill}
        busyNew={busyNew}
        busyKill={busyKill}
      />
      {term == null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.textMuted, marginBottom: 12 }}>
            No active terminal.
          </Text>
        </View>
      ) : (
        <>
          <TerminalView
            key={term.termId}
            ref={termRef}
            onReady={(cols, rows) => {
              if (!client) return;
              client.attachTerminal(term.termId, cols, rows).catch(() => {});
            }}
            onResize={(cols, rows) => { if (client) client.resizeTerminal(term.termId, cols, rows); }}
          />
          <TerminalInput
            disabled={!client}
            onInput={(data) => { if (client) client.inputTerminal(term.termId, data); }}
          />
        </>
      )}
      <TerminalPicker
        open={pickerOpen}
        client={client}
        cwd={cwd ?? ''}
        currentTermId={term?.termId ?? null}
        onClose={() => setPickerOpen(false)}
        onPick={onPickFromSheet}
        onKill={onKillFromSheet}
      />
    </View>
  );
}
