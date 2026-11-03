import { describe, it, expect, vi } from 'vitest';
import {
  isBrowserTool,
  handleBrowserToolRequest,
  BROWSER_TOOL_METHODS,
} from '@/lib/browserTools';
import { SAI_TOOL_SCHEMA, toolsForToolset } from '@/lib/saiTools';

describe('browser tool routing', () => {
  it('claims exactly the browser_* tools', () => {
    expect(isBrowserTool('browser_snapshot')).toBe(true);
    expect(isBrowserTool('browser_tabs')).toBe(true);
    expect(isBrowserTool('browser_read')).toBe(true);
    expect(isBrowserTool('capture_window')).toBe(false);
    expect(isBrowserTool('browser_click')).toBe(false);
  });

  it('every routed tool is advertised to the chat toolset', () => {
    const chat = new Set(toolsForToolset('chat').map((t) => t.name));
    for (const name of Object.keys(BROWSER_TOOL_METHODS)) {
      expect(chat.has(name), `${name} missing from chat toolset`).toBe(true);
    }
  });

  it('exposes no write-capable browser tool in this slice', () => {
    const writeVerbs = /^browser_(click|type|press|navigate|scroll|fill|select)/;
    expect(SAI_TOOL_SCHEMA.filter((t) => writeVerbs.test(t.name))).toEqual([]);
  });

  it('maps tool names to bridge methods and forwards input', async () => {
    const browserCall = vi.fn().mockResolvedValue({ text: 'hello' });
    const result = await handleBrowserToolRequest(
      { tool: 'browser_read', input: { tabId: 7, selector: 'main' } },
      { browserCall },
    );

    expect(browserCall).toHaveBeenCalledWith('read', { tabId: 7, selector: 'main' });
    expect(result).toEqual({ ok: true, text: 'hello' });
  });

  it('defaults missing input to an empty object', async () => {
    const browserCall = vi.fn().mockResolvedValue({ tabs: [] });
    await handleBrowserToolRequest({ tool: 'browser_tabs' }, { browserCall });
    expect(browserCall).toHaveBeenCalledWith('tabs.list', {});
  });

  it('hoists a screenshot into __mcpImage and keeps it out of the text payload', async () => {
    const browserCall = vi.fn().mockResolvedValue({
      tabId: 3,
      url: 'https://example.com',
      elements: [{ ref: 'e1', role: 'button', name: 'Submit' }],
      screenshot: { base64: 'AAAA', mimeType: 'image/jpeg', scale: 0.5 },
    });

    const result = (await handleBrowserToolRequest(
      { tool: 'browser_snapshot', input: {} },
      { browserCall },
    )) as Record<string, any>;

    expect(result.__mcpImage).toEqual({ base64: 'AAAA', mimeType: 'image/jpeg' });
    // The text block must describe the image without repeating its bytes.
    expect(result.screenshot).toEqual({ mimeType: 'image/jpeg', scale: 0.5 });
    expect(JSON.stringify({ ...result, __mcpImage: undefined })).not.toContain('AAAA');
    expect(result.elements).toHaveLength(1);
  });

  it('passes through results with no screenshot untouched', async () => {
    const browserCall = vi.fn().mockResolvedValue({ tabId: 1, elements: [] });
    const result = (await handleBrowserToolRequest(
      { tool: 'browser_snapshot', input: { screenshot: false } },
      { browserCall },
    )) as Record<string, any>;

    expect(result.__mcpImage).toBeUndefined();
    expect(result).toEqual({ ok: true, tabId: 1, elements: [] });
  });

  it('reports a build with no bridge instead of hanging', async () => {
    await expect(
      handleBrowserToolRequest({ tool: 'browser_tabs' }, {}),
    ).rejects.toThrow(/browser bridge is unavailable/i);
  });

  it('propagates bridge errors (e.g. no tab attached) to the caller', async () => {
    const browserCall = vi.fn().mockRejectedValue(new Error('No browser is connected.'));
    await expect(
      handleBrowserToolRequest({ tool: 'browser_snapshot' }, { browserCall }),
    ).rejects.toThrow('No browser is connected.');
  });

  it('rejects a tool it does not own', async () => {
    await expect(
      handleBrowserToolRequest({ tool: 'capture_window' }, { browserCall: vi.fn() }),
    ).rejects.toThrow(/not a browser tool/);
  });
});
