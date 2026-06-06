import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { rehypeEmojiIcons } from '../../../../src/components/Chat/rehypeEmojiIcons';
import { renderEmojiSpan, lookupIcon, fluentEmojiSlug } from '../../../../src/components/Chat/emojiIcons';

const components = { span: renderEmojiSpan } as any;
function renderMd(text: string) {
  return render(
    <ReactMarkdown rehypePlugins={[rehypeEmojiIcons]} components={components}>{text}</ReactMarkdown>
  );
}

describe('emoji rendering', () => {
  it('renders a mapped emoji (✅) as an accent lucide icon, preserving text', () => {
    const { container } = renderMd('done ✅ here');
    expect(container.querySelector('.sai-emoji-icon')).toBeTruthy();
    expect(container.textContent).toContain('done');
    expect(container.textContent).toContain('here');
  });

  it('renders an unmapped emoji (😂) as a fluent mask span with the iconify url', () => {
    const { container } = renderMd('lol 😂');
    const mask = container.querySelector('.sai-emoji-mask');
    expect(mask).toBeTruthy();
    expect(mask!.getAttribute('style') || '').toContain('fluent-emoji-high-contrast/face-with-tears-of-joy');
  });

  it('converts an emoji nested inside bold markdown', () => {
    const { container } = renderMd('**ok ✅**');
    expect(container.querySelector('strong .sai-emoji-icon')).toBeTruthy();
  });

  it('leaves non-emoji text untouched', () => {
    const { container } = renderMd('just text');
    expect(container.querySelector('.sai-emoji-icon, .sai-emoji-mask')).toBeNull();
    expect(container.textContent).toBe('just text');
  });
});

describe('lookupIcon / fluentEmojiSlug', () => {
  it('resolves a mapped base emoji', () => {
    expect(lookupIcon('✅')).toBeTruthy();
  });
  it('strips skin tone before lookup (👍🏽 → 👍)', () => {
    expect(lookupIcon('👍')).toBeTruthy();
    expect(lookupIcon('👍🏽')).toBe(lookupIcon('👍'));
  });
  it('returns the kebab fluent slug for an unmapped emoji', () => {
    expect(fluentEmojiSlug('😂')).toBe('face-with-tears-of-joy');
  });
  it('returns undefined/null for a non-emoji', () => {
    expect(lookupIcon('x')).toBeUndefined();
    expect(fluentEmojiSlug('x')).toBeNull();
  });
});
