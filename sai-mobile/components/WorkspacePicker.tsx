// Bottom-sheet workspace picker — instant dim overlay, slide-up sheet.
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Folder } from 'lucide-react-native';
import { useWorkspaces, type Workspace } from '../lib/workspaceStore';
import { workspaceStatusStore, displayPriority } from '../lib/workspaceStatusStore';
import { StatusDot as AnimatedDot } from './StatusDot';
import { FONT } from '../lib/fonts';

const EMPTY_WORKSPACES: Workspace[] = [];
const SCREEN_HEIGHT = Dimensions.get('window').height;

const C = {
  bgSecondary: '#0c0f11',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#4ade80',
  amber: '#f59e0b',
  overlay: 'rgba(0,0,0,0.55)',
  mono: FONT.mono,
};

interface Props {
  machineId: string;
  open: boolean;
  onClose: () => void;
  onPick: (w: Workspace) => void;
  currentProjectPath: string | null;
}

function StatusDot({ projectPath, activeIdle }: { projectPath: string; activeIdle?: boolean }) {
  const status = workspaceStatusStore.get(projectPath);
  const p = displayPriority(status);
  if (p === 'approval') return <AnimatedDot kind="approval" />;
  if (p === 'busy') return <AnimatedDot kind="busy" />;
  if (p === 'completed') return <AnimatedDot kind="completed" />;
  if (activeIdle) return <AnimatedDot kind="idle" />;
  return null;
}

export function WorkspacePicker({ machineId, open, onClose, onPick, currentProjectPath }: Props) {
  const list = useWorkspaces((s) => s.workspacesByMachine[machineId] ?? EMPTY_WORKSPACES);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const off = workspaceStatusStore.subscribe(() => setTick((n) => n + 1));
    return off;
  }, [open]);

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (open) {
      slideAnim.setValue(SCREEN_HEIGHT);
      Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 200, useNativeDriver: true }).start();
    }
  }, [open]);

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}>
        <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              backgroundColor: C.bgSecondary,
              borderTopWidth: 1,
              borderTopColor: C.border,
              borderTopLeftRadius: 14,
              borderTopRightRadius: 14,
              paddingBottom: 24,
              maxHeight: SCREEN_HEIGHT * 0.75,
            }}
          >
            <View style={{
              paddingTop: 14,
              paddingBottom: 10,
              paddingHorizontal: 16,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}>
              <Text style={{
                fontFamily: C.mono,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: C.textMuted,
              }}>
                Workspaces
              </Text>
            </View>
            <ScrollView>
              {list.length === 0 && (
                <View style={{ padding: 16 }}>
                  <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center' }}>
                    No workspaces open on desktop.
                  </Text>
                </View>
              )}
              {list.map((w) => {
                const isActive = w.projectPath === currentProjectPath;
                const RowIcon = Folder;
                return (
                  <Pressable
                    key={w.projectPath}
                    onPress={() => { onPick(w); onClose(); }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: C.border,
                      borderLeftWidth: 2,
                      borderLeftColor: isActive ? C.accent : 'transparent',
                      gap: 8,
                    }}
                  >
                    <RowIcon size={14} color={isActive ? C.accent : C.textMuted} strokeWidth={2} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 13,
                          color: isActive ? C.accent : C.text,
                          fontWeight: isActive ? '600' : '400',
                        }}
                      >
                        {w.label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 10,
                          color: C.textMuted,
                          marginTop: 2,
                          fontFamily: C.mono,
                        }}
                      >
                        {w.projectPath}
                      </Text>
                    </View>
                    <StatusDot projectPath={w.projectPath} activeIdle={isActive} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
