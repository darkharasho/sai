// Generic bottom-sheet picker. Modal with instant dim overlay, slide-up sheet.
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, View, Dimensions } from 'react-native';
import { FONT } from '../lib/fonts';

const C = {
  bgSecondary: '#0c0f11',
  bgInput: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  overlay: 'rgba(0,0,0,0.55)',
  mono: FONT.mono,
};

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface Option<T> {
  value: T;
  label: string;
  hint?: string;
  color?: string;
}

interface Props<T> {
  open: boolean;
  title: string;
  options: Option<T>[];
  current: T | undefined;
  onSelect: (value: T | undefined) => void;
  onClose: () => void;
  allowClear?: boolean;
  clearLabel?: string;
}

export default function PickerSheet<T extends string>({
  open, title, options, current, onSelect, onClose, allowClear, clearLabel,
}: Props<T>) {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (open) {
      slideAnim.setValue(SCREEN_HEIGHT);
      Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 200, useNativeDriver: true }).start();
    }
  }, [open]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}
      >
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
              maxHeight: SCREEN_HEIGHT * 0.7,
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
                {title}
              </Text>
            </View>
            <ScrollView>
              {allowClear && (
                <Pressable
                  onPress={() => { onSelect(undefined); onClose(); }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: C.border,
                  }}
                >
                  <Text style={{
                    fontSize: 14,
                    color: current === undefined ? C.accent : C.textMuted,
                  }}>
                    {clearLabel ?? 'Use desktop default'}
                  </Text>
                </Pressable>
              )}
              {options.map((opt) => {
                const selected = opt.value === current;
                return (
                  <Pressable
                    key={String(opt.value)}
                    onPress={() => { onSelect(opt.value); onClose(); }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: C.border,
                    }}
                  >
                    {opt.color ? (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: opt.color,
                        }}
                      />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={{
                        fontSize: 14,
                        color: selected ? (opt.color ?? C.accent) : C.text,
                        fontWeight: selected ? '600' : '400',
                      }}>
                        {opt.label}
                      </Text>
                      {opt.hint ? (
                        <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                          {opt.hint}
                        </Text>
                      ) : null}
                    </View>
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
