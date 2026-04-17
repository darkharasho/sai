import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMockSai, createMockSai } from '../../../helpers/ipc-mock';
import InlineDiff from '../../../../src/components/Git/InlineDiff';

const DIFF = `diff --git a/src/App.tsx b/src/App.tsx
index abc..def 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,3 +1,4 @@
 import React from 'react';
-const x = 1;
+const x = 2;
+const y = 3;
 export default App;`;

describe('InlineDiff', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders removed and added lines from diff', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue(DIFF);
    installMockSai(mock);

    render(<InlineDiff projectPath="/proj" filepath="src/App.tsx" staged={false} />);
    await waitFor(() => {
      expect(screen.getByText(/const x = 1/)).toBeTruthy();
      expect(screen.getByText(/const x = 2/)).toBeTruthy();
    });
  });

  it('calls gitDiff with staged=true when staged prop is true', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue(DIFF);
    installMockSai(mock);

    render(<InlineDiff projectPath="/proj" filepath="src/App.tsx" staged={true} />);
    await waitFor(() => {
      expect(mock.gitDiff).toHaveBeenCalledWith('/proj', 'src/App.tsx', true);
    });
  });

  it('shows "Open in editor" link', async () => {
    const mock = createMockSai();
    mock.gitDiff.mockResolvedValue(DIFF);
    installMockSai(mock);

    const onOpen = vi.fn();
    render(<InlineDiff projectPath="/proj" filepath="src/App.tsx" staged={false} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/open in editor/i));
    screen.getByText(/open in editor/i).click();
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows truncation message with count when diff exceeds 50 lines', async () => {
    const mock = createMockSai();
    // Generate a diff with 60 added lines
    const longDiff = [
      'diff --git a/big.ts b/big.ts',
      'index abc..def 100644',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -1,60 +1,60 @@',
      ...Array.from({ length: 60 }, (_, i) => `+line ${i + 1}`),
    ].join('\n');
    mock.gitDiff.mockResolvedValue(longDiff);
    installMockSai(mock);

    render(<InlineDiff projectPath="/proj" filepath="big.ts" staged={false} />);
    await waitFor(() => {
      expect(screen.getByText(/10 more lines/)).toBeTruthy();
    });
  });
});
