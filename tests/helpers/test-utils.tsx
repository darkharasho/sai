import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { createMockSai, installMockSai, type MockSai } from './ipc-mock';

// Re-export so callers only need to import from this file
export { createMockSai, installMockSai };
export type { MockSai };

// ---------------------------------------------------------------------------
// renderWithProviders
// ---------------------------------------------------------------------------

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Pre-configured MockSai to install.  When omitted a fresh one is created
   * via createMockSai().
   */
  mockSai?: MockSai;
}

export interface RenderWithProvidersResult extends RenderResult {
  /** The MockSai instance that was installed on window.sai for this render */
  mockSai: MockSai;
}

/**
 * Wraps RTL's render() with automatic window.sai installation.
 *
 * Usage:
 * ```tsx
 * const { getByText, mockSai } = renderWithProviders(<MyComponent />);
 * expect(mockSai.settingsGet).toHaveBeenCalledWith('theme');
 * ```
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { mockSai: providedMock, ...renderOptions } = options;

  // Install the mock (creates a fresh one if none provided)
  const mockSai = installMockSai(providedMock);

  const renderResult = render(ui, renderOptions);

  return {
    ...renderResult,
    mockSai,
  };
}
