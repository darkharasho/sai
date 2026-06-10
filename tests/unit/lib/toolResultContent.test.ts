import { describe, it, expect } from 'vitest';
import { parseToolResultBlocks } from '../../../src/lib/toolResultContent';

describe('parseToolResultBlocks', () => {
  it('returns string content as text with no images', () => {
    expect(parseToolResultBlocks('hello')).toEqual({ text: 'hello', images: undefined });
  });

  it('joins text blocks and ignores non-image/non-text', () => {
    const content = [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }];
    expect(parseToolResultBlocks(content)).toEqual({ text: 'ab', images: undefined });
  });

  it('maps a sai-file image source to a filePath ref', () => {
    const content = [
      { type: 'text', text: '[image: foo.png]' },
      { type: 'image', source: { type: 'sai-file', path: '/p/foo.png', media_type: 'image/png' } },
    ];
    expect(parseToolResultBlocks(content)).toEqual({
      text: '[image: foo.png]',
      images: [{ filePath: '/p/foo.png', mimeType: 'image/png' }],
    });
  });

  it('maps a base64 image source to a dataUrl ref', () => {
    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ];
    expect(parseToolResultBlocks(content)).toEqual({
      text: '',
      images: [{ dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' }],
    });
  });
});
