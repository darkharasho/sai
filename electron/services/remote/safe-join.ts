import nodePath from 'node:path';

export function safeJoin(cwd: string, relPath: string): string {
  if (nodePath.isAbsolute(relPath)) {
    throw new Error(`absolute paths not allowed: ${relPath}`);
  }
  const normalizedCwd = nodePath.resolve(cwd);
  const resolved = nodePath.resolve(normalizedCwd, relPath);
  if (resolved !== normalizedCwd && !resolved.startsWith(normalizedCwd + nodePath.sep)) {
    throw new Error(`path escapes cwd: ${relPath}`);
  }
  return resolved;
}
