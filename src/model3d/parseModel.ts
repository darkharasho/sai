import type * as THREE from 'three';
import type { ModelExt } from './modelFiles';

export interface ParsedModel {
  object: THREE.Object3D;
  triangles: number;
  size: { x: number; y: number; z: number };
  box: THREE.Box3;
}

function invalid(reason: string): Error {
  return new Error(`invalid model: ${reason}`);
}

export async function parseModel(buf: ArrayBuffer, ext: ModelExt): Promise<ParsedModel> {
  if (!buf || buf.byteLength === 0) throw invalid('empty file');
  const T = await import('three');
  let object: THREE.Object3D;
  try {
    if (ext === 'stl') {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = new STLLoader().parse(buf);
      // Always recompute: many exporters write 0 0 0 facet normals.
      geometry.computeVertexNormals();
      const material = new T.MeshStandardMaterial({
        color: 0xb8c4d0,
        metalness: 0.1,
        roughness: 0.6,
        flatShading: false,
      });
      object = new T.Mesh(geometry, material);
    } else if (ext === '3mf') {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      object = new ThreeMFLoader().parse(buf);
    } else {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      object = new OBJLoader().parse(new TextDecoder().decode(buf));
    }
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }

  let triangles = 0;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    triangles += Math.floor((g.index ? g.index.count : pos.count) / 3);
  });
  if (triangles === 0) throw invalid('no triangles');

  const box = new T.Box3().setFromObject(object);
  const s = box.getSize(new T.Vector3());
  if (![s.x, s.y, s.z].every(Number.isFinite)) throw invalid('non-finite bounds');
  return { object, triangles, size: { x: s.x, y: s.y, z: s.z }, box };
}
