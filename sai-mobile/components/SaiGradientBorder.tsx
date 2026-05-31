// Animated accent→orange→red→orange→accent stroke around a rounded
// rectangle. Mirrors the desktop SAI ChatInput's `.input-box::before`
// gradient ring (src/components/Chat/ChatInput.tsx:1496-1513). The desktop
// achieves the look via CSS mask-composite — RN has no mask-composite, so
// we draw a 2px-wide rounded rect via react-native-svg and rotate the
// gradient's `gradientTransform` to mimic `background-position` sweep.
//
// On iOS this lives behind a focusable child so the focus state can boost
// stroke opacity (matching `.input-box:focus-within::before`).
import { useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface Props {
  children: React.ReactNode;
  /** Outer radius. The inner content sits inside `radius - strokeWidth`. */
  radius?: number;
  strokeWidth?: number;
  /** Focus boosts opacity 0.7 → 1, matching the desktop. */
  focused?: boolean;
}

export function SaiGradientBorder({
  children,
  radius = 14,
  strokeWidth = 2,
  focused = false,
}: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // gradientTransform rotates around the rect center. A full rotation over
  // ~20s keeps the sweep visible without ever feeling busy.
  const angle = useSharedValue(0);
  useEffect(() => {
    angle.value = withRepeat(
      withTiming(360, { duration: 20000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [angle]);

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    return { gradientTransform: `rotate(${angle.value} 0.5 0.5)` };
  });

  return (
    <View onLayout={onLayout} style={{ position: 'relative' }}>
      {size && (
        <Svg
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
          pointerEvents="none"
        >
          <Defs>
            <AnimatedLinearGradient
              id="sai-grad"
              x1="0"
              y1="0"
              x2="1"
              y2="1"
              animatedProps={animatedProps}
            >
              <Stop offset="0%"   stopColor="#c7910c" />
              <Stop offset="20%"  stopColor="#f59e0b" />
              <Stop offset="50%"  stopColor="#E35535" />
              <Stop offset="80%"  stopColor="#f59e0b" />
              <Stop offset="100%" stopColor="#c7910c" />
            </AnimatedLinearGradient>
          </Defs>
          <Rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={Math.max(0, size.w - strokeWidth)}
            height={Math.max(0, size.h - strokeWidth)}
            rx={radius - strokeWidth / 2}
            ry={radius - strokeWidth / 2}
            stroke="url(#sai-grad)"
            strokeWidth={strokeWidth}
            fill="none"
            opacity={focused ? 1 : 0.7}
          />
        </Svg>
      )}
      {children}
    </View>
  );
}
