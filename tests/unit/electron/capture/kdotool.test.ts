import { describe, it, expect } from 'vitest';
import { parseWindowIds } from '../../../../electron/capture/kdotool';

describe('parseWindowIds', () => {
  it('keeps brace-wrapped uuids, one per line', () => {
    const out = '{6d5b1457-d293-4169-a6fd-83de6cb80544}\n{bed4d603-1644-427d-8574-bb26a77c1b5f}\n';
    expect(parseWindowIds(out)).toEqual([
      '{6d5b1457-d293-4169-a6fd-83de6cb80544}',
      '{bed4d603-1644-427d-8574-bb26a77c1b5f}',
    ]);
  });

  it('drops kdotool error chatter', () => {
    const out = "Error: in command 'getactivedesktop'\n\nCaused by:\n    Unknown command\n";
    expect(parseWindowIds(out)).toEqual([]);
  });

  it('ignores a bare uuid without braces', () => {
    expect(parseWindowIds('bed4d603-1644-427d-8574-bb26a77c1b5f\n')).toEqual([]);
  });
});
