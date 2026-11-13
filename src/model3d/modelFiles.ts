export type ModelExt = 'stl' | '3mf' | 'obj';

const EXTS: readonly string[] = ['stl', '3mf', 'obj'];

export function modelExt(path: string): ModelExt | null {
  const i = path.lastIndexOf('.');
  if (i < 0) return null;
  const ext = path.slice(i + 1).toLowerCase();
  return EXTS.includes(ext) ? (ext as ModelExt) : null;
}

export function isModelFile(path: string): boolean {
  return modelExt(path) !== null;
}
