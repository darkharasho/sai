import type { ModelExt } from './modelFiles';
import { framingFor } from './viewState';

const FOV = 45;

export async function renderModelThumbnail(
  buf: ArrayBuffer,
  ext: ModelExt,
  opts: { width?: number; height?: number } = {},
): Promise<{ base64: string; triangles: number; size: { x: number; y: number; z: number } }> {
  const width = opts.width ?? 640;
  const height = opts.height ?? 480;
  const T = await import('three');
  const { parseModel } = await import('./parseModel');
  const parsed = await parseModel(buf, ext);

  const canvas = document.createElement('canvas');
  let renderer: import('three').WebGLRenderer | null = null;
  const geoms: import('three').Object3D[] = [];
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--sai-surface').trim() || '#1e1e1e';
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(bg);

    let box = parsed.box;
    if (ext === 'obj') {
      parsed.object.rotation.x = Math.PI / 2; // Y-up -> Z-up, as in ModelViewer
      parsed.object.updateMatrixWorld(true);
      box = new T.Box3().setFromObject(parsed.object);
    }
    const sz = box.getSize(new T.Vector3());
    const size = { x: sz.x, y: sz.y, z: sz.z };

    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x444455, 0.8));
    const light = new T.DirectionalLight(0xffffff, 1.0);
    scene.add(light);
    scene.add(parsed.object);
    geoms.push(parsed.object);
    const grid = new T.GridHelper(Math.max(size.x, size.y, 1e-3) * 2, 20, 0x666666, 0x333333);
    grid.rotation.x = Math.PI / 2;
    grid.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    scene.add(grid);
    geoms.push(grid);

    const camera = new T.PerspectiveCamera(FOV, width / height, 0.1, 1000);
    camera.up.set(0, 0, 1);
    const f = framingFor(box, 'iso', FOV);
    camera.position.set(f.position.x, f.position.y, f.position.z);
    camera.near = f.near;
    camera.far = f.far;
    camera.updateProjectionMatrix();
    camera.lookAt(f.target.x, f.target.y, f.target.z);
    light.position.copy(camera.position);

    renderer.render(scene, camera);
    const dataUrl = canvas.toDataURL('image/png');
    return { base64: dataUrl.replace(/^data:image\/png;base64,/, ''), triangles: parsed.triangles, size };
  } finally {
    for (const o of geoms) {
      o.traverse((n) => {
        const m = n as import('three').Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) mat.dispose?.();
      });
    }
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}
