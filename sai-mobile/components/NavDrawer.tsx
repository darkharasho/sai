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
import { Folder, Plus, Search, X } from 'lucide-react-native';
import type { WireClient } from '../lib/wire';
import { useWorkspaces, type Workspace } from '../lib/workspaceStore';
import {
  workspaceStatusStore,
  type WorkspaceStatus,
} from '../lib/workspaceStatusStore';
import { WorkspacePicker } from './WorkspacePicker';
import { StatusDot } from './StatusDot';
import { FONT } from '../lib/fonts';

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
  mono: FONT.mono,
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
          {/* Header: workspace selector + close. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 14,
              paddingBottom: 10,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
              backgroundColor: C.bgSecondary,
            }}
          >
            <Pressable
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 6,
                paddingHorizontal: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: C.border,
                opacity: pressed ? 0.7 : 1,
                minWidth: 0,
              })}
            >
              <Folder size={14} color={C.textMuted} strokeWidth={2} />
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 13, color: C.text, fontWeight: '500' }}
              >
                {active?.label ?? 'No workspace'}
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close drawer"
              hitSlop={8}
              style={{
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
              }}
            >
              <X size={18} color={C.textMuted} />
            </Pressable>
          </View>

          {/* Chats header row: title + New button. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
              backgroundColor: C.bgSecondary,
            }}
          >
            <Text
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: '600',
                color: C.text,
              }}
            >
              Chats
            </Text>
            <Pressable
              onPress={handleNewSession}
              disabled={!workspacePath}
              accessibilityLabel="New session"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: C.border,
                opacity: !workspacePath ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              <Plus
                size={14}
                color={workspacePath ? C.accent : C.textMuted}
                strokeWidth={2}
              />
              <Text
                style={{
                  fontSize: 12,
                  color: workspacePath ? C.accent : C.textMuted,
                }}
              >
                New
              </Text>
            </Pressable>
          </View>

          {/* Search row. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <Search size={12} color={C.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search conversations..."
              placeholderTextColor={C.textMuted}
              style={{
                flex: 1,
                fontSize: 13,
                color: C.text,
                paddingVertical: 4,
              }}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <X size={12} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {/* Follow desktop toggle. */}
          <Pressable
            onPress={() => onFollowChange(!followEnabled)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
            }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                borderWidth: 1,
                borderColor: followEnabled ? C.accent : C.textMuted,
                backgroundColor: followEnabled ? C.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {followEnabled && (
                <Text style={{ color: '#000', fontSize: 11, fontWeight: '700', lineHeight: 12 }}>
                  ✓
                </Text>
              )}
            </View>
            <Text style={{ fontSize: 12, color: C.text }}>Follow desktop</Text>
          </Pressable>

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
            {grouped.map((group) => (
              <View key={group.label}>
                <Text
                  style={{
                    paddingHorizontal: 12,
                    paddingTop: 10,
                    paddingBottom: 4,
                    fontSize: 10,
                    letterSpacing: 0.5,
                    color: C.textMuted,
                    fontFamily: C.mono,
                  }}
                >
                  {group.label.toUpperCase()}
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

                  // Map session-level signals to a StatusDot-style state for
                  // animation consistency with WorkspaceHeader/Picker.
                  let dotKind: 'approval' | 'busy' | 'unread' | 'suspended' | null = null;
                  let dotLabel: string | null = null;
                  if (isAwaiting) { dotKind = 'approval'; dotLabel = '!'; }
                  else if (isError) { dotKind = 'approval'; dotLabel = '!'; }
                  else if (isStreaming) { dotKind = 'busy'; }
                  else if (isUnread) { dotKind = 'unread'; }
                  else if (isSuspended) { dotKind = 'suspended'; }

                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => {
                        onAttach(s.projectPath, s.id);
                        onClose();
                      }}
                      style={({ pressed }) => ({
                        marginHorizontal: 6,
                        marginVertical: 1,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 6,
                        backgroundColor: isActive
                          ? C.accentTint
                          : pressed
                            ? C.rowHover
                            : 'transparent',
                        borderLeftWidth: isActive ? 2 : 0,
                        borderLeftColor: isActive ? C.accent : 'transparent',
                      })}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 3,
                        }}
                      >
                        {dotKind ? (
                          dotLabel ? (
                            <View
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: 7,
                                backgroundColor: C.amber,
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Text
                                style={{
                                  color: '#000',
                                  fontSize: 10,
                                  fontWeight: '800',
                                  lineHeight: 12,
                                }}
                              >
                                {dotLabel}
                              </Text>
                            </View>
                          ) : (
                            <StatusDot
                              kind={dotKind}
                              size={9}
                              shape="square"
                            />
                          )
                        ) : (
                          <View style={{ width: 9, height: 9 }} />
                        )}
                        <Text
                          numberOfLines={1}
                          style={{
                            flex: 1,
                            fontSize: 13,
                            fontWeight: '500',
                            color: C.text,
                          }}
                        >
                          {s.title || 'Untitled'}
                        </Text>
                        {isActive && (
                          <Text
                            style={{
                              fontSize: 9,
                              backgroundColor: C.accent,
                              color: '#000',
                              paddingVertical: 1,
                              paddingHorizontal: 5,
                              borderRadius: 3,
                              fontWeight: '600',
                              overflow: 'hidden',
                            }}
                          >
                            ACTIVE
                          </Text>
                        )}
                      </View>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          opacity: 0.75,
                        }}
                      >
                        {typeof s.messageCount === 'number' && (
                          <>
                            <Text style={{ fontSize: 11, color: C.textMuted }}>
                              {s.messageCount} msgs
                            </Text>
                            <Text style={{ fontSize: 11, color: C.textMuted, opacity: 0.5 }}>
                              ·
                            </Text>
                          </>
                        )}
                        <Text style={{ fontSize: 11, color: C.textMuted }}>
                          {formatRelative(s.updatedAt)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

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
