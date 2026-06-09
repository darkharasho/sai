export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

let cached: MermaidApi | null = null;
let counter = 0;

// Dynamic import keeps mermaid (large) out of the main bundle; it loads only the
// first time the agent renders a diagram.
async function loadMermaid(): Promise<MermaidApi> {
  if (cached) return cached;
  const mod = (await import('mermaid')) as unknown as { default?: MermaidApi } & MermaidApi;
  const api = (mod.default ?? mod) as MermaidApi;
  api.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
  cached = api;
  return api;
}

/**
 * Render Mermaid source to an SVG string. `api` is injectable for tests; in the
 * app it defaults to the dynamically-imported mermaid module. Each call uses a
 * unique DOM id (mermaid requires it). Throws on a parse/render error.
 */
export async function renderMermaidToSvg(diagram: string, api?: MermaidApi): Promise<string> {
  const m = api ?? (await loadMermaid());
  const id = `sai-mermaid-${(counter = (counter + 1) % 1e9)}`;
  const { svg } = await m.render(id, diagram);
  return svg;
}
