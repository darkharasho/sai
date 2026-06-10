import { describe, it, expect } from 'vitest';
import { handleSaiNativeToolRequest } from '../../../src/render/saiNativeTools';

describe('handleSaiNativeToolRequest', () => {
  it('returns null for an unowned tool', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'render_html', input: {} }, {});
    expect(r).toBeNull();
  });

  it('pick_file returns the chosen paths', async () => {
    const pickFile = async () => ['/a/b.txt'];
    const r = await handleSaiNativeToolRequest({ tool: 'pick_file', input: { mode: 'open' } }, { pickFile });
    expect(r).toEqual({ paths: ['/a/b.txt'] });
  });

  it('pick_file returns cancelled when the dialog is dismissed', async () => {
    const pickFile = async () => null;
    const r = await handleSaiNativeToolRequest({ tool: 'pick_file', input: {} }, { pickFile });
    expect(r).toEqual({ cancelled: true });
  });

  it('pick_file with no dep reports unavailable', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'pick_file', input: {} }, {});
    expect(r).toEqual({ ok: false, error: 'pick_file unavailable' });
  });

  it('notify requires a title', async () => {
    const notify = async () => true;
    const r = await handleSaiNativeToolRequest({ tool: 'notify', input: {} }, { notify });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/title/i);
  });

  it('notify fires and returns ok', async () => {
    let got: any = null;
    const notify = async (a: any) => { got = a; return true; };
    const r = await handleSaiNativeToolRequest({ tool: 'notify', input: { title: 'Done', body: 'built' } }, { notify });
    expect(r).toEqual({ ok: true });
    expect(got).toEqual({ title: 'Done', body: 'built' });
  });

  it('clipboard writes text and returns ok', async () => {
    let written = '';
    const clipboardWrite = async (t: string) => { written = t; return true; };
    const r = await handleSaiNativeToolRequest({ tool: 'clipboard', input: { text: 'hello' } }, { clipboardWrite });
    expect(r).toEqual({ ok: true });
    expect(written).toBe('hello');
  });

  it('clipboard read is explicitly unsupported', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'clipboard', input: { action: 'read' } }, { clipboardWrite: async () => true });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/read not supported/i);
  });

  it('clipboard requires text on write', async () => {
    const r = await handleSaiNativeToolRequest({ tool: 'clipboard', input: {} }, { clipboardWrite: async () => true });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).error).toMatch(/text/i);
  });
});
