import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import MotionPresence from '@/components/Chat/MotionPresence';

describe('MotionPresence', () => {
  it('renders children', () => {
    const { getByText } = render(
      <MotionPresence><div>hello</div></MotionPresence>
    );
    expect(getByText('hello')).toBeTruthy();
  });
});
