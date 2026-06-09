export interface InspectInput {
  selector: string;
  props?: string[];
}

export interface InspectResult {
  found: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  computed?: Record<string, string>;
  error?: string;
}

// A useful default set. Includes flex-shrink because zero-shrink hairlines in
// flex layouts are a recurring SAI rendering gotcha.
const DEFAULT_PROPS = [
  'display', 'position', 'width', 'height', 'margin', 'padding', 'border',
  'color', 'background-color', 'font-size', 'font-weight', 'opacity',
  'z-index', 'overflow', 'flex-shrink', 'flex-grow',
];

export function inspectElement(input: InspectInput, doc: Document = document): InspectResult {
  const selector = typeof input?.selector === 'string' ? input.selector : '';
  if (!selector) return { found: false, error: 'inspect_element requires a "selector" string' };

  let el: Element | null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return { found: false, error: `invalid selector: ${selector}` };
  }
  if (!el) return { found: false };

  const r = el.getBoundingClientRect();
  const rect = { x: r.x, y: r.y, width: r.width, height: r.height };

  const view = doc.defaultView ?? window;
  const cs = view.getComputedStyle(el);
  const wanted = Array.isArray(input.props) && input.props.length > 0 ? input.props : DEFAULT_PROPS;
  const computed: Record<string, string> = {};
  for (const p of wanted) computed[p] = cs.getPropertyValue(p);

  return { found: true, rect, computed };
}

export interface SaiQueryDeps {
  /** Capture a region of the app window; returns bare base64 PNG or null. */
  captureRegion?: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>;
}

export interface SaiQueryRequest { tool: string; input: any; }

const FULL_WINDOW_RECT = { x: 0, y: 0, width: 100000, height: 100000 }; // clamped to content bounds in main

/**
 * Handles the read-only SAI query tools. Returns the result object, or null if
 * `tool` is not one this module owns (so the caller can fall through to other
 * handlers). `capture_app` results carry `__mcpImage` for the MCP image block.
 */
export async function handleSaiQueryToolRequest(
  req: SaiQueryRequest,
  deps: SaiQueryDeps,
): Promise<unknown | null> {
  if (req.tool === 'inspect_element') {
    return inspectElement(req.input ?? {});
  }
  if (req.tool === 'capture_app') {
    const capture = deps.captureRegion;
    if (!capture) return { ok: false, error: 'capture is unavailable' };

    let rect = FULL_WINDOW_RECT;
    const selector = typeof req.input?.selector === 'string' ? req.input.selector : '';
    if (selector) {
      let el: Element | null = null;
      try { el = document.querySelector(selector); } catch { el = null; }
      if (!el) return { ok: false, error: `capture_app: no element matches ${selector}` };
      const r = el.getBoundingClientRect();
      rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    const base64 = await capture(rect);
    if (!base64) return { ok: false, error: 'capture returned no image' };
    return { ok: true, __mcpImage: { base64, mimeType: 'image/png' as const } };
  }
  return null;
}
