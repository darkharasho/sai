// Line-buffered native input for the terminal. The xterm WebView is
// display-only; the user composes a command here and sends the buffer on
// Enter or via the explicit Send button. Toolbar keys (Tab/Esc/arrows)
// flush the current buffer + their special byte.
//
// The input is controlled for visible-text UX, but every change ALSO writes
// into a ref so send handlers can read the current buffer without waiting
// for React state to flush. On iOS, controlled TextInput state can lag the
// native field on rapid typing, and reading state in onSubmitEditing would
// see an empty buffer — only \r reaches the PTY. The ref sidesteps that.
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard, Platform, Pressable, Text, TextInput, View,
  type KeyboardEvent,
} from 'react-native';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Send } from 'lucide-react-native';
import { FONT } from '../lib/fonts';

const C = {
  bg: '#0c0f11',
  bgInput: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  mono: FONT.mono,
};

interface Props {
  onInput(data: string): void;
  disabled?: boolean;
}

function Key({
  label, onPress, active, disabled,
}: { label: React.ReactNode; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        height: 32,
        paddingHorizontal: 10,
        minWidth: 36,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: active ? C.accent : C.border,
        backgroundColor: active ? C.accent : C.bgInput,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {typeof label === 'string' ? (
        <Text style={{
          fontFamily: C.mono, fontSize: 12,
          color: active ? '#000' : C.text,
        }}>{label}</Text>
      ) : label}
    </Pressable>
  );
}

export function TerminalInput({ onInput, disabled }: Props) {
  const [text, setText] = useState('');
  const [ctrl, setCtrl] = useState(false);
  const [kbPad, setKbPad] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const bufRef = useRef('');

  // Manual keyboard avoidance: react-navigation's Tabs interacts badly with
  // KeyboardAvoidingView on iOS (tab bar stays visible and overlaps the
  // input). Lift the whole input panel by the keyboard's height directly.
  useEffect(() => {
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setKbPad(e.endCoordinates.height);
    const onHide = () => setKbPad(0);
    const s1 = Keyboard.addListener(showName, onShow);
    const s2 = Keyboard.addListener(hideName, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, []);

  const onChangeText = (t: string) => {
    bufRef.current = t;
    setText(t);
  };

  const reset = () => {
    bufRef.current = '';
    setText('');
  };

  const flushAnd = (suffix: string) => {
    const payload = bufRef.current + suffix;
    reset();
    inputRef.current?.focus();
    if (payload.length > 0) onInput(payload);
  };

  const sendEnter = () => {
    const t = bufRef.current;
    if (ctrl && t.length > 0) {
      const c = t[0].toLowerCase().charCodeAt(0);
      const head = c >= 97 && c <= 122 ? String.fromCharCode(c - 96) : t[0];
      reset();
      setCtrl(false);
      inputRef.current?.focus();
      onInput(head + t.slice(1) + '\r');
      return;
    }
    flushAnd('\r');
  };

  const arrow = (icon: React.ReactNode, data: string) => (
    <Key label={icon} onPress={() => flushAnd(data)} disabled={disabled} />
  );

  return (
    <View style={{
      borderTopWidth: 1,
      borderTopColor: C.border,
      backgroundColor: C.bg,
      paddingHorizontal: 8,
      paddingTop: 6,
      paddingBottom: 6 + kbPad,
      gap: 6,
    }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Key label="Esc" onPress={() => flushAnd('\x1b')} disabled={disabled} />
        <Key label="Tab" onPress={() => flushAnd('\t')} disabled={disabled} />
        <Key label="Ctrl" onPress={() => setCtrl((v) => !v)} active={ctrl} disabled={disabled} />
        <Key label="^C" onPress={() => { reset(); onInput('\x03'); }} disabled={disabled} />
        <View style={{ flex: 1 }} />
        {arrow(<ArrowUp size={14} color={C.text} />, '\x1b[A')}
        {arrow(<ArrowDown size={14} color={C.text} />, '\x1b[B')}
        {arrow(<ArrowLeft size={14} color={C.text} />, '\x1b[D')}
        {arrow(<ArrowRight size={14} color={C.text} />, '\x1b[C')}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={onChangeText}
          onSubmitEditing={sendEnter}
          editable={!disabled}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          keyboardType="ascii-capable"
          returnKeyType="send"
          blurOnSubmit={false}
          placeholder={ctrl ? 'Ctrl + first letter…' : 'Type a command, ↵ to send'}
          placeholderTextColor={C.textMuted}
          style={{
            flex: 1,
            backgroundColor: C.bgInput,
            color: C.text,
            borderWidth: 1,
            borderColor: ctrl ? C.accent : C.border,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            fontSize: 16,
            fontFamily: C.mono,
          }}
        />
        <Pressable
          onPress={sendEnter}
          disabled={disabled}
          accessibilityLabel="Send"
          style={{
            height: 38,
            width: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: C.accent,
            opacity: disabled ? 0.4 : 1,
          }}
        >
          <Send size={16} color="#000" />
        </Pressable>
      </View>
    </View>
  );
}
