// React Native port of src/renderer-remote/branding/SaiLogo.tsx — same
// 5-subpath SAI mark, with a tractable subset of the desktop animation
// modes (pulse, inhale, scatter, wave, pendulum). The desktop's full 17-mode
// chain is intentionally not reproduced here: the modes ported are the ones
// that read clearly at chat-bubble size on mobile.
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

export type SaiLogoMode = 'static' | 'pulse' | 'inhale' | 'scatter' | 'wave' | 'pendulum';

const AnimatedG = Animated.createAnimatedComponent(G);

// Original sai-new-2 path data (5 closed subpaths: bottom, left, right, center, top).
// Verbatim from src/renderer-remote/branding/SaiLogo.tsx.
const ORIGINAL_D =
  'm -332.87752,156.98433 c -0.88652,-0.39969 -3.74667,-3.0845 -11.19787,-10.51137 -5.50398,-5.48602 -10.23672,-10.41631 -10.51719,-10.95622 -0.74898,-1.4418 -0.66429,-3.03718 0.2366,-4.45666 0.41059,-0.64695 1.90602,-2.26413 3.32318,-3.59374 2.78058,-2.60879 4.04486,-3.23866 5.75926,-2.86924 1.56301,0.3368 2.11745,0.79594 7.36894,6.10219 3.01138,3.04278 5.53518,5.3716 6.06204,5.59371 1.89133,0.7973 2.30358,0.52639 8.35775,-5.49219 6.62589,-6.58694 7.43163,-7.05484 10.05417,-5.83847 1.43338,0.66482 6.65123,6.0064 6.88118,7.04436 0.096,0.43314 0.22521,0.9491 0.28723,1.14658 0.062,0.19749 -0.0169,0.85233 -0.17533,1.45521 -0.24942,0.94901 -1.67923,2.4939 -10.65205,11.50934 -6.88764,6.92036 -10.71894,10.57924 -11.42229,10.90825 -1.37289,0.64221 -2.88061,0.62779 -4.36562,-0.0418 z m -35.05729,-34.54629 c -1.31998,-0.687 -20.49096,-19.92498 -21.05566,-21.12924 -0.59002,-1.25828 -0.64879,-2.997174 -0.14113,-4.175684 0.41044,-0.95281 20.10626,-20.720136 21.23385,-21.310936 0.96292,-0.50453 2.96169,-0.49512 3.93169,0.0185 0.43656,0.23116 2.17663,1.82934 3.86681,3.5515 3.37084,3.4346 3.70458,4.09448 3.13695,6.20248 -0.24456,0.90822 -1.20449,2.01644 -5.63365,6.503906 -2.93637,2.97504 -5.44021,5.70524 -5.56408,6.06712 -0.57696,1.68555 -0.15698,2.297424 5.511,8.028974 4.40982,4.45928 5.43267,5.63439 5.7077,6.55736 0.58938,1.97794 0.0967,2.93423 -3.28299,6.37257 -1.62139,1.64953 -3.2695,3.16758 -3.66246,3.37344 -0.93758,0.49119 -3.04912,0.4599 -4.04803,-0.06 z m 69.96794,-0.32873 c -1.37182,-0.88988 -4.92327,-4.4651 -5.91503,-5.95462 -0.80744,-1.2127 -0.91233,-2.9104 -0.26008,-4.20955 0.23382,-0.46571 2.79367,-3.23463 5.68855,-6.15315 5.18114,-5.22345 5.26341,-5.32394 5.26341,-6.429284 0,-0.61759 -0.17057,-1.4444 -0.37905,-1.83736 -0.20848,-0.39296 -2.60184,-2.91712 -5.31859,-5.60926 -2.71674,-2.692126 -5.10601,-5.277916 -5.30949,-5.746186 -0.47539,-1.09405 -0.47339,-2.8139 0.004,-3.7258 0.69032,-1.31768 6.28987,-6.56846 7.38201,-6.92221 1.08394,-0.3511 2.4985,-0.19844 3.61163,0.38977 0.36883,0.1949 5.20447,4.91742 10.74587,10.4945 8.52963,8.584546 10.12277,10.307206 10.3849,11.229166 0.37907,1.33329 0.38062,1.54757 0.0208,2.879724 -0.24154,0.89439 -1.87053,2.64918 -10.51571,11.32781 -6.19252,6.21648 -10.58202,10.41945 -11.1221,10.64948 -1.45014,0.61764 -2.94508,0.4839 -4.28152,-0.38303 z M -338.849,111.51137 c -2.2167,-0.53038 -3.93048,-2.50859 -4.2149,-4.86524 -0.0908,-0.75272 -0.12802,-4.6428 -0.0826,-8.644624 0.0816,-7.19725 0.0897,-7.28882 0.744,-8.456426 0.74372,-1.32718 1.96199,-2.2582 3.49518,-2.67104 0.64869,-0.17467 3.96137,-0.24841 8.88973,-0.19788 7.81819,0.0802 7.86135,0.0837 9.0361,0.74202 1.30104,0.72907 2.24436,1.94155 2.65183,3.408456 0.3667,1.32013 0.3468,15.478014 -0.0237,16.832164 -0.40752,1.48963 -2.42051,3.39272 -4.01272,3.79364 -1.35642,0.34155 -15.09644,0.39067 -16.48295,0.0589 z m -8.84519,-38.26977 c -1.02775,-0.44125 -6.43523,-5.65524 -7.03001,-6.77847 -0.64382,-1.21586 -0.48348,-3.11892 0.3757,-4.45926 0.41471,-0.64695 5.24489,-5.581591 10.73372,-10.965862 8.11595,-7.961347 10.21102,-9.880097 11.21837,-10.274253 1.36486,-0.534041 2.69622,-0.452025 4.11073,0.253235 0.45766,0.228189 5.44873,5.017049 11.09125,10.641912 9.39129,9.361888 10.29204,10.336988 10.64805,11.526988 0.57385,1.91813 0.19643,2.96429 -1.88937,5.23714 -2.86803,3.12525 -4.99813,4.92408 -6.06872,5.12492 -2.08964,0.39202 -2.74709,-0.0582 -8.71576,-5.96786 -3.05594,-3.02575 -5.81631,-5.63404 -6.13417,-5.7962 -0.86818,-0.44293 -1.9662,-0.35487 -2.93416,0.23529 -0.47644,0.29049 -3.26146,2.90846 -6.18893,5.81773 -6.10814,6.07015 -6.7669,6.45645 -9.2167,5.40469 z';

function splitPath(d: string): string[] {
  const re = /([a-zA-Z])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;
  const tokens: { t: 'c' | 'n'; v: string | number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ t: 'c', v: m[1] });
    else tokens.push({ t: 'n', v: parseFloat(m[2]) });
  }
  const out: string[] = [];
  let buf = '';
  let cmd: string | null = null;
  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const num = (n: number): number[] => {
    const a: number[] = [];
    for (let k = 0; k < n; k++) a.push(tokens[i++].v as number);
    return a;
  };
  while (i < tokens.length) {
    if (tokens[i].t === 'c') { cmd = tokens[i].v as string; i++; }
    if (cmd === 'M' || cmd === 'm') {
      const [x, y] = num(2);
      const ax = cmd === 'M' ? x : cx + x;
      const ay = cmd === 'M' ? y : cy + y;
      if (buf) out.push(buf);
      buf = `M ${ax} ${ay}`;
      cx = sx = ax; cy = sy = ay;
      cmd = cmd === 'M' ? 'L' : 'l';
    } else if (cmd === 'C' || cmd === 'c') {
      const [x1, y1, x2, y2, x, y] = num(6);
      const a = cmd === 'C'
        ? [x1, y1, x2, y2, x, y]
        : [cx + x1, cy + y1, cx + x2, cy + y2, cx + x, cy + y];
      buf += ` C ${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${a[5]}`;
      cx = a[4]; cy = a[5];
    } else if (cmd === 'Z' || cmd === 'z') {
      buf += ' Z';
      cx = sx; cy = sy;
    } else {
      i++;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const SUBPATHS = splitPath(ORIGINAL_D);
// Index map mirrors the desktop: 0=bottom, 1=left, 2=right, 3=center, 4=top.
const I_BOTTOM = 0, I_LEFT = 1, I_RIGHT = 2, I_CENTER = 3, I_TOP = 4;

function pathCenter(d: string): { cx: number; cy: number } {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let i = 0;
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) { i++; continue; }
    const x = parseFloat(tokens[i++]);
    const y = parseFloat(tokens[i++] || '0');
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  return { cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2 };
}

const PIVOTS = SUBPATHS.map(pathCenter);

interface Props {
  size?: number;
  color?: string;
  mode?: SaiLogoMode;
}

// Each "shell" gets its own animated transform driven from a shared `t` value
// (0 → 1 → 0). The mode is interpreted inside the worklet so the same set of
// shared values can drive any animation pattern. Per-shell direction is
// expressed in SVG-coordinate units relative to the shell bbox center.
interface ShellAnimProps {
  pathD: string;
  t: SharedValue<number>;
  mode: SharedValue<SaiLogoMode>;
  // Outward unit vector for this shell (toward its position from logo center).
  dx: number;
  dy: number;
  // Phase offset for staggered modes like wave (0..1).
  phase: number;
  color: string;
}

function Shell({ pathD, t, mode, dx, dy, phase, color, pivotX, pivotY }: ShellAnimProps & { pivotX: number; pivotY: number }) {
  const animatedProps = useAnimatedProps(() => {
    'worklet';
    const m = mode.value;
    const v = t.value;
    let tx = 0, ty = 0, scale = 1;
    if (m === 'pulse') {
      scale = 1 + 0.08 * Math.sin(v * Math.PI * 2);
    } else if (m === 'inhale') {
      const amp = -8 * Math.sin(v * Math.PI);
      tx = dx * amp; ty = dy * amp;
    } else if (m === 'scatter') {
      const amp = 6 * Math.sin(v * Math.PI);
      tx = dx * amp; ty = dy * amp;
    } else if (m === 'wave') {
      const local = ((v - phase) % 1 + 1) % 1;
      const peak = Math.max(0, Math.sin(local * Math.PI * 2));
      scale = 1 + 0.18 * peak;
    }
    return { x: tx, y: ty, scale };
  });
  return (
    <AnimatedG
      animatedProps={animatedProps}
      origin={`${pivotX}, ${pivotY}`}
    >
      <Path d={pathD} fill={color} />
    </AnimatedG>
  );
}

export default function SaiLogo({ size = 24, color = '#c7910c', mode = 'static' }: Props) {
  const t = useSharedValue(0);
  const modeShared = useSharedValue<SaiLogoMode>(mode);
  const rot = useSharedValue(0);

  useEffect(() => {
    modeShared.value = mode;
    cancelAnimation(t);
    cancelAnimation(rot);
    if (mode === 'static') {
      t.value = 0;
      rot.value = 0;
      return;
    }
    if (mode === 'pendulum') {
      // Apply rotation at the group level.
      rot.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(-1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
      return;
    }
    // pulse / inhale / scatter / wave all sweep t 0 → 1 cyclically.
    const periodMs = mode === 'pulse' ? 1400
      : mode === 'inhale' ? 2200
      : mode === 'scatter' ? 1600
      : 1800; // wave
    t.value = withRepeat(
      withTiming(1, { duration: periodMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      false,
    );
  }, [mode, t, modeShared, rot]);

  const groupAnimatedProps = useAnimatedProps(() => {
    'worklet';
    return { rotation: rot.value * 14 };
  });

  // The path data uses absolute SVG coordinates with a large negative x
  // translate — the desktop wraps everything in <g transform="translate(389.476 -40.417)">.
  // We do the same so the symbol lands inside our viewBox.
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 117.69488 117.0802">
        <AnimatedG
          animatedProps={groupAnimatedProps}
          origin={`${117.69488 / 2}, ${117.0802 / 2}`}
        >
          <G transform="translate(389.47605 -40.417133)">
            <Shell
              pathD={SUBPATHS[I_TOP]}
              t={t} mode={modeShared}
              dx={0} dy={-1} phase={0} color={color}
              pivotX={PIVOTS[I_TOP].cx} pivotY={PIVOTS[I_TOP].cy}
            />
            <Shell
              pathD={SUBPATHS[I_RIGHT]}
              t={t} mode={modeShared}
              dx={1} dy={0} phase={0.25} color={color}
              pivotX={PIVOTS[I_RIGHT].cx} pivotY={PIVOTS[I_RIGHT].cy}
            />
            <Shell
              pathD={SUBPATHS[I_BOTTOM]}
              t={t} mode={modeShared}
              dx={0} dy={1} phase={0.5} color={color}
              pivotX={PIVOTS[I_BOTTOM].cx} pivotY={PIVOTS[I_BOTTOM].cy}
            />
            <Shell
              pathD={SUBPATHS[I_LEFT]}
              t={t} mode={modeShared}
              dx={-1} dy={0} phase={0.75} color={color}
              pivotX={PIVOTS[I_LEFT].cx} pivotY={PIVOTS[I_LEFT].cy}
            />
            <Path d={SUBPATHS[I_CENTER]} fill={color} />
          </G>
        </AnimatedG>
      </Svg>
    </View>
  );
}
