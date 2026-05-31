// Composer port. Mirrors src/renderer-remote/chat/Composer.tsx feature-set:
// image attachments (multi, with thumbnails + remove), effort cycle button,
// model picker sheet, perm-mode picker sheet, send/stop button. Keeps the
// existing expo-image-picker + manipulator path (resize to 1568px) and
// extends it to multi-attach.
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  ChevronDown, ChevronUp, Minus, Paperclip, Send, Shield, ShieldOff, Square, X,
} from 'lucide-react-native';
import PickerSheet from './PickerSheet';

export type EffortLevel = 'low' | 'medium' | 'high';
export type PermMode = 'auto' | 'auto-read' | 'always-ask';

export interface SessionOverrides {
  model?: string;
  effort?: EffortLevel;
  permMode?: PermMode;
}

export interface ComposerProps {
  streaming: boolean;
  disabled?: boolean;
  onSend(text: string, images?: string[]): void;
  onInterrupt?(): void;
  overrides: SessionOverrides;
  onOverridesChange(next: SessionOverrides): void;
}

const C = {
  bgSecondary: '#0c0f11',
  bgInput: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textSecondary: '#a0acbb',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  red: '#E35535',
  orange: '#f59e0b',
  green: '#4ade80',
  mono: 'Menlo',
};

const EFFORT_CONFIG = {
  low:    { icon: ChevronDown, label: 'Lo',  color: C.textMuted,      next: 'medium' as const },
  medium: { icon: Minus,       label: 'Med', color: C.textSecondary,  next: 'high'   as const },
  high:   { icon: ChevronUp,   label: 'Hi',  color: C.accent,         next: 'low'    as const },
};

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7',           label: 'Opus',   hint: 'Most capable',  color: C.orange },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet', hint: 'Balanced',      color: C.accent },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku',  hint: 'Fastest',       color: C.green },
];

const PERM_MODES: { value: PermMode; label: string; hint?: string }[] = [
  { value: 'always-ask', label: 'Ask',    hint: 'Approve every tool' },
  { value: 'auto-read',  label: 'Auto-r', hint: 'Allow reads, ask for writes' },
  { value: 'auto',       label: 'Bypass', hint: 'Allow all tools (no prompts)' },
];

const MAX_ATTACHMENTS = 6;
type Sheet = 'model' | 'permMode' | null;

export function Composer({
  streaming, disabled, onSend, onInterrupt, overrides, onOverridesChange,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);

  const pick = async () => {
    if (images.length >= MAX_ATTACHMENTS) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: false,
      quality: 0.9,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const resized = await ImageManipulator.manipulateAsync(
      a.uri,
      [{ resize: { width: 1568 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (resized.base64) {
      setImages((prev) => [...prev, `data:image/jpeg;base64,${resized.base64}`]);
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t && images.length === 0) return;
    // Match PWA: send single-space placeholder if only images.
    onSend(t || ' ', images.length > 0 ? images : undefined);
    setText('');
    setImages([]);
  };

  const effort = overrides.effort ?? 'medium';
  const effortCfg = EFFORT_CONFIG[effort];
  const EffortIcon = effortCfg.icon;
  const cycleEffort = () => onOverridesChange({ ...overrides, effort: effortCfg.next });

  const model = MODEL_OPTIONS.find((m) => m.value === overrides.model);
  const permMode = PERM_MODES.find((p) => p.value === overrides.permMode);
  const bypassActive = overrides.permMode === 'auto';

  const canSend = !disabled && (text.trim().length > 0 || images.length > 0);

  // Shared style for the small toolbar pill buttons. PWA renders these as
  // 26px-tall transparent pills with a 6px radius and a small gap between
  // icon + label; we mirror that.
  const toolbarBtn = (extra: object = {}) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
    height: 26,
    ...extra,
  });

  return (
    <View
      style={{
        paddingTop: 8,
        paddingHorizontal: 10,
        paddingBottom: 12,
        gap: 6,
        borderTopWidth: 1,
        borderTopColor: C.border,
        backgroundColor: C.bgSecondary,
      }}
    >
      {images.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          style={{ paddingBottom: 2 }}
        >
          {images.map((src, i) => (
            <View
              key={i}
              style={{
                width: 56, height: 56,
                borderRadius: 8,
                overflow: 'hidden',
                borderWidth: 1, borderColor: C.border,
                backgroundColor: C.bgInput,
              }}
            >
              <Image source={{ uri: src }} style={{ width: 56, height: 56 }} />
              <Pressable
                onPress={() => setImages((p) => p.filter((_, j) => j !== i))}
                accessibilityLabel="Remove image"
                style={{
                  position: 'absolute',
                  top: 2, right: 2,
                  width: 18, height: 18, borderRadius: 9,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.65)',
                }}
              >
                <X size={11} color="#fff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={streaming ? 'Responding…' : 'Message'}
        placeholderTextColor={C.textMuted}
        editable={!disabled}
        multiline
        style={{
          backgroundColor: C.bgInput,
          color: C.text,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 16,
          maxHeight: 120,
        }}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', gap: 4 }}
      >
        <Pressable
          onPress={pick}
          disabled={disabled || images.length >= MAX_ATTACHMENTS}
          style={toolbarBtn({ opacity: images.length >= MAX_ATTACHMENTS ? 0.4 : 1 })}
        >
          <Paperclip size={14} color={images.length > 0 ? C.accent : C.textMuted} />
          {images.length > 0 ? (
            <Text style={{ fontSize: 12, color: C.accent, fontFamily: C.mono }}>{images.length}</Text>
          ) : null}
        </Pressable>

        <Pressable onPress={cycleEffort} style={toolbarBtn()}>
          <EffortIcon size={14} color={effortCfg.color} />
          <Text style={{ fontSize: 12, color: effortCfg.color, fontFamily: C.mono }}>
            {effortCfg.label}
          </Text>
        </Pressable>

        <Pressable onPress={() => setSheet('model')} style={toolbarBtn()}>
          <Text style={{
            fontSize: 12,
            color: model?.color ?? C.textMuted,
            fontFamily: C.mono,
          }}>
            {model?.label ?? 'Model'}
          </Text>
          <ChevronDown size={11} color={C.textMuted} />
        </Pressable>

        <Pressable
          onPress={() => setSheet('permMode')}
          style={toolbarBtn({
            borderColor: bypassActive ? C.orange : 'transparent',
          })}
        >
          {bypassActive
            ? <ShieldOff size={13} color={C.orange} />
            : <Shield size={13} color={C.textMuted} />}
          <Text style={{
            fontSize: 12,
            color: bypassActive ? C.orange : C.textMuted,
            fontFamily: C.mono,
          }}>
            {permMode?.label ?? 'Mode'}
          </Text>
        </Pressable>

        <View style={{ flex: 1, minWidth: 8 }} />

        {streaming ? (
          <Pressable
            onPress={onInterrupt}
            style={toolbarBtn({ borderColor: C.red })}
          >
            <Square size={13} color={C.red} fill={C.red} />
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canSend}
            style={toolbarBtn({
              paddingHorizontal: 10,
              backgroundColor: canSend ? C.accent : 'transparent',
              borderColor: canSend ? C.accent : C.border,
              opacity: canSend ? 1 : 0.7,
            })}
          >
            <Send size={13} color={canSend ? '#000' : C.textMuted} />
          </Pressable>
        )}
      </ScrollView>

      <PickerSheet
        open={sheet === 'model'}
        title="Model"
        options={MODEL_OPTIONS}
        current={overrides.model}
        onSelect={(v) => onOverridesChange({ ...overrides, model: v })}
        onClose={() => setSheet(null)}
        allowClear
      />
      <PickerSheet
        open={sheet === 'permMode'}
        title="Approval mode"
        options={PERM_MODES}
        current={overrides.permMode}
        onSelect={(v) => onOverridesChange({ ...overrides, permMode: v })}
        onClose={() => setSheet(null)}
        allowClear
      />
    </View>
  );
}
