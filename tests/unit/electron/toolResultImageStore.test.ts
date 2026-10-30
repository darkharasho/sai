import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { externalizeToolResultImages, storeImageBase64 } from '../../../electron/services/toolResultImageStore';

const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64');

describe('toolResultImageStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-trimg-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('rewrites base64 tool_result image blocks to sai-file refs on disk', () => {
    const msg = {
      type: 'user',
      projectPath: '/p',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 't1',
          content: [
            { type: 'text', text: '{"ok":true}' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } },
          ],
        }],
      },
    };
    const out = externalizeToolResultImages(msg, dir) as any;
    const img = out.message.content[0].content[1];
    expect(img.source.type).toBe('sai-file');
    expect(img.source.media_type).toBe('image/png');
    expect(img.source.path.startsWith(dir)).toBe(true);
    expect(img.source.path.endsWith('.png')).toBe(true);
    expect(fs.readFileSync(img.source.path).toString()).toBe('fake-png-bytes');
    expect(out.message.content[0].content[0]).toEqual({ type: 'text', text: '{"ok":true}' });
    // input is not mutated (the SDK backend inspects the raw message afterwards)
    expect((msg.message.content[0].content[1] as any).source.type).toBe('base64');
  });

  it('dedupes identical images to one content-addressed file', () => {
    const a = storeImageBase64(PNG_B64, 'image/png', dir);
    const b = storeImageBase64(PNG_B64, 'image/png', dir);
    expect(a).toBe(b);
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it('returns non-image messages unchanged (same reference)', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    expect(externalizeToolResultImages(msg, dir)).toBe(msg);
    const strResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'plain' }] } };
    expect(externalizeToolResultImages(strResult, dir)).toBe(strResult);
  });

  it('keeps the base64 block when the write fails', () => {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'x');
    const msg = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } },
      ] }] },
    };
    const out = externalizeToolResultImages(msg, path.join(blocker, 'sub')) as any;
    expect(out.message.content[0].content[0].source.type).toBe('base64');
  });
});
