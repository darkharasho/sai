import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WaitingIndicator from '@/components/Chat/WaitingIndicator';

describe('WaitingIndicator label override', () => {
  it('shows the label prop instead of the computed label', () => {
    render(<WaitingIndicator wait={{ kind: 'background', resumeInSeconds: null, taskCount: 1 }} startedAtMs={Date.now()} onCancel={() => {}} label="Waiting on CI for PR #42" />);
    expect(screen.getByText('Waiting on CI for PR #42')).toBeTruthy();
    expect(screen.queryByText('Waiting on background work')).toBeNull();
  });
});
