import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { rehypeEmojiIcons } from '../../../../src/components/Chat/rehypeEmojiIcons';
import { rehypeStreamWords } from '../../../../src/components/Chat/rehypeStreamWords';
import { renderEmojiSpan, lookupIcon, fluentEmojiSlug, emojiName } from '../../../../src/components/Chat/emojiIcons';

const components = { span: renderEmojiSpan } as any;
function renderMd(text: string) {
  return render(
    <ReactMarkdown rehypePlugins={[rehypeEmojiIcons]} components={components}>{text}</ReactMarkdown>
  );
}
function renderMdStreaming(text: string) {
  return render(
    <ReactMarkdown rehypePlugins={[rehypeEmojiIcons, rehypeStreamWords]} components={components}>{text}</ReactMarkdown>
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

  it('streaming render wraps emoji icons in .sw so they fade in with the words', () => {
    // Without the wrapper the icon mounts with no animation and pops ahead of
    // the surrounding word fade (rehypeStreamWords only wraps text nodes).
    const { container } = renderMdStreaming('nice ✅ work');
    const icon = container.querySelector('.sai-emoji-icon');
    expect(icon).toBeTruthy();
    expect(icon!.closest('.sw')).toBeTruthy();
    // Regular words still get their own .sw spans.
    expect(container.querySelectorAll('.sw').length).toBeGreaterThanOrEqual(3);
  });

  it('non-streaming render keeps emoji icons unwrapped (no stray .sw)', () => {
    const { container } = renderMd('nice ✅ work');
    expect(container.querySelector('.sai-emoji-icon')).toBeTruthy();
    expect(container.querySelector('.sw')).toBeNull();
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

describe('emojiName', () => {
  it('returns the human name of a mapped emoji', () => {
    expect(emojiName('✅')).toBe('check mark button');
  });
  it('resolves the base name with skin tone stripped', () => {
    expect(emojiName('👍🏽')).toBe(emojiName('👍'));
    expect(emojiName('👍')).toBeTruthy();
  });
  it('returns null for a non-emoji', () => {
    expect(emojiName('x')).toBeNull();
  });
});

describe('emoji tooltip + jumbo', () => {
  it('sets a title tooltip equal to the emoji name on the icon', () => {
    const { container } = renderMd('ok ✅');
    expect(container.querySelector('.sai-emoji-icon')?.getAttribute('title')).toBe(emojiName('✅'));
  });

  it('marks an emoji-only paragraph with sai-emoji-jumbo', () => {
    const { container } = renderMd('🎉✅');
    expect(container.querySelector('p.sai-emoji-jumbo')).toBeTruthy();
  });

  it('does NOT mark a mixed-content paragraph as jumbo', () => {
    const { container } = renderMd('done ✅');
    expect(container.querySelector('p.sai-emoji-jumbo')).toBeNull();
    expect(container.querySelector('p')).toBeTruthy();
  });

  it('marks an emoji-only list item jumbo', () => {
    const { container } = renderMd('- 🎉');
    expect(container.querySelector('.sai-emoji-jumbo .sai-emoji-icon')).toBeTruthy();
  });
});
