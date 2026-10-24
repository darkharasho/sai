import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadGuardEventCard from '../../../../src/components/Chat/LoadGuardEventCard';
import type { LoadGuardChatEvent } from '../../../../src/types';

const GB = 1024 * 1024;
const killed = (patch: Partial<Extract<LoadGuardChatEvent, { kind: 'killed' }>> = {}): LoadGuardChatEvent => ({
  kind: 'killed', unitKind: 'command', label: 'vitest', sizeKb: 7.2 * GB, memUsedPct: 97,
  top: [
    { label: 'vitest', sizeKb: 7.2 * GB, owner: 'sai-ai' },
    { label: 'firefox', sizeKb: 2 * GB, owner: 'other' },
  ],
  toldAi: '[SAI system load: CRITICAL] SAI killed `vitest` (7.2 GB) to keep the user\'s PC from freezing (RAM 97% used).',
  ...patch,
});

describe('LoadGuardEventCard', () => {
  it('killed: Stopped tag, struck label, exact body, top list, told-the-AI callout', () => {
    const { container } = render(<LoadGuardEventCard event={killed()} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
    const label = container.querySelector('.lg-card-label')!;
    expect(label.textContent).toBe('vitest');
    expect(label.tagName).toBe('S');
    expect(screen.getByText('SAI stopped this to keep your PC from freezing. It was using 7.2 GB while RAM hit 97%.')).toBeTruthy();
    const rows = container.querySelectorAll('.lg-card-top li');
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain('lg-card-top-sai');
    expect(rows[1].className).not.toContain('lg-card-top-sai');
    expect(rows[1].textContent).toContain('firefox');
    expect(rows[1].textContent).toContain('2.0 GB');
    expect(screen.getByText('Told the AI:')).toBeTruthy();
    expect(container.textContent).toContain("SAI killed `vitest` (7.2 GB) to keep the user's PC from freezing");
    expect(container.textContent).not.toContain('Stopped to save your PC');
    expect(container.textContent).not.toContain('pick up where it left off');
  });

  it('agent: title line and the resume sentence', () => {
    const { container } = render(<LoadGuardEventCard event={killed({ unitKind: 'agent', label: 'claude' })} />);
    expect(screen.getByText('Stopped to save your PC')).toBeTruthy();
    const label = container.querySelector('.lg-card-label')!;
    expect(label.tagName).toBe('S');
    expect(label.textContent).toBe('claude');
    expect(screen.getByText(
      'SAI stopped this to keep your PC from freezing. It was using 7.2 GB while RAM hit 97%. This chat will pick up where it left off when you send your next message.',
    )).toBeTruthy();
  });

  it('note: "System load:" callout with the prefix stripped', () => {
    const { container } = render(<LoadGuardEventCard event={{ kind: 'note', text: '[SAI system load: WARNING] RAM 85% used (4.1 GB free of 31.2 GB).' }} />);
    expect(screen.getByText('System load:')).toBeTruthy();
    expect(container.textContent).toContain('RAM 85% used (4.1 GB free of 31.2 GB).');
    expect(container.textContent).not.toContain('[SAI system load');
  });

  it('renders nothing for an unknown or kind-less persisted event', () => {
    expect(render(<LoadGuardEventCard event={{ kind: 'future_thing', label: 'x' } as any} />).container.firstChild).toBeNull();
    expect(render(<LoadGuardEventCard event={{} as any} />).container.firstChild).toBeNull();
    expect(render(<LoadGuardEventCard event={null as any} />).container.firstChild).toBeNull();
  });

  it('survives malformed persisted values without throwing', () => {
    const bad = { kind: 'killed', unitKind: 'command', label: { x: 1 }, sizeKb: 'nope', memUsedPct: null, top: 'x', toldAi: 42 } as any;
    expect(() => render(<LoadGuardEventCard event={bad} />)).not.toThrow();
    expect(() => render(<LoadGuardEventCard event={{ kind: 'note', text: undefined } as any} />)).not.toThrow();
  });
});
