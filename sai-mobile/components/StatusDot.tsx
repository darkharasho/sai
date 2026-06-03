// Animated status indicator. Mirrors the PWA's per-workspace dots and adds
// the subtle pulse/blink that conveys "busy" vs "approval needed". Other
// states render as solid colored dots.
//
// `kind` semantics map to workspaceStatusStore.displayPriority and the
// session-row dot states inside NavDrawer:
//   - approval  → amber, slow blink (1s)
//   - busy      → accent, faster pulse (700ms)
//   - completed → green, solid
//   - unread    → green, solid
//   - suspended → muted gold, solid
//   - idle      → green, solid (when used for active workspace)
import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export type StatusDotKind =
  | 'approval'
  | 'busy'
  | 'completed'
  | 'unread'
  | 'suspended'
  | 'idle';

interface Props {
  kind: StatusDotKind;
  size?: number;
  shape?: 'circle' | 'square';
}

const COLOR: Record<StatusDotKind, string> = {
  approval: '#f59e0b',
  busy: '#c7910c',
  completed: '#4ade80',
  unread: '#4ade80',
  suspended: '#d4a72c',
  idle: '#4ade80',
};

export function StatusDot({ kind, size = 8, shape = 'circle' }: Props) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(opacity);
    if (kind === 'busy') {
      opacity.value = 1;
      opacity.value = withRepeat(
        withTiming(0.4, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else if (kind === 'approval') {
      opacity.value = 1;
      opacity.value = withRepeat(
        withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      opacity.value = 1;
    }
    return () => cancelAnimation(opacity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: shape === 'square' ? 2 : size / 2,
          backgroundColor: COLOR[kind],
        },
        animStyle,
      ]}
    />
  );
}
