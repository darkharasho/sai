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

  // Callers pass the live renderer document, which always has a defaultView;
  // the window fallback is only a defensive default.
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

// Deliberately larger than any window; the main-process `sai:capture-region`
// IPC clamps the rect to the live window's content bounds, so this captures
// the whole window without the renderer needing to know its size.
const OVERSIZED_CAPTURE_RECT = { x: 0, y: 0, width: 100000, height: 100000 };

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

    let rect = OVERSIZED_CAPTURE_RECT;
    const selector = typeof req.input?.selector === 'string' ? req.input.selector : '';
    if (selector) {
      const found = inspectElement({ selector });
      if (!found.found || !found.rect) {
        return { ok: false, error: `capture_app: no element matches ${selector}` };
      }
      rect = found.rect;
    }

    const base64 = await capture(rect);
    if (!base64) return { ok: false, error: 'capture returned no image' };
    return { ok: true, __mcpImage: { base64, mimeType: 'image/png' as const } };
  }
  return null;
}
