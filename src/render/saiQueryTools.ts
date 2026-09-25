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
  /** Workspace currently shown in the window, for the foreground check below. */
  activeWorkspace?: string;
}

export interface SaiQueryRequest {
  tool: string;
  input: any;
  /** Workspace of the session that asked. Absent for callers that have none. */
  workspace?: string;
}

// Deliberately larger than any window; the main-process `sai:capture-region`
// IPC clamps the rect to the live window's content bounds, so this captures
// the whole window without the renderer needing to know its size.
const OVERSIZED_CAPTURE_RECT = { x: 0, y: 0, width: 100000, height: 100000 };

// This home is a symlink (/home/x -> /var/home/x) and the two halves of the app
// disagree about which spelling they report, so workspaces can only be compared
// after both are reduced to one form.
function sameWorkspace(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/^\/var(?=\/home\/)/, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
}

/**
 * `inspect_element` and `capture_app` both read the live renderer — a single
 * DOM showing whichever workspace is in the foreground. A session in a
 * background workspace that calls them gets another workspace's screen and no
 * hint that it did, which is how "the tool just screenshots SAI" happens: the
 * answer is truthful about the window and silently wrong about the subject.
 * Refuse instead, and name the workspace that is actually on screen.
 */
function foregroundError(req: SaiQueryRequest, deps: SaiQueryDeps): { ok: false; error: string } | null {
  const asked = req.workspace;
  const shown = deps.activeWorkspace;
  if (!asked || !shown || sameWorkspace(asked, shown)) return null;
  return {
    ok: false,
    error:
      `${req.tool} reads the window as it is on screen, and SAI is currently showing ` +
      `${shown}, not ${asked}. Switch to that workspace and ask again, or use ` +
      `capture_window to capture a window by name.`,
  };
}

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
    return foregroundError(req, deps) ?? inspectElement(req.input ?? {});
  }
  if (req.tool === 'capture_app') {
    const wrongWorkspace = foregroundError(req, deps);
    if (wrongWorkspace) return wrongWorkspace;
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
