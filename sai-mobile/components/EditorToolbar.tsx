// Top chrome for the read-only file viewer. Mirrors the toolbar PWA's
// FileViewer/FileEditor share: back button, file path, language pill, copy.
// (The PWA's keyboard-arrows EditorToolbar is irrelevant on mobile while
// editing is a non-goal — see docs/superpowers/specs/2026-05-30-sai-mobile-ios-app-design.md.)
import { Pressable, Text, View } from 'react-native';
import { ArrowLeft, Copy } from 'lucide-react-native';
import { FONT } from '../lib/fonts';

const C = {
  bgSecondary: '#0c0f11',
  bgElevated: '#13171b',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  mono: FONT.mono,
};

interface Props {
  path: string;
  lang?: string | null;
  onBack: () => void;
  onCopy?: () => void;
  copyState?: 'idle' | 'copied';
}

export default function EditorToolbar({ path, lang, onBack, onCopy, copyState = 'idle' }: Props) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: C.bgSecondary,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    }}>
      <Pressable
        onPress={onBack}
        accessibilityLabel="Back to files"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
        }}
      >
        <ArrowLeft size={16} color={C.text} strokeWidth={2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: C.mono, fontSize: 12, color: C.textMuted }}
        >
          {path}
        </Text>
      </View>
      {lang ? (
        <View style={{
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: C.border,
        }}>
          <Text style={{ fontFamily: C.mono, fontSize: 10, color: C.textMuted }}>{lang}</Text>
        </View>
      ) : null}
      {onCopy ? (
        <Pressable
          onPress={onCopy}
          accessibilityLabel="Copy contents"
          style={{
            height: 32,
            paddingHorizontal: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: copyState === 'copied' ? C.accent : C.border,
            backgroundColor: copyState === 'copied' ? C.accent : C.bgElevated,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Copy size={13} color={copyState === 'copied' ? '#000' : C.text} strokeWidth={2} />
          <Text style={{
            fontFamily: C.mono,
            fontSize: 11,
            color: copyState === 'copied' ? '#000' : C.text,
          }}>
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
