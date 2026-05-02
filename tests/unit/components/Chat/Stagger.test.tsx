import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Stagger from '@/components/Chat/Stagger';

describe('Stagger', () => {
  it('renders children with the requested cadence', () => {
    const { getByText } = render(
      <Stagger cadence="default"><span>a</span><span>b</span></Stagger>
    );
    expect(getByText('a')).toBeTruthy();
    expect(getByText('b')).toBeTruthy();
  });
});
