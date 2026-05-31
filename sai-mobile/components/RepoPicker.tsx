// Horizontal scroller of repo "pills". Mirrors src/renderer-remote/files/RepoPicker.tsx.
// Renders when:
//   * there are 2+ entries in `members`, OR
//   * the active workspace is a meta workspace with `members.length >= 1`
//     (matches the PWA's rule — meta workspaces always expose member pills
//     even when there is just one).
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Folder } from 'lucide-react-native';
import { FONT } from '../lib/fonts';

const C = {
  bgMid: '#13171b',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  black: '#000000',
  mono: FONT.mono,
};

export interface RepoMember { projectPath: string; name: string }

interface Props {
  members: RepoMember[];
  current: string;
  onPick: (projectPath: string) => void;
  /** When true (active workspace is a meta workspace), render whenever
   *  members.length >= 1. Otherwise default to len >= 2. */
  isMeta?: boolean;
}

export default function RepoPicker({ members, current, onPick, isMeta }: Props) {
  const minMembers = isMeta ? 1 : 2;
  if (members.length < minMembers) return null;
  return (
    <View style={{
      backgroundColor: C.bgMid,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 6, gap: 6 }}
      >
        {members.map((m) => {
          const active = m.projectPath === current;
          return (
            <Pressable
              key={m.projectPath}
              onPress={() => onPick(m.projectPath)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? C.accent : C.border,
                backgroundColor: active ? C.accent : 'transparent',
              }}
            >
              <Folder size={11} strokeWidth={2} color={active ? C.black : C.textMuted} />
              <Text style={{
                fontFamily: C.mono,
                fontSize: 12,
                color: active ? C.black : C.textMuted,
              }}>
                {m.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
