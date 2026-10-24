import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LoadGuardBanner from '../../../../src/components/Chat/LoadGuardBanner';

const base: any = {
  level: 'critical', paused: true, override: false, saiCaused: false, saiAppHeavy: false,
  memUsedPct: 96, swapUsedPct: 80, game: null, recoveredAt: null, enabled: true,
};

afterEach(() => { delete (window as any).sai; });

describe('LoadGuardBanner', () => {
  it('renders nothing when not paused', () => {
    const { container } = render(<LoadGuardBanner state={{ ...base, paused: false }} />);
    expect(container.firstChild).toBeNull();
  });
  it.each([
    [{ saiCaused: true }, "SAI's processes are a big part of it."],
    [{ saiAppHeavy: true }, "SAI's app itself is using a lot of memory."],
    [{}, 'Not caused by SAI.'],
  ])('cause sentence %j', (patch, sentence) => {
    render(<LoadGuardBanner state={{ ...base, ...patch }} />);
    expect(screen.getByText('AI paused: your PC is under heavy load')).toBeTruthy();
    expect(screen.getByText(new RegExp(`${sentence.replace(/[.']/g, '\\$&')} Resumes automatically once things stay calm for 30s\\.`))).toBeTruthy();
  });
  it('Resume anyway calls loadGuardResume', () => {
    const loadGuardResume = vi.fn().mockResolvedValue(undefined);
    (window as any).sai = { loadGuardResume };
    render(<LoadGuardBanner state={base} />);
    fireEvent.click(screen.getByText('Resume anyway'));
    expect(loadGuardResume).toHaveBeenCalled();
  });
  it('lists top users, SAI rows suffixed, and toggles off', async () => {
    (window as any).sai = {
      loadGuardTopUsers: vi.fn().mockResolvedValue([
        { label: 'vitest', sizeKb: 7.2 * 1024 * 1024, owner: 'sai-ai' },
        { label: 'firefox', sizeKb: 2 * 1024 * 1024, owner: 'other' },
      ]),
    };
    render(<LoadGuardBanner state={base} />);
    fireEvent.click(screen.getByText("What's using memory?"));
    expect(await screen.findByText('vitest (SAI)')).toBeTruthy();
    expect(screen.getByText('7.2 GB')).toBeTruthy();
    expect(screen.getByText('firefox')).toBeTruthy();
    fireEvent.click(screen.getByText("What's using memory?"));
    expect(screen.queryByText('7.2 GB')).toBeNull();
  });
});
