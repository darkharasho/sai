// Case-insensitive substring match in either direction. Titles from different
// sources (desktopCapturer vs. xdotool) vary in decoration/suffixes, so an exact
// equality check is too strict.
export function titleMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.includes(y) || y.includes(x);
}

// True only when it is safe to take a CLI active-window capture: the active window
// must be known, must NOT be SAI, and must match the intended pick.
export function activeWindowIsTarget(
  activeTitle: string | null,
  pickTitle: string,
  selfTitle: string,
): boolean {
  if (!activeTitle) return false;
  if (selfTitle && titleMatch(activeTitle, selfTitle)) return false;
  return titleMatch(activeTitle, pickTitle);
}
