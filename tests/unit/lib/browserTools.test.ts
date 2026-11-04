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
    expect(isBrowserTool('browser_click')).toBe(true);
    expect(isBrowserTool('capture_window')).toBe(false);
    expect(isBrowserTool('browser_eval')).toBe(false);
  });

  it('every routed tool is advertised to the chat toolset', () => {
    const chat = new Set(toolsForToolset('chat').map((t) => t.name));
    for (const name of Object.keys(BROWSER_TOOL_METHODS)) {
      expect(chat.has(name), `${name} missing from chat toolset`).toBe(true);
    }
  });

  it('exposes no browser tool that executes arbitrary code in the page', () => {
    // Control is deliberately a fixed verb set. An eval/script/fetch-shaped
    // tool would make the same-origin and control gates meaningless, since
    // the page could then be driven from inside.
    const forbidden = /^browser_(eval|exec|script|inject|fetch|cookies|download)/;
    expect(SAI_TOOL_SCHEMA.filter((t) => forbidden.test(t.name))).toEqual([]);
  });

  it('tells the model that control tools need the user to opt in', () => {
    // If the description omits this, the model retries the refusal instead of
    // telling the user the one thing that would fix it.
    for (const name of ['browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_navigate']) {
      const tool = SAI_TOOL_SCHEMA.find((t) => t.name === name)!;
      expect(tool, `${name} missing`).toBeDefined();
      expect(tool.description, `${name} description`).toMatch(/control/i);
    }
  });

  it('documents that navigation is same-origin only', () => {
    const nav = SAI_TOOL_SCHEMA.find((t) => t.name === 'browser_navigate')!;
    expect(nav.description).toMatch(/same.origin/i);
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

describe('control tools', () => {
  it('maps every control tool to its bridge method', () => {
    expect(BROWSER_TOOL_METHODS).toMatchObject({
      browser_click: 'click',
      browser_type: 'type',
      browser_press: 'press',
      browser_scroll: 'scroll',
      browser_navigate: 'navigate',
    });
  });

  it('claims the control tools as its own', () => {
    for (const tool of ['browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_navigate']) {
      expect(isBrowserTool(tool)).toBe(true);
    }
  });

  it('forwards click params through to the bridge untouched', async () => {
    const browserCall = vi.fn().mockResolvedValue({ tabId: 7, clicked: 'e3', url: 'https://x.test/' });
    const result = (await handleBrowserToolRequest(
      { tool: 'browser_click', input: { ref: 'e3', refGen: 2, tabId: 7 } },
      { browserCall },
    )) as Record<string, any>;

    expect(browserCall).toHaveBeenCalledWith('click', { ref: 'e3', refGen: 2, tabId: 7 });
    expect(result).toEqual({ ok: true, tabId: 7, clicked: 'e3', url: 'https://x.test/' });
  });

  it('surfaces a read-only refusal verbatim rather than swallowing it', async () => {
    // The extension is the consent boundary; its refusal has to reach the
    // model intact so it tells the user how to grant control.
    const browserCall = vi.fn().mockRejectedValue(
      new Error('tab 7 is shared read-only — the user must right-click the SAI toolbar button'),
    );
    await expect(
      handleBrowserToolRequest({ tool: 'browser_click', input: { ref: 'e1' } }, { browserCall }),
    ).rejects.toThrow(/shared read-only/);
  });

  it('surfaces a cross-origin navigation refusal', async () => {
    const browserCall = vi.fn().mockRejectedValue(
      new Error('refusing to navigate from https://a.test to https://b.test — the bridge is same-origin only'),
    );
    await expect(
      handleBrowserToolRequest({ tool: 'browser_navigate', input: { url: 'https://b.test' } }, { browserCall }),
    ).rejects.toThrow(/same-origin only/);
  });
});
