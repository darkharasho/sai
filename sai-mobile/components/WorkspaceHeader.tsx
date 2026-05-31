// Top-of-chat header. Port of src/renderer-remote/chat/WorkspaceHeader.tsx
// adapted for mobile: hamburger menu on the left (opens NavDrawer — M11),
// then current-workspace label with a folder icon and status dot, tap to
// open the WorkspacePicker bottom sheet.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, Folder, Menu } from 'lucide-react-native';
import { useWorkspaces, type Workspace } from '../lib/workspaceStore';
import { workspaceStatusStore, displayPriority } from '../lib/workspaceStatusStore';
import { WorkspacePicker } from './WorkspacePicker';

const C = {
  bgSecondary: '#0c0f11',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#4ade80',
  amber: '#f59e0b',
};

interface Props {
  machineId: string;
  onOpenNav: () => void;
  onPick: (w: Workspace) => void;
}

function HeaderStatusDot({ projectPath }: { projectPath: string | null }) {
  if (!projectPath) return null;
  const status = workspaceStatusStore.get(projectPath);
  const p = displayPriority(status);
  if (p === 'approval') {
    return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.amber }} />;
  }
  if (p === 'busy') {
    return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />;
  }
  // Idle / completed for the current workspace both render as green (running).
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green }} />;
}

export function WorkspaceHeader({ machineId, onOpenNav, onPick }: Props) {
  const active = useWorkspaces((s) => s.activeByMachine[machineId]) ?? null;
  const [open, setOpen] = useState(false);

  // Re-render on status changes (covers the dot in the bar).
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = workspaceStatusStore.subscribe((p) => {
      if (p === active?.projectPath) setTick((n) => n + 1);
    });
    return off;
  }, [active?.projectPath]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: C.bgSecondary,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <Pressable
        onPress={onOpenNav}
        accessibilityLabel="Open sessions"
        hitSlop={8}
        style={{
          width: 32, height: 32,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: C.border, borderRadius: 8,
        }}
      >
        <Menu size={18} color={C.text} />
      </Pressable>

      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 4,
          paddingHorizontal: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: 'transparent',
          opacity: pressed ? 0.7 : 1,
          minWidth: 0,
        })}
      >
        <Folder size={14} color={C.textMuted} strokeWidth={2} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, fontWeight: '500', color: C.text }}
          >
            {active?.label ?? 'No workspace'}
          </Text>
        </View>
        <HeaderStatusDot projectPath={active?.projectPath ?? null} />
        <ChevronDown
          size={14}
          color={C.textMuted}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      <WorkspacePicker
        machineId={machineId}
        open={open}
        onClose={() => setOpen(false)}
        onPick={onPick}
        currentProjectPath={active?.projectPath ?? null}
      />
    </View>
  );
}
