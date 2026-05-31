// Git changes (staged + unstaged), per-row stage/unstage, top-bar commit/push/pull.
// Mirrors src/renderer-remote/files/ChangesView.tsx + Git.tsx, RN-ified.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { router } from 'expo-router';
import {
  ArrowDown, ArrowUp, Check, ChevronLeft, GitBranch, GitCommit, X,
} from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import DiffViewer from '../../../../components/DiffViewer';
import RepoPicker, { type RepoMember } from '../../../../components/RepoPicker';
import type { WireClient, WireMsg } from '../../../../lib/wire';
import { FONT } from '../../../../lib/fonts';

const C = {
  bgPrimary: '#0e1114',
  bgSecondary: '#0c0f11',
  bgMid: '#13171b',
  bgElevated: '#13171b',
  bgInput: '#0a0d10',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#4ade80',
  red: '#E35535',
  orange: '#f59e0b',
  blue: '#3b82f6',
  overlay: 'rgba(0,0,0,0.55)',
  mono: FONT.mono,
};

interface StatusEntry { path: string; status: string; staged: boolean }

const STATUS_LABEL: Record<string, { letter: string; color: string }> = {
  modified: { letter: 'M', color: C.orange },
  added:    { letter: 'A', color: C.green },
  deleted:  { letter: 'D', color: C.red },
  renamed:  { letter: 'R', color: C.blue },
};

interface Note { id: string; text: string; kind: 'ok' | 'err' }

function useStatusHeader(client: WireClient | null, cwd: string | null) {
  const [branch, setBranch] = useState<string | null>(null);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const refresh = useCallback(async () => {
    if (!client || !cwd) return;
    try {
      const reqId = `gh${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const got: WireMsg = await new Promise((resolve, reject) => {
        const off = client.on((m: WireMsg) => {
          if (m && (m as { reqId?: string }).reqId === reqId) {
            off();
            if (m.type === 'files.status.result') resolve(m);
            else if (m.type === 'error') reject(new Error(String((m as { message?: string }).message ?? 'status failed')));
          }
        });
        client.send({ type: 'files.status', cwd, reqId });
        setTimeout(() => { off(); reject(new Error('status timeout')); }, 5000);
      });
      const g = got as { branch?: string; ahead?: number; behind?: number };
      setBranch(g.branch ?? null);
      setAhead(g.ahead ?? 0);
      setBehind(g.behind ?? 0);
    } catch {
      setBranch(null); setAhead(0); setBehind(0);
    }
  }, [client, cwd]);
  return { branch, ahead, behind, refresh };
}

interface RowProps {
  entry: StatusEntry;
  active: boolean;
  pending: boolean;
  onToggleStage: (entry: StatusEntry) => void;
  onSelect: (entry: StatusEntry) => void;
}

function ChangeRow({ entry, active, pending, onToggleStage, onSelect }: RowProps) {
  const meta = STATUS_LABEL[entry.status] ?? { letter: '?', color: C.textMuted };
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: active ? 'rgba(199,145,12,0.10)' : 'transparent',
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    }}>
      <Pressable
        onPress={() => onToggleStage(entry)}
        disabled={pending}
        accessibilityLabel={entry.staged ? `Unstage ${entry.path}` : `Stage ${entry.path}`}
        style={{
          width: 32, height: 36,
          alignItems: 'center', justifyContent: 'center',
          opacity: pending ? 0.5 : 1,
        }}
      >
        <View style={{
          width: 16, height: 16, borderRadius: 3,
          borderWidth: 1.5,
          borderColor: entry.staged ? C.accent : C.textMuted,
          backgroundColor: entry.staged ? C.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {entry.staged ? <Check size={11} color="#000" strokeWidth={3} /> : null}
        </View>
      </Pressable>
      <Pressable
        onPress={() => onSelect(entry)}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 8,
          paddingRight: 14,
        }}
      >
        <Text style={{
          width: 16,
          fontFamily: C.mono,
          fontWeight: '700',
          fontSize: 13,
          color: meta.color,
        }}>
          {meta.letter}
        </Text>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontFamily: C.mono, fontSize: 13, color: C.text }}
        >
          {entry.path}
        </Text>
      </Pressable>
    </View>
  );
}

export default function Changes() {
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const workspaces = useWorkspaces((s) => s.workspacesByMachine[machine.machineId] ?? []);
  const [cwd, setCwd] = useState<string | null>(active?.projectPath ?? null);
  const [entries, setEntries] = useState<StatusEntry[] | null>(null);
  const [selected, setSelected] = useState<StatusEntry | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingStagePath, setPendingStagePath] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ commit?: boolean; push?: boolean; pull?: boolean }>({});
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);

  const effectiveCwd = cwd ?? active?.projectPath ?? null;
  const { branch, ahead, behind, refresh: refreshHeader } = useStatusHeader(client, effectiveCwd);

  useEffect(() => { if (active && !cwd) setCwd(active.projectPath); }, [active, cwd]);

  useEffect(() => {
    if (!effectiveCwd || !client) return;
    setEntries(null);
    setErr(null);
    client.statusFiles(effectiveCwd)
      .then((e) => setEntries(e as StatusEntry[]))
      .catch((e: Error) => setErr(e.message));
    void refreshHeader();
  }, [client, effectiveCwd, refreshKey, refreshHeader]);

  useEffect(() => {
    if (!selected || !effectiveCwd || !client) return;
    setLoadingDiff(true);
    client.diffFile(effectiveCwd, selected.path, selected.staged)
      .then((r) => setDiff(r.diff ?? ''))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingDiff(false));
  }, [client, effectiveCwd, selected]);

  const stagedCount = useMemo(
    () => (entries ?? []).filter((e) => e.staged).length,
    [entries],
  );

  const isMeta = active?.kind === 'meta';
  const members: RepoMember[] = useMemo(() => {
    if (isMeta && active?.members && active.members.length > 0) {
      return active.members.map((m) => ({ projectPath: m.projectPath, name: m.name }));
    }
    return workspaces.map((w) => ({ projectPath: w.projectPath, name: w.label }));
  }, [isMeta, active?.members, workspaces]);

  const addNote = (text: string, kind: 'ok' | 'err') => {
    const n: Note = { id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, kind };
    setNotes((arr) => [...arr.slice(-2), n]);
    setTimeout(() => setNotes((arr) => arr.filter((x) => x.id !== n.id)), 5000);
  };

  const onToggleStage = async (e: StatusEntry) => {
    if (!client || !effectiveCwd) return;
    setPendingStagePath(e.path);
    try {
      if (e.staged) await client.unstageFile(effectiveCwd, e.path);
      else          await client.stageFile(effectiveCwd, e.path);
      setRefreshKey((k) => k + 1);
    } catch (err2) {
      addNote(`${e.staged ? 'unstage' : 'stage'} failed: ${(err2 as Error).message}`, 'err');
    } finally {
      setPendingStagePath(null);
    }
  };

  const onCommit = async () => {
    if (!client || !effectiveCwd) return;
    const msg = commitMessage.trim();
    if (!msg || stagedCount === 0 || busy.commit) return;
    setBusy((b) => ({ ...b, commit: true }));
    try {
      const r = await client.commit(effectiveCwd, msg);
      addNote(r.hash ? `committed ${String(r.hash).slice(0, 7)}` : 'committed', 'ok');
      setCommitMessage('');
      setCommitOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      addNote(`commit failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy((b) => ({ ...b, commit: false }));
    }
  };

  const onPush = async () => {
    if (!client || !effectiveCwd || busy.push) return;
    setBusy((b) => ({ ...b, push: true }));
    try { await client.push(effectiveCwd); addNote('pushed', 'ok'); setRefreshKey((k) => k + 1); }
    catch (e) { addNote(`push failed: ${(e as Error).message}`, 'err'); }
    finally { setBusy((b) => ({ ...b, push: false })); }
  };

  const onPull = async () => {
    if (!client || !effectiveCwd || busy.pull) return;
    setBusy((b) => ({ ...b, pull: true }));
    try { await client.pull(effectiveCwd); addNote('pulled', 'ok'); setRefreshKey((k) => k + 1); }
    catch (e) { addNote(`pull failed: ${(e as Error).message}`, 'err'); }
    finally { setBusy((b) => ({ ...b, pull: false })); }
  };

  if (!active) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgPrimary }}>
        <Text style={{ color: C.textMuted }}>Pick a workspace in Chat first.</Text>
      </View>
    );
  }

  if (selected) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 12, paddingVertical: 8,
          backgroundColor: C.bgSecondary,
          borderBottomWidth: 1, borderBottomColor: C.border,
        }}>
          <Pressable
            onPress={() => { setSelected(null); setDiff(''); }}
            accessibilityLabel="Back to changes"
            style={{
              width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: C.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronLeft size={16} color={C.text} strokeWidth={2} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: C.text }}>Diff</Text>
        </View>
        {loadingDiff ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
        ) : (
          <DiffViewer
            path={selected.path}
            status={selected.status}
            staged={selected.staged}
            diff={diff}
          />
        )}
      </View>
    );
  }

  const stagedEntries = (entries ?? []).filter((e) => e.staged);
  const unstagedEntries = (entries ?? []).filter((e) => !e.staged);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, paddingVertical: 12,
        backgroundColor: C.bgSecondary,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={{
            width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ChevronLeft size={16} color={C.text} strokeWidth={2} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: C.text }}>Changes</Text>
      </View>

      <RepoPicker members={members} current={effectiveCwd ?? ''} onPick={setCwd} isMeta={isMeta} />

      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, paddingVertical: 8,
        backgroundColor: C.bgMid,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}>
        <GitBranch size={13} color={C.accent} strokeWidth={2} />
        <Text style={{ fontFamily: C.mono, fontSize: 12, color: C.accent }}>
          {branch ?? '—'}
        </Text>
        {(ahead > 0 || behind > 0) ? (
          <Text style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>
            {ahead > 0 ? `↑${ahead} ` : ''}{behind > 0 ? `↓${behind}` : ''}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={onPull}
          disabled={!branch || !!busy.pull}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 10, paddingVertical: 4,
            borderRadius: 6, borderWidth: 1, borderColor: C.border,
            opacity: !branch || busy.pull ? 0.5 : 1,
          }}
        >
          <ArrowDown size={13} color={C.text} strokeWidth={2} />
          <Text style={{ fontFamily: C.mono, fontSize: 12, color: C.text }}>
            {busy.pull ? 'Pulling…' : 'Pull'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onPush}
          disabled={!branch || ahead === 0 || !!busy.push}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 10, paddingVertical: 4,
            borderRadius: 6, borderWidth: 1,
            borderColor: ahead > 0 ? C.accent : C.border,
            opacity: !branch || ahead === 0 || busy.push ? 0.5 : 1,
          }}
        >
          <ArrowUp size={13} color={ahead > 0 ? C.accent : C.text} strokeWidth={2} />
          <Text style={{
            fontFamily: C.mono, fontSize: 12,
            color: ahead > 0 ? C.accent : C.text,
          }}>
            {busy.push ? 'Pushing…' : ahead > 0 ? `Push ${ahead}` : 'Push'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setCommitOpen(true)}
          disabled={stagedCount === 0 || !!busy.commit}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 10, paddingVertical: 4,
            borderRadius: 6, borderWidth: 1,
            borderColor: stagedCount > 0 ? C.accent : C.border,
            backgroundColor: stagedCount > 0 ? C.accent : 'transparent',
            opacity: stagedCount === 0 || busy.commit ? 0.5 : 1,
          }}
        >
          <GitCommit size={13} color={stagedCount > 0 ? '#000' : C.text} strokeWidth={2} />
          <Text style={{
            fontFamily: C.mono, fontSize: 12,
            color: stagedCount > 0 ? '#000' : C.text,
          }}>
            Commit{stagedCount > 0 ? ` ${stagedCount}` : ''}
          </Text>
        </Pressable>
      </View>

      {entries == null && !err ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
      ) : err ? (
        <Text style={{ color: C.red, padding: 14, fontSize: 12 }}>{err}</Text>
      ) : entries!.length === 0 ? (
        <Text style={{ color: C.textMuted, padding: 16, fontSize: 13 }}>
          No uncommitted changes.
        </Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {stagedEntries.length > 0 && (
            <>
              <View style={{
                paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
                backgroundColor: C.bgSecondary,
              }}>
                <Text style={{
                  fontFamily: C.mono, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  color: C.textMuted,
                }}>
                  Staged ({stagedEntries.length})
                </Text>
              </View>
              {stagedEntries.map((e) => (
                <ChangeRow
                  key={`s-${e.path}`}
                  entry={e}
                  active={selected ? (selected as StatusEntry).path === e.path && (selected as StatusEntry).staged === e.staged : false}
                  pending={pendingStagePath === e.path}
                  onToggleStage={onToggleStage}
                  onSelect={setSelected}
                />
              ))}
            </>
          )}
          {unstagedEntries.length > 0 && (
            <>
              <View style={{
                paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
                backgroundColor: C.bgSecondary,
              }}>
                <Text style={{
                  fontFamily: C.mono, fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  color: C.textMuted,
                }}>
                  Unstaged ({unstagedEntries.length})
                </Text>
              </View>
              {unstagedEntries.map((e) => (
                <ChangeRow
                  key={`u-${e.path}`}
                  entry={e}
                  active={selected ? (selected as StatusEntry).path === e.path && (selected as StatusEntry).staged === e.staged : false}
                  pending={pendingStagePath === e.path}
                  onToggleStage={onToggleStage}
                  onSelect={setSelected}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      {notes.length > 0 && (
        <View style={{
          paddingHorizontal: 12, paddingVertical: 6,
          borderTopWidth: 1, borderTopColor: C.border,
          backgroundColor: C.bgSecondary,
          gap: 2,
        }}>
          {notes.map((n) => (
            <Text
              key={n.id}
              style={{
                fontFamily: C.mono,
                fontSize: 11,
                color: n.kind === 'err' ? C.red : C.green,
              }}
            >
              {n.text}
            </Text>
          ))}
        </View>
      )}

      <Modal
        visible={commitOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCommitOpen(false)}
      >
        <Pressable
          onPress={() => setCommitOpen(false)}
          style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              backgroundColor: C.bgSecondary,
              borderTopWidth: 1, borderTopColor: C.border,
              borderTopLeftRadius: 14, borderTopRightRadius: 14,
              paddingHorizontal: 14, paddingVertical: 16, paddingBottom: 28,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: C.text }}>
                Commit{stagedCount > 0 ? ` (${stagedCount} staged)` : ''}
              </Text>
              <Pressable onPress={() => setCommitOpen(false)} accessibilityLabel="Cancel">
                <X size={18} color={C.textMuted} strokeWidth={2} />
              </Pressable>
            </View>
            <TextInput
              value={commitMessage}
              onChangeText={setCommitMessage}
              placeholder="Message"
              placeholderTextColor={C.textMuted}
              multiline
              autoFocus
              style={{
                minHeight: 80,
                padding: 10,
                fontSize: 14,
                color: C.text,
                backgroundColor: C.bgInput,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: C.border,
                fontFamily: C.mono,
                textAlignVertical: 'top',
              }}
            />
            <Pressable
              onPress={onCommit}
              disabled={!commitMessage.trim() || stagedCount === 0 || !!busy.commit}
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: 14, paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: !commitMessage.trim() || stagedCount === 0 ? C.border : C.accent,
                backgroundColor: !commitMessage.trim() || stagedCount === 0 ? C.bgElevated : C.accent,
                opacity: busy.commit ? 0.6 : 1,
              }}
            >
              <Text style={{
                fontSize: 13, fontWeight: '500',
                color: !commitMessage.trim() || stagedCount === 0 ? C.textMuted : '#000',
              }}>
                {busy.commit ? 'Committing…' : 'Commit'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
