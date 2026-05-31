// Top chrome for the terminal screen: shows the current term id + cwd,
// opens the bottom-sheet picker, and exposes new/kill shortcuts.
// Mirrors src/renderer-remote/terminal/TerminalToolbar.tsx visually, but
// adapted for an RN view above an xterm.js WebView.
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, Plus, X, RefreshCw } from 'lucide-react-native';

const C = {
  bgSecondary: '#0c0f11',
  bgElevated: '#13171b',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  red: '#E35535',
  mono: 'Menlo',
};

interface Props {
  termId: number | null;
  termCwd?: string | null;
  origin?: 'phone' | 'desktop' | null;
  onOpenPicker: () => void;
  onNew: () => void;
  onKill: () => void;
  busyNew?: boolean;
  busyKill?: boolean;
}

export default function TerminalToolbar({
  termId, termCwd, origin, onOpenPicker, onNew, onKill, busyNew, busyKill,
}: Props) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: C.bgSecondary,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    }}>
      <Pressable
        onPress={onOpenPicker}
        accessibilityLabel="Open terminal picker"
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          height: 36,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.bgElevated,
        }}
      >
        {termId == null ? (
          <Text style={{ fontFamily: C.mono, fontSize: 13, color: C.textMuted, flex: 1 }} numberOfLines={1}>
            No terminal
          </Text>
        ) : (
          <>
            <Text style={{ fontFamily: C.mono, fontSize: 13, color: C.accent }}>
              #{termId}
            </Text>
            <Text
              numberOfLines={1}
              style={{ flex: 1, fontFamily: C.mono, fontSize: 12, color: C.textMuted }}
            >
              {termCwd ?? ''}
            </Text>
            {origin ? (
              <View style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 999,
                borderWidth: origin === 'desktop' ? 1 : 0,
                borderColor: C.border,
                backgroundColor: origin === 'phone' ? C.accent : 'transparent',
              }}>
                <Text style={{
                  fontFamily: C.mono,
                  fontSize: 9,
                  color: origin === 'phone' ? '#000' : C.textMuted,
                }}>
                  {origin}
                </Text>
              </View>
            ) : null}
          </>
        )}
        <ChevronDown size={14} color={C.textMuted} strokeWidth={2} />
      </Pressable>
      <Pressable
        onPress={onNew}
        disabled={busyNew}
        accessibilityLabel="New terminal"
        style={{
          height: 36,
          width: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.bgElevated,
          opacity: busyNew ? 0.6 : 1,
        }}
      >
        {busyNew ? <RefreshCw size={16} color={C.text} strokeWidth={2} /> : <Plus size={16} color={C.text} strokeWidth={2} />}
      </Pressable>
      <Pressable
        onPress={onKill}
        disabled={busyKill || termId == null}
        accessibilityLabel="Kill terminal"
        style={{
          height: 36,
          width: 36,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          backgroundColor: C.bgElevated,
          opacity: busyKill || termId == null ? 0.5 : 1,
        }}
      >
        <X size={16} color={termId == null ? C.textMuted : C.red} strokeWidth={2} />
      </Pressable>
    </View>
  );
}
