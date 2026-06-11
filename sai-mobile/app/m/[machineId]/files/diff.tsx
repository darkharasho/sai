// Single-file diff route. Opens from the file viewer/editor's "Diff" button
// so you can see what's changed against the working tree without leaving
// the file you're looking at. Reuses the existing DiffViewer component
// (the same one Changes uses to render per-file diffs).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import DiffViewer from '../../../../components/DiffViewer';

const C = {
  bgPrimary: '#0e1114',
  bgSecondary: '#0c0f11',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  red: '#E35535',
};

export default function FileDiff() {
  const params = useLocalSearchParams<{ path: string; cwd?: string; staged?: string }>();
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const cwd = (params.cwd as string | undefined) ?? active?.projectPath ?? null;
  const path = (params.path as string | undefined) ?? '';
  const staged = params.staged === '1';

  const [diff, setDiff] = useState<string>('');
  const [status, setStatus] = useState<string>('modified');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd || !path || !client) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Server returns the per-file unified diff. statusFiles can tell us
        // whether this path is added/modified/deleted/renamed; we fetch it
        // alongside so the header pill matches the Changes view.
        const [d, s] = await Promise.all([
          client.diffFile(cwd, path, staged),
          client.statusFiles(cwd).catch(() => [] as unknown[]),
        ]);
        if (cancelled) return;
        setDiff(d.diff ?? '');
        const entries = s as Array<{ path: string; status: string; staged: boolean }>;
        const match = entries.find((e) => e.path === path && e.staged === staged)
          ?? entries.find((e) => e.path === path);
        if (match) setStatus(match.status);
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client, cwd, path, staged]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, paddingVertical: 8,
        backgroundColor: C.bgSecondary,
        borderBottomWidth: 1, borderBottomColor: C.border,
      }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={{
            width: 32, height: 32, borderRadius: 8,
            borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ChevronLeft size={16} color={C.text} strokeWidth={2} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: C.text }}>
          Diff
        </Text>
      </View>
      {err ? (
        <Text style={{ color: C.red, padding: 16 }}>{err}</Text>
      ) : loading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
      ) : (
        <DiffViewer path={path} status={status} staged={staged} diff={diff} />
      )}
    </View>
  );
}
