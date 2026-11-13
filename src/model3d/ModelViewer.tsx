import { useEffect, useRef, useState, useCallback } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw, Grid3x3 } from 'lucide-react';
import type { ModelExt } from './modelFiles';
import { framingFor, nextView, type Preset } from './viewState';
import './ModelViewer.css';

const FOV = 45;

export interface ModelViewerProps {
  load: () => Promise<{ buf: ArrayBuffer; ext: ModelExt }>;
  reloadToken?: number;
  interactive?: boolean;
  toolbar?: boolean;
  onReady?: (info: { triangles: number; size: { x: number; y: number; z: number } }) => void;
  onError?: (msg: string) => void;
  height?: number | '100%';
  /** When false, wheel-zoom is off until the user pointer-downs inside the canvas (so chat scrolling isn't hijacked). */
  wheelZoom?: boolean;
}

interface Ctx {
  T: typeof THREE;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls | null;
  light: THREE.DirectionalLight;
  draw: () => void;
  mesh: THREE.Object3D | null;
  grid: THREE.Object3D | null;
  box: THREE.Box3 | null;
  framed: boolean;
  wireframe: boolean;
  dead: boolean;
}

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose?.();
  });
}

function applyWireframe(obj: THREE.Object3D, on: boolean) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) (mat as THREE.MeshStandardMaterial).wireframe = on;
  });
}

const fmt = (n: number) => n.toFixed(1);

export default function ModelViewer({
  load,
  reloadToken = 0,
  interactive = true,
  toolbar = true,
  onReady,
  onError,
  height = '100%',
  wheelZoom = true,
}: ModelViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  loadRef.current = load;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [info, setInfo] = useState<{ triangles: number; size: { x: number; y: number; z: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const wireframeRef = useRef(false);
  wireframeRef.current = wireframe;
  const wheelZoomRef = useRef(wheelZoom);
  wheelZoomRef.current = wheelZoom;

  // Renderer / scene / controls setup.
  useEffect(() => {
    let disposed = false;
    let created: Ctx | null = null;
    let ro: ResizeObserver | null = null;
    let onDown: (() => void) | null = null;
    let onLeave: (() => void) | null = null;
    let onLost: ((ev: Event) => void) | null = null;

    rootRef.current?.removeAttribute('data-render-ready');
    const teardown = (c: Ctx) => {
      c.dead = true;
      const el = c.renderer.domElement;
      if (onDown) el.removeEventListener('pointerdown', onDown);
      if (onLeave) el.removeEventListener('pointerleave', onLeave);
      if (onLost) el.removeEventListener('webglcontextlost', onLost);
      c.controls?.removeEventListener('change', c.draw);
      c.controls?.dispose();
      if (c.mesh) disposeObject(c.mesh);
      if (c.grid) disposeObject(c.grid);
      c.renderer.dispose();
      c.renderer.forceContextLoss();
      c.renderer.domElement.remove();
    };

    (async () => {
     let renderer: THREE.WebGLRenderer | null = null;
     try {
      const T = await import('three');
      const { OrbitControls: Controls } = interactive
        ? await import('three/examples/jsm/controls/OrbitControls.js')
        : { OrbitControls: null };
      if (disposed || !hostRef.current || !rootRef.current) return;

      try {
        renderer = new T.WebGLRenderer({ antialias: true });
      } catch {
        if (!disposed) setUnavailable(true);
        return;
      }
      const rd: THREE.WebGLRenderer = renderer;
      const host = hostRef.current;
      const cs = getComputedStyle(rootRef.current);
      const bg = cs.getPropertyValue('--bg-primary').trim() || cs.getPropertyValue('--surface-1').trim() || '#1e1e1e';
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(bg);
      host.appendChild(renderer.domElement);

      const scene = new T.Scene();
      scene.add(new T.HemisphereLight(0xffffff, 0x444455, 0.8));
      const light = new T.DirectionalLight(0xffffff, 1.0);
      scene.add(light);
      const camera = new T.PerspectiveCamera(FOV, 1, 0.1, 1000);
      camera.up.set(0, 0, 1);

      const c: Ctx = {
        T, renderer, scene, camera, light,
        controls: null, mesh: null, grid: null, box: null,
        framed: false, wireframe: wireframeRef.current, dead: false,
        draw: () => {
          if (c.dead) return;
          light.position.copy(camera.position);
          rd.render(scene, camera);
        },
      };
      if (Controls) {
        c.controls = new Controls(camera, renderer.domElement);
        c.controls.addEventListener('change', c.draw);
        if (!wheelZoomRef.current) {
          const ctl = c.controls;
          const el = renderer.domElement;
          ctl.enableZoom = false;
          onDown = () => { ctl.enableZoom = true; };
          onLeave = () => { ctl.enableZoom = false; };
          el.addEventListener('pointerdown', onDown);
          el.addEventListener('pointerleave', onLeave);
        }
      }
      onLost = (ev: Event) => {
        ev.preventDefault();
        if (disposed) return;
        setUnavailable(true);
        onErrorRef.current?.('WebGL context lost');
      };
      renderer.domElement.addEventListener('webglcontextlost', onLost);
      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        rd.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        c.draw();
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(host);
      created = c;
      setCtx(c);
     } catch (e) {
      const r = renderer as THREE.WebGLRenderer | null;
      if (r) {
        r.dispose();
        r.forceContextLoss();
        r.domElement.remove();
      }
      created = null;
      if (disposed) return;
      setUnavailable(true);
      onErrorRef.current?.(e instanceof Error ? e.message : String(e));
     }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      if (created) teardown(created);
    };
  }, [interactive]);

  // Load / reload: swap the mesh only, never touch the camera after the first fit.
  useEffect(() => {
    if (!ctx) return;
    let disposed = false;
    (async () => {
      try {
        const { buf, ext } = await loadRef.current();
        if (disposed || ctx.dead) return;
        const { parseModel } = await import('./parseModel');
        const parsed = await parseModel(buf, ext);
        if (disposed || ctx.dead) { disposeObject(parsed.object); return; }

        const { T } = ctx;
        let box = parsed.box;
        if (ext === 'obj') {
          parsed.object.rotation.x = Math.PI / 2; // Y-up -> Z-up
          parsed.object.updateMatrixWorld(true);
          box = new T.Box3().setFromObject(parsed.object);
        }
        const sz = box.getSize(new T.Vector3());
        const size = { x: sz.x, y: sz.y, z: sz.z };

        if (ctx.mesh) { ctx.scene.remove(ctx.mesh); disposeObject(ctx.mesh); }
        if (ctx.grid) { ctx.scene.remove(ctx.grid); disposeObject(ctx.grid); }
        applyWireframe(parsed.object, ctx.wireframe);
        ctx.scene.add(parsed.object);
        ctx.mesh = parsed.object;
        ctx.box = box;

        const footprint = Math.max(size.x, size.y, 1e-3) * 2;
        const grid = new T.GridHelper(footprint, 20, 0x666666, 0x333333);
        grid.rotation.x = Math.PI / 2;
        grid.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
        ctx.scene.add(grid);
        ctx.grid = grid;

        const prev = ctx.framed
          ? { position: ctx.camera.position, target: ctx.controls?.target ?? new T.Vector3() }
          : null;
        if (nextView(prev, box) === 'fit') {
          applyFraming(ctx, 'iso');
          ctx.framed = true;
        }
        ctx.draw();
        rootRef.current?.setAttribute('data-render-ready', 'true');
        setInfo({ triangles: parsed.triangles, size });
        setError(null);
        onReadyRef.current?.({ triangles: parsed.triangles, size });
      } catch (e) {
        if (disposed || ctx.dead) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onErrorRef.current?.(msg);
      }
    })();
    return () => { disposed = true; };
  }, [ctx, reloadToken]);

  const preset = useCallback((p: Preset) => {
    if (ctx) applyFraming(ctx, p);
  }, [ctx]);

  const toggleWire = useCallback(() => {
    if (!ctx) return;
    ctx.wireframe = !ctx.wireframe;
    if (ctx.mesh) applyWireframe(ctx.mesh, ctx.wireframe);
    setWireframe(ctx.wireframe);
    ctx.draw();
  }, [ctx]);

  if (unavailable) {
    return (
      <div className="model-viewer" style={{ height }}>
        <div className="model-viewer-unavailable">3D view unavailable (WebGL could not start)</div>
      </div>
    );
  }

  return (
    <div className="model-viewer" ref={rootRef} style={{ height }}>
      <div className="model-viewer-canvas" ref={hostRef} />
      {toolbar && (
        <div className="model-viewer-toolbar">
          <button style={btnStyle} title="Reset view" aria-label="Reset view" onClick={() => preset('iso')}>
            <RotateCcw size={14} />
          </button>
          {(['iso', 'front', 'top', 'right'] as Preset[]).map((p) => (
            <button key={p} style={btnStyle} title={`${p[0].toUpperCase()}${p.slice(1)} view`} onClick={() => preset(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
          <button
            style={{ ...btnStyle, color: wireframe ? 'var(--accent, #4fc3f7)' : 'var(--text-muted)' }}
            title="Toggle wireframe"
            aria-label="Toggle wireframe"
            aria-pressed={wireframe}
            onClick={toggleWire}
          >
            <Grid3x3 size={14} />
          </button>
        </div>
      )}
      {info && (
        <div className="model-viewer-status">
          {info.triangles} triangles · {fmt(info.size.x)}×{fmt(info.size.y)}×{fmt(info.size.z)} mm
        </div>
      )}
      {error && <div className="model-viewer-error">{error}</div>}
    </div>
  );
}

function applyFraming(ctx: Ctx, p: Preset) {
  if (!ctx.box) return;
  const f = framingFor(ctx.box, p, FOV);
  ctx.camera.position.set(f.position.x, f.position.y, f.position.z);
  ctx.camera.near = f.near;
  ctx.camera.far = f.far;
  ctx.camera.updateProjectionMatrix();
  if (ctx.controls) {
    ctx.controls.target.set(f.target.x, f.target.y, f.target.z);
    ctx.controls.update();
  } else {
    ctx.camera.lookAt(f.target.x, f.target.y, f.target.z);
  }
  ctx.draw();
}
