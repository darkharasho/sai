import { describe, it, expect } from 'vitest';
import { buildChoiceHtml } from '../../../src/render/buildChoiceHtml';

describe('buildChoiceHtml', () => {
  it('escapes the message', () => {
    const html = buildChoiceHtml({ message: '<b>Delete?</b>', choices: [{ label: 'OK', value: true }] });
    expect(html).toContain('&lt;b&gt;Delete?&lt;/b&gt;');
    expect(html).not.toContain('<b>Delete?');
  });

  it('renders one button per choice with the escaped label', () => {
    const html = buildChoiceHtml({ message: 'Pick', choices: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] });
    expect((html.match(/<button/g) || []).length).toBe(2);
    expect(html).toContain('>A</button>');
    expect(html).toContain('>B</button>');
  });

  it('JSON-encodes each value in data-sai-value (attribute-escaped)', () => {
    const html = buildChoiceHtml({ message: 'm', choices: [{ label: 'Yes', value: true }, { label: 'Opt', value: 'opt-a' }] });
    expect(html).toContain('data-sai-value="true"');
    expect(html).toContain('data-sai-value="&quot;opt-a&quot;"');
  });

  it('includes the saiSubmit wiring script', () => {
    const html = buildChoiceHtml({ message: 'm', choices: [{ label: 'X', value: 1 }] });
    expect(html).toContain('saiSubmit(JSON.parse(');
    expect(html).toContain('data-sai-value');
  });

  it('escapes double-quotes in labels', () => {
    const html = buildChoiceHtml({ message: 'm', choices: [{ label: 'say "hi"', value: 1 }] });
    expect(html).toContain('say &quot;hi&quot;');
  });

  it('throws on empty choices', () => {
    expect(() => buildChoiceHtml({ message: 'm', choices: [] })).toThrow(/at least one choice/i);
  });
});
