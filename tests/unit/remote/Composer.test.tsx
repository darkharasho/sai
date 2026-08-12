import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Composer from '@/renderer-remote/chat/Composer';
import { modelForRequest } from '@/renderer-remote/lib/overrides';

const baseProps = {
  streaming: false,
  onSend: vi.fn(),
  onInterrupt: vi.fn(),
  overrides: {},
  onOverridesChange: vi.fn(),
};

describe('remote Composer model picker', () => {
  it('renders account-supplied models in the picker', () => {
    const onOverridesChange = vi.fn();
    render(
      <Composer
        {...baseProps}
        onOverridesChange={onOverridesChange}
        models={[{ id: 'fable', label: 'Fable', description: 'Account model', recommended: true }]}
      />,
    );

    fireEvent.click(screen.getByText('Model'));
    expect(screen.getByText('Fable')).toBeTruthy();
    expect(screen.getByText('Account model')).toBeTruthy();
    fireEvent.click(screen.getByText('Fable'));
    expect(onOverridesChange).toHaveBeenCalledWith({ model: 'fable' });
  });

  it('serializes the default option as an undefined model override', () => {
    const onOverridesChange = vi.fn();
    render(<Composer {...baseProps} onOverridesChange={onOverridesChange} />);

    fireEvent.click(screen.getByText('Model'));
    fireEvent.click(screen.getByText('Desktop default'));
    expect(onOverridesChange).toHaveBeenCalledWith({ model: undefined });
    expect(modelForRequest('default')).toBeUndefined();
  });

  it('keeps an unknown saved selection visible and selectable', () => {
    render(<Composer {...baseProps} overrides={{ model: 'saved-custom-model' }} />);

    expect(screen.getByText('saved-custom-model')).toBeTruthy();
    fireEvent.click(screen.getByText('saved-custom-model'));
    expect(screen.getAllByText('saved-custom-model')).toHaveLength(2);
  });

  it('keeps version-pinned Claude IDs out of client fallback source', () => {
    const clientFallbacks = [
      'src/renderer-remote/chat/Composer.tsx',
      'sai-mobile/components/Composer.tsx',
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

    expect(clientFallbacks).not.toMatch(/claude-opus-4-(?:8|7)/);
  });
});
