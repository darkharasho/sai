// Slide-in left drawer — mobile port of the PWA's NavDrawer (M11).
//
// The PWA's NavDrawer hosts four panes (Files / Git / Chats / Terminal). For
// the mobile MVP only the Chats pane is ported — Files/Git/Terminal are
// separate later milestones. The visual language (search, follow toggle,
// new-session button, grouped sessions, per-row status dots, active row
// highlight, relative timestamps) mirrors the PWA's ChatsPanel.
//
// Animation: the drawer slides in from the LEFT edge via Reanimated. The
// Modal is presented with animationType="none" + overFullScreen so we can
// drive the transform ourselves. A pan gesture on the panel allows
// drag-left-to-close.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Eye, EyeOff, Folder, Plus, Search, X } from 'lucide-react-native';
import type { WireClient } from '../lib/wire';
import { useWorkspaces, type Workspace } from '../lib/workspaceStore';
import {
  workspaceStatusStore,
  type WorkspaceStatus,
} from '../lib/workspaceStatusStore';
import { WorkspacePicker } from './WorkspacePicker';
import { SessionStatusIcon, type SessionStatusKind } from './SessionStatusIcon';

const C = {
  bgPrimary: '#0e1114',
  bgSecondary: '#0c0f11',
  bgElevated: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  accentTint: 'rgba(199,145,12,0.12)',
  green: '#4ade80',
  amber: '#f59e0b',
  red: '#ef4444',
  rowHover: 'rgba(255,255,255,0.04)',
  overlay: 'rgba(0,0,0,0.4)',
};

interface SessionMeta {
  id: string;
  projectPath: string;
  title?: string;
  updatedAt: number;
  kind?: string;
  lastViewedAt?: number;
  lastTurnErrored?: boolean;
  scopeSuspended?: boolean;
  messageCount?: number;
  pinned?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  client: WireClient | null;
  machineId: string;
  /** Active workspace projectPath — drives Files/Git in PWA; here drives the
   *  workspace label + the sessions list source. */
  workspacePath: string | null;
  /** Currently-attached session id (highlight this row). */
  currentSessionId: string | null;
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  /** Called when a session is tapped. Empty `sessionId` means "new session". */
  onAttach: (projectPath: string, sessionId: string) => void;
  /** Workspace picked from the embedded WorkspacePicker. */
  onPickWorkspace: (w: Workspace) => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function NavDrawer({
  open,
  onClose,
  client,
  machineId,
  workspacePath,
  currentSessionId,
  followEnabled,
  onFollowChange,
  onAttach,
  onPickWorkspace,
}: Props) {
  const active = useWorkspaces((s) => s.activeByMachine[machineId]) ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [, setStatusTick] = useState(0);
  const refreshRef = useRef<() => void>(() => {});

  // Animation: drawer slides from -WIDTH → 0. Backdrop opacity tracks it.
  const { width: screenW } = useWindowDimensions();
  const DRAWER_WIDTH = Math.min(screenW * 0.85, 360);
  const translateX = useSharedValue(-DRAWER_WIDTH);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      translateX.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.6 });
    } else if (mounted) {
      translateX.value = withTiming(-DRAWER_WIDTH, { duration: 220 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, DRAWER_WIDTH]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    const progress = 1 - Math.min(Math.abs(translateX.value) / DRAWER_WIDTH, 1);
    return { opacity: progress };
  });

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .onUpdate((e) => {
          // Only respond to leftward drags from the panel.
          const next = Math.min(0, e.translationX);
          translateX.value = next;
        })
        .onEnd((e) => {
          const shouldClose = e.translationX < -60 || e.velocityX < -500;
          if (shouldClose) {
            translateX.value = withTiming(-DRAWER_WIDTH, { duration: 200 }, (finished) => {
              if (finished) runOnJS(onClose)();
            });
          } else {
            translateX.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.6 });
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [DRAWER_WIDTH, onClose]
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const off = workspaceStatusStore.subscribe((p) => {
      if (p === workspacePath) setStatusTick((n) => n + 1);
    });
    return off;
  }, [workspacePath]);

  const refresh = () => {
    if (!client || !workspacePath) {
      setSessions([]);
      return;
    }
    setLoading(true);
    setErr(null);
    client
      .listSessions(workspacePath)
      .then((s) => setSessions((s as SessionMeta[]) ?? []))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  refreshRef.current = refresh;

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspacePath, open]);

  // When desktop signals new activity on the active workspace, re-pull list
  // so msg counts / titles advance — mirrors the PWA pattern.
  useEffect(() => {
    if (!workspacePath || !open) return;
    const off = workspaceStatusStore.subscribe((p, st) => {
      if (p === workspacePath && st?.completed) refreshRef.current();
    });
    return off;
  }, [workspacePath, open]);

  const status: WorkspaceStatus | undefined = workspacePath
    ? workspaceStatusStore.get(workspacePath)
    : undefined;
  const streamingIds = new Set(status?.streamingSessionIds ?? []);
  const awaitingIds = new Set(status?.awaitingSessionIds ?? []);
  const suspendedIds = new Set(status?.suspendedSessionIds ?? []);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return sessions;
    const q = debouncedQuery.toLowerCase();
    return sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q));
  }, [sessions, debouncedQuery]);

  const grouped = useMemo(() => {
    if (debouncedQuery.trim()) return [{ label: 'Results', sessions: filtered }];
    const pinned = filtered.filter((s) => s.pinned);
    const unpinned = filtered.filter((s) => !s.pinned);
    const groups: { label: string; sessions: SessionMeta[] }[] = [];
    if (pinned.length > 0) groups.push({ label: 'Pinned', sessions: pinned });
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const bucket = (ts: number): string => {
      const ageDays = Math.floor((now - ts) / dayMs);
      if (ageDays <= 0) return 'Today';
      if (ageDays === 1) return 'Yesterday';
      if (ageDays < 7) return 'This week';
      if (ageDays < 30) return 'This month';
      return 'Older';
    };
    for (const s of unpinned) {
      const label = bucket(s.updatedAt);
      const existing = groups.find((g) => g.label === label);
      if (existing) existing.sessions.push(s);
      else groups.push({ label, sessions: [s] });
    }
    return groups;
  }, [filtered, debouncedQuery]);

  const handleNewSession = () => {
    if (!workspacePath) return;
    onFollowChange(false);
    onAttach(workspacePath, '');
    onClose();
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop — animated opacity following drawer position. */}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Animated.View
          style={[
            {
              ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const),
              backgroundColor: C.overlay,
            },
            backdropStyle,
          ]}
          pointerEvents="auto"
        >
          <Pressable onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>

        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[
              {
                width: DRAWER_WIDTH,
                height: '100%',
                backgroundColor: C.bgPrimary,
                borderRightWidth: 1,
                borderRightColor: C.border,
                flexDirection: 'column',
              },
              panelStyle,
            ]}
          >
          {/* Unified header: workspace + Follow toggle + close. */}
          <View
            style={{
              paddingHorizontal: 14,
              paddingTop: 16,
              paddingBottom: 12,
              gap: 12,
              backgroundColor: C.bgSecondary,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => setPickerOpen(true)}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 0,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Folder size={14} color={C.textMuted} strokeWidth={2} />
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 15, color: C.text, fontWeight: '600' }}
                >
                  {active?.label ?? 'No workspace'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onFollowChange(!followEnabled)}
                hitSlop={8}
                accessibilityLabel={followEnabled ? 'Stop following desktop' : 'Follow desktop'}
                style={{
                  width: 30, height: 30, borderRadius: 6,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                {followEnabled
                  ? <Eye size={16} color={C.accent} />
                  : <EyeOff size={16} color={C.textMuted} />}
              </Pressable>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close drawer"
                hitSlop={8}
                style={{
                  width: 30, height: 30, borderRadius: 6,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={18} color={C.textMuted} />
              </Pressable>
            </View>

            {/* Search field shares the header surface — no extra divider. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 10,
                height: 34,
                borderRadius: 8,
                backgroundColor: C.bgElevated,
              }}
            >
              <Search size={13} color={C.textMuted} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search chats"
                placeholderTextColor={C.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                style={{ flex: 1, fontSize: 13, color: C.text, paddingVertical: 0 }}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <X size={12} color={C.textMuted} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Sessions list. */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 4 }}>
            {loading && (
              <Text
                style={{
                  paddingVertical: 32,
                  textAlign: 'center',
                  color: C.textMuted,
                  fontSize: 12,
                }}
              >
                Loading…
              </Text>
            )}
            {err && (
              <Text
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  fontSize: 12,
                  color: C.red,
                }}
              >
                {err}
              </Text>
            )}
            {!loading && filtered.length === 0 && !err && (
              <Text
                style={{
                  paddingVertical: 32,
                  paddingHorizontal: 16,
                  textAlign: 'center',
                  color: C.textMuted,
                  fontSize: 12,
                }}
              >
                {debouncedQuery
                  ? 'No matching conversations'
                  : workspacePath
                    ? 'No conversations yet'
                    : 'Pick a workspace to see chats'}
              </Text>
            )}
            {grouped.map((group, gi) => (
              <View key={group.label} style={{ marginTop: gi === 0 ? 4 : 16 }}>
                <Text
                  style={{
                    paddingHorizontal: 14,
                    paddingBottom: 6,
                    fontSize: 11,
                    color: C.textMuted,
                    fontWeight: '500',
                  }}
                >
                  {group.label}
                </Text>
                {group.sessions.map((s) => {
                  const isActive = s.id === currentSessionId;
                  const isStreaming = streamingIds.has(s.id);
                  const isAwaiting = awaitingIds.has(s.id);
                  const isError = !!s.lastTurnErrored;
                  const isSuspended = !!s.scopeSuspended || suspendedIds.has(s.id);
                  const isUnread =
                    !isActive &&
                    typeof s.lastViewedAt === 'number' &&
                    s.updatedAt > s.lastViewedAt;

                  // PWA status-icon vocabulary, in PWA priority order.
                  // Spacer (kind='none') keeps row text aligned when no
                  // signal applies.
                  const statusKind: SessionStatusKind =
                    isAwaiting ? 'awaiting'
                    : isError ? 'error'
                    : isStreaming ? 'busy'
                    : isUnread ? 'unread'
                    : isSuspended ? 'suspended'
                    : 'none';

                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        onAttach(s.projectPath, s.id);
                        onClose();
                      }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 10,
                        paddingLeft: 14,
                        paddingRight: 14,
                        backgroundColor: isActive
                          ? C.accentTint
                          : pressed
                            ? C.rowHover
                            : 'transparent',
                      })}
                    >
                      <View style={{ width: 14, alignItems: 'center' }}>
                        <SessionStatusIcon kind={statusKind} />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={{
                          flex: 1,
                          fontSize: 14,
                          color: isActive ? C.accent : C.text,
                          fontWeight: isActive || isUnread ? '600' : '400',
                        }}
                      >
                        {s.title || 'Untitled'}
                      </Text>
                      <Text style={{ fontSize: 11, color: C.textMuted }}>
                        {formatRelative(s.updatedAt)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Floating "New chat" button — primary action, always reachable. */}
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 0, right: 0, bottom: 0,
              padding: 14,
              alignItems: 'flex-end',
            }}
          >
            <Pressable
              onPress={handleNewSession}
              disabled={!workspacePath}
              accessibilityLabel="New chat"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 999,
                backgroundColor: C.accent,
                opacity: !workspacePath ? 0.4 : pressed ? 0.85 : 1,
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              })}
            >
              <Plus size={16} color="#000" strokeWidth={2.5} />
              <Text style={{ fontSize: 13, color: '#000', fontWeight: '600' }}>
                New chat
              </Text>
            </Pressable>
          </View>

          <WorkspacePicker
            machineId={machineId}
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onPick={(w) => {
              onPickWorkspace(w);
              setPickerOpen(false);
            }}
            currentProjectPath={active?.projectPath ?? null}
          />
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}
