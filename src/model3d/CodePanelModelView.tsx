import { useCallback } from 'react';
import ModelViewer from './ModelViewer';
import { modelExt } from './modelFiles';
import { useFileWatch } from './useFileWatch';

/** Code-panel 3D view of a model file; live-reloads when the file changes on disk. */
export default function CodePanelModelView({ path }: { path: string }) {
  const reloadToken = useFileWatch(path);
  const load = useCallback(async () => {
    const ext = modelExt(path);
    if (!ext) throw new Error('Unsupported model file');
    const buf = await window.sai.fsReadFileBuffer!(path);
    return { buf, ext };
  }, [path]);
  return <ModelViewer load={load} reloadToken={reloadToken} height="100%" />;
}
