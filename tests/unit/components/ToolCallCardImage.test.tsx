import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/test-utils';
import ToolCallCard from '../../../src/components/Chat/ToolCallCard';
import type { ToolCall } from '../../../src/types';

describe('ToolCallCard image strip', () => {
  it('renders an image preview while the card is collapsed', () => {
    const toolCall: ToolCall = {
      id: 't1',
      type: 'file_read',
      name: 'Read',
      input: JSON.stringify({ file_path: '/p/foo.png' }),
      output: '[image: foo.png]',
      resultImages: [{ dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }],
    };
    renderWithProviders(<ToolCallCard toolCall={toolCall} defaultExpanded={false} />);
    expect(screen.getByTestId('tool-result-image-thumb')).toBeInTheDocument();
  });

  it('renders no preview when there are no resultImages', () => {
    const toolCall: ToolCall = {
      id: 't2', type: 'file_read', name: 'Read',
      input: JSON.stringify({ file_path: '/p/notes.txt' }),
      output: 'plain text',
    };
    renderWithProviders(<ToolCallCard toolCall={toolCall} defaultExpanded={false} />);
    expect(screen.queryByTestId('tool-result-image-thumb')).toBeNull();
  });
});
