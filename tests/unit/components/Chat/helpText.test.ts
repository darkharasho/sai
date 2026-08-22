import { describe, it, expect } from 'vitest';
import { buildHelpMessage } from '../../../../src/components/Chat/helpText';

describe('buildHelpMessage', () => {
  it('uses Codex phrasing for Codex sessions', () => {
    const text = buildHelpMessage('codex', [
      { name: 'review', description: '' },
      { name: 'fix-ci', description: '' },
    ]);
    expect(text).toContain('**Codex Commands:**');
    expect(text).toContain('/review');
    expect(text).not.toContain('Claude Skills');
  });

  it('shows each command with exactly one slash and its description', () => {
    const text = buildHelpMessage('claude', [
      { name: 'deploy', description: 'Ship it' },
      { name: 'lint', description: '' },
    ]);
    expect(text).toContain('/deploy — Ship it');
    expect(text).toContain('  /lint');
    expect(text).not.toContain('//');
  });

  it('uses the Antigravity command label for Gemini sessions with no commands', () => {
    const text = buildHelpMessage('gemini', []);
    expect(text).toContain('**Available Commands**');
    expect(text).toContain('**Antigravity Commands:**');
    expect(text).toContain('No custom commands loaded');
  });
});
