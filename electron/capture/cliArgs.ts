export function spectacleArgs(outPath: string): string[] {
  return ['-b', '-n', '-a', '-o', outPath];
}

export function grimArgs(outPath: string): string[] {
  return [outPath];
}

export function screencaptureArgs(outPath: string): string[] {
  return ['-x', '-o', outPath];
}
