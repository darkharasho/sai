// Matches ANSI escape sequences: CSI (ESC[...), OSC (ESC]...BEL/ST), and other ESC sequences
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b\(B|\x1b[=>]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}
