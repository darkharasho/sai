import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

// Apple logo (simplified)
export function AppleIcon({ size = 20, color = '#bec6d0' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
        fill={color}
      />
    </Svg>
  );
}

// Windows logo
export function WindowsIcon({ size = 20, color = '#bec6d0' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 5.548l7.206-0.985v6.952H3V5.548z" fill={color} />
      <Path d="M11.26 4.442L21 3v8.515h-9.74V4.442z" fill={color} />
      <Path d="M3 12.485h7.206v6.952L3 18.452V12.485z" fill={color} />
      <Path d="M11.26 12.485H21V21l-9.74-1.442V12.485z" fill={color} />
    </Svg>
  );
}

// Linux (Tux simplified)
export function LinuxIcon({ size = 20, color = '#bec6d0' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2C9.24 2 7 4.24 7 7v3.59c-1.14.51-2 1.56-2 2.91 0 1.1.55 2.07 1.38 2.66C6.14 17.06 6 18 6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2 0-1-.14-1.94-.38-2.84C18.45 15.57 19 14.6 19 13.5c0-1.35-.86-2.4-2-2.91V7c0-2.76-2.24-5-5-5zm-2 6a1 1 0 110 2 1 1 0 010-2zm4 0a1 1 0 110 2 1 1 0 010-2zm-4.5 4h5l-1 1.5h-3l-1-1.5z"
        fill={color}
      />
    </Svg>
  );
}

// Generic monitor for unknown OS
export function MonitorIcon({ size = 20, color = '#bec6d0' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm4 16h8m-4-2v2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Infer OS from machine label or hostUrl */
export function guessOs(label: string, hostUrl: string): 'mac' | 'windows' | 'linux' | 'unknown' {
  const s = `${label} ${hostUrl}`.toLowerCase();
  if (s.includes('mac') || s.includes('imac') || s.includes('macbook') || s.includes('mini')) return 'mac';
  if (s.includes('windows') || s.includes('win-') || s.includes('desktop-')) return 'windows';
  if (s.includes('linux') || s.includes('ubuntu') || s.includes('debian') || s.includes('fedora') || s.includes('arch')) return 'linux';
  return 'unknown';
}

export function OsIcon({ os, size, color }: Props & { os: ReturnType<typeof guessOs> }) {
  switch (os) {
    case 'mac': return <AppleIcon size={size} color={color} />;
    case 'windows': return <WindowsIcon size={size} color={color} />;
    case 'linux': return <LinuxIcon size={size} color={color} />;
    default: return <MonitorIcon size={size} color={color} />;
  }
}
