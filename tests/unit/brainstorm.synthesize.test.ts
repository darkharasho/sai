import { describe, it, expect } from 'vitest';
import { parseSynthesizeOutput } from '../../electron/services/brainstorm';

describe('parseSynthesizeOutput', () => {
  it('parses a clean JSON object', () => {
    const r = parseSynthesizeOutput('{"projectName":"my-app","context":"A CLI."}');
    expect(r).toEqual({ projectName: 'my-app', context: 'A CLI.' });
  });

  it('strips ```json code fences', () => {
    const r = parseSynthesizeOutput('```json\n{"projectName":"foo","context":"bar"}\n```');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });

  it('strips plain ``` code fences', () => {
    const r = parseSynthesizeOutput('```\n{"projectName":"foo","context":"bar"}\n```');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });

  it('extracts JSON from surrounding prose', () => {
    const r = parseSynthesizeOutput('Here is the summary: {"projectName":"foo","context":"bar"} thanks!');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseSynthesizeOutput('not json at all')).toThrow();
  });

  it('throws when projectName is missing', () => {
    expect(() => parseSynthesizeOutput('{"context":"bar"}')).toThrow(/projectName/);
  });

  it('throws when context is missing', () => {
    expect(() => parseSynthesizeOutput('{"projectName":"foo"}')).toThrow(/context/);
  });

  it('throws when projectName is empty', () => {
    expect(() => parseSynthesizeOutput('{"projectName":"","context":"bar"}')).toThrow(/projectName/);
  });

  it('rejects projectName longer than 40 chars', () => {
    const long = 'a'.repeat(41);
    expect(() => parseSynthesizeOutput(`{"projectName":"${long}","context":"bar"}`)).toThrow(/40/);
  });

  it('ignores extra fields', () => {
    const r = parseSynthesizeOutput('{"projectName":"foo","context":"bar","extra":"ignored"}');
    expect(r).toEqual({ projectName: 'foo', context: 'bar' });
  });
});
