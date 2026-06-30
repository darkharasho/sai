import { describe, it, expect, afterEach } from 'vitest';
import { setSaiToolDispatch, getSaiToolDispatch } from '../../../electron/services/saiToolBridge';

describe('saiToolBridge', () => {
  afterEach(() => setSaiToolDispatch(null));

  it('starts null', () => {
    expect(getSaiToolDispatch()).toBeNull();
  });

  it('stores and returns the registered dispatch', async () => {
    const fn = async (req: { tool: string }) => ({ echoed: req.tool });
    setSaiToolDispatch(fn);
    const got = getSaiToolDispatch();
    expect(got).toBe(fn);
    expect(await got!({ tool: 'render_html', input: {}, workspace: '/ws' })).toEqual({ echoed: 'render_html' });
  });

  it('can be cleared back to null', () => {
    setSaiToolDispatch(async () => undefined);
    setSaiToolDispatch(null);
    expect(getSaiToolDispatch()).toBeNull();
  });
});
