// Per-session status badge for the chat drawer. Mirrors the PWA's icon set
// in src/renderer-remote/chat/NavDrawer.tsx (.pwa-chats-status-* classes):
//
//   awaiting → 14px amber circle with "!"   (blinks slowly)
//   error    → 14px red circle with "!"     (blinks slowly)
//   busy     →  9px accent square           (scale + opacity pulse, 2.2s)
//   unread   →  9px green square            (opacity pulse, 2s)
//   suspended→  9px amber-gold square       (static)
//   none     →  9px transparent spacer      (keeps row alignment)
import { useEffect } from 'react';
import { Text } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export type SessionStatusKind =
  | 'awaiting'
  | 'error'
  | 'busy'
  | 'unread'
  | 'suspended'
  | 'none';

const SQUARE = 9;
const CIRCLE = 14;

const C = {
  amber: '#f59e0b',
  red: '#ef4444',
  accent: '#c7910c',
  green: '#4ade80',
  gold: '#d4a72c',
};

export function SessionStatusIcon({ kind }: { kind: SessionStatusKind }) {
  // One shared opacity drives the per-kind animation; scale only used by busy.
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(opacity);
    cancelAnimation(scale);
    opacity.value = 1;
    scale.value = 1;
    if (kind === 'busy') {
      opacity.value = withRepeat(
        withTiming(0.35, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      scale.value = withRepeat(
        withTiming(0.75, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else if (kind === 'unread') {
      opacity.value = withRepeat(
        withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else if (kind === 'awaiting' || kind === 'error') {
      opacity.value = withRepeat(
        withTiming(0.2, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(scale);
    };
  }, [kind, opacity, scale]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (kind === 'none') {
    return <Animated.View style={{ width: SQUARE, height: SQUARE }} />;
  }
  if (kind === 'awaiting' || kind === 'error') {
    return (
      <Animated.View
        style={[
          {
            width: CIRCLE,
            height: CIRCLE,
            borderRadius: CIRCLE / 2,
            backgroundColor: kind === 'awaiting' ? C.amber : C.red,
            alignItems: 'center',
            justifyContent: 'center',
          },
          animStyle,
        ]}
      >
        <Text
          style={{
            color: '#000',
            fontSize: 10,
            fontWeight: '800',
            lineHeight: 12,
            includeFontPadding: false,
          }}
        >
          !
        </Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View
      style={[
        {
          width: SQUARE,
          height: SQUARE,
          borderRadius: 2,
          backgroundColor:
            kind === 'busy' ? C.accent :
            kind === 'unread' ? C.green :
            C.gold,
        },
        animStyle,
      ]}
    />
  );
}
