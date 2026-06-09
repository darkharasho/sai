export interface PickFileOpts {
  mode?: 'open' | 'save' | 'directory';
  filters?: { name: string; extensions: string[] }[];
  multi?: boolean;
}

export interface SaiNativeDeps {
  pickFile?: (opts: PickFileOpts) => Promise<string[] | null>;
  notify?: (args: { title: string; body?: string }) => Promise<boolean>;
  clipboardWrite?: (text: string) => Promise<boolean>;
}

export interface SaiNativeRequest { tool: string; input: any; }

/**
 * Handle the native-affordance tools. Returns the result object, or null if
 * `tool` is not one this module owns (so the caller can fall through).
 */
export async function handleSaiNativeToolRequest(req: SaiNativeRequest, deps: SaiNativeDeps): Promise<unknown | null> {
  const input = req.input ?? {};

  if (req.tool === 'pick_file') {
    if (!deps.pickFile) return { ok: false, error: 'pick_file unavailable' };
    const opts: PickFileOpts = {
      mode: input.mode === 'save' || input.mode === 'directory' ? input.mode : 'open',
      filters: Array.isArray(input.filters) ? input.filters : undefined,
      multi: input.multi === true,
    };
    const paths = await deps.pickFile(opts);
    return paths === null ? { cancelled: true } : { paths };
  }

  if (req.tool === 'notify') {
    if (!deps.notify) return { ok: false, error: 'notify unavailable' };
    const title = typeof input.title === 'string' ? input.title : '';
    if (!title) return { ok: false, error: 'notify requires a "title" string' };
    const ok = await deps.notify({ title, body: typeof input.body === 'string' ? input.body : undefined });
    return ok ? { ok: true } : { ok: false, error: 'notifications unavailable' };
  }

  if (req.tool === 'clipboard') {
    if (input.action === 'read') return { ok: false, error: 'clipboard read not supported' };
    if (!deps.clipboardWrite) return { ok: false, error: 'clipboard unavailable' };
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text) return { ok: false, error: 'clipboard requires a "text" string' };
    const ok = await deps.clipboardWrite(text);
    return ok ? { ok: true } : { ok: false, error: 'clipboard write failed' };
  }

  return null;
}
