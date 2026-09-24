export function spectacleArgs(outPath: string): string[] {
  return ['-b', '-n', '-a', '-o', outPath];
}

export function grimArgs(outPath: string): string[] {
  return [outPath];
}

export function screencaptureArgs(outPath: string): string[] {
  return ['-x', '-o', outPath];
}

// Whole-display variants. `-f` spans every monitor on KDE; grim and
// screencapture already default to the full screen.
export function spectacleDisplayArgs(outPath: string): string[] {
  return ['-b', '-n', '-f', '-o', outPath];
}

export function grimDisplayArgs(outPath: string): string[] {
  return [outPath];
}

export function screencaptureDisplayArgs(outPath: string): string[] {
  return ['-x', outPath];
}
