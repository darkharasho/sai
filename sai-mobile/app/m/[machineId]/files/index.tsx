// Browse files. PWA-parity tree with chevrons, file-type hints, sizes.
// Mirrors src/renderer-remote/files/BrowseView.tsx, RN-ified.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Folder, FileText, ChevronDown, ChevronRight,
  Image as ImgIcon, FileCode2, FileJson, FileType, GitBranch,
} from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces, type Workspace } from '../../../../lib/workspaceStore';
import RepoPicker, { type RepoMember } from '../../../../components/RepoPicker';

const EMPTY_WORKSPACES: Workspace[] = [];
import { FONT } from '../../../../lib/fonts';

const C = {
  bgPrimary: '#0e1114',
  bgSecondary: '#0c0f11',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  red: '#E35535',
  mono: FONT.mono,
};

interface Entry { name: string; type?: 'dir' | 'file'; kind?: 'dir' | 'file'; size?: number; mtime?: number }

function entryKind(e: Entry): 'dir' | 'file' {
  return (e.kind ?? e.type ?? 'file');
}

function formatSize(bytes?: number): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMtime(ms?: number): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  if (sameYear) return `${month} ${day}`;
  return `${month} ${day}, ${d.getFullYear()}`;
}

function iconForFile(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return ImgIcon;
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return FileCode2;
  if (ext === 'json') return FileJson;
  if (['md', 'markdown', 'txt'].includes(ext)) return FileType;
  return FileText;
}

interface RowProps {
  cwd: string;
  entry: Entry;
  parent: string;
  depth: number;
  machineId: string;
  client: ReturnType<typeof useConn>['client'];
}

function Row({ cwd, entry, parent, depth, machineId, client }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const childPath = parent ? `${parent}/${entry.name}` : entry.name;
  const kind = entryKind(entry);

  useEffect(() => {
    if (!expanded || kind !== 'dir' || children.length > 0 || !client) return;
    setLoading(true);
    client.listFiles(cwd, childPath)
      .then((e) => setChildren(e as Entry[]))
      .catch(() => setChildren([]))
      .finally(() => setLoading(false));
  }, [expanded, kind, client, cwd, childPath, children.length]);

  const Icon = kind === 'dir' ? Folder : iconForFile(entry.name);
  const Chevron = kind === 'dir' ? (expanded ? ChevronDown : ChevronRight) : null;
  const size = kind === 'file' ? formatSize(entry.size) : null;
  const mtime = formatMtime(entry.mtime);

  const onPress = () => {
    if (kind === 'dir') {
      setExpanded((v) => !v);
    } else {
      router.push({
        pathname: `/m/${machineId}/files/view`,
        params: { path: childPath, cwd },
      });
    }
  };

  return (
    <>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 10 + depth * 14,
          paddingRight: 14,
          paddingVertical: 7,
        }}
      >
        <View style={{ width: 14, alignItems: 'center', justifyContent: 'center' }}>
          {Chevron ? <Chevron size={12} color={C.textMuted} strokeWidth={2} /> : null}
        </View>
        <Icon size={13} color={C.textMuted} strokeWidth={2} />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: C.mono,
            fontSize: 13,
            color: C.text,
          }}
        >
          {entry.name}
        </Text>
        {size ? (
          <Text style={{ fontFamily: C.mono, fontSize: 10, color: C.textMuted }}>{size}</Text>
        ) : null}
        {mtime ? (
          <Text style={{ fontFamily: C.mono, fontSize: 10, color: C.textMuted, marginLeft: 6 }}>{mtime}</Text>
        ) : null}
      </Pressable>
      {expanded && kind === 'dir' && (
        <>
          {loading && (
            <View style={{ paddingLeft: 24 + depth * 14, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, color: C.textMuted }}>Loading…</Text>
            </View>
          )}
          {children.map((c) => (
            <Row
              key={c.name}
              cwd={cwd}
              entry={c}
              parent={childPath}
              depth={depth + 1}
              machineId={machineId}
              client={client}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function Browse() {
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const workspaces = useWorkspaces((s) => s.workspacesByMachine[machine.machineId] ?? EMPTY_WORKSPACES);
  const [cwd, setCwd] = useState<string | null>(active?.projectPath ?? null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (active && !cwd) setCwd(active.projectPath);
  }, [active, cwd]);

  useEffect(() => {
    if (!cwd || !client) return;
    let cancelled = false;
    setEntries(null);
    setErr(null);
    client.listFiles(cwd, '')
      .then((e) => { if (!cancelled) setEntries(e as Entry[]); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [client, cwd]);

  // Pills: when the active workspace is meta, expose its member repos.
  // Otherwise list sibling workspaces (PWA fallback for multi-repo desktops).
  const isMeta = active?.kind === 'meta';
  const members: RepoMember[] = useMemo(() => {
    if (isMeta && active?.members && active.members.length > 0) {
      return active.members.map((m) => ({ projectPath: m.projectPath, name: m.name }));
    }
    return workspaces.map((w) => ({ projectPath: w.projectPath, name: w.label }));
  }, [isMeta, active?.members, workspaces]);

  if (!active) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bgPrimary }}>
        <Text style={{ color: C.textMuted }}>Pick a workspace in Chat first.</Text>
      </View>
    );
  }

  const effectiveCwd = cwd ?? active.projectPath;

  return (
    <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: C.bgSecondary,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: C.text }}>Files</Text>
        <Pressable
          onPress={() => router.push(`/m/${machine.machineId}/files/changes`)}
          accessibilityLabel="Open Git changes"
          style={{ padding: 4 }}
        >
          <GitBranch size={18} color={C.accent} strokeWidth={2} />
        </Pressable>
      </View>
      <RepoPicker members={members} current={effectiveCwd} onPick={setCwd} isMeta={isMeta} />
      {entries == null && !err ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
      ) : err ? (
        <Text style={{ color: C.red, padding: 14, fontSize: 12 }}>{err}</Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {entries!.map((e) => (
            <Row
              key={e.name}
              cwd={effectiveCwd}
              entry={e}
              parent=""
              depth={1}
              machineId={machine.machineId}
              client={client}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
