export interface RenderHostParams {
  component?: string;
  components?: string[];
  props?: Record<string, unknown>;
  vars?: Record<string, string>;
  width?: number;
}

/** Build the query string (incl. the render-host flag) for the offscreen window. */
export function renderHostSearch(p: RenderHostParams): string {
  const sp = new URLSearchParams();
  sp.set('render-host', '1');
  if (p.component) sp.set('component', p.component);
  if (p.components) sp.set('components', JSON.stringify(p.components));
  if (p.props) sp.set('props', JSON.stringify(p.props));
  if (p.vars) sp.set('vars', JSON.stringify(p.vars));
  if (typeof p.width === 'number') sp.set('width', String(p.width));
  return sp.toString();
}
