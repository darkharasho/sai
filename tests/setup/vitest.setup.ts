import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically cleanup after each test to prevent DOM accumulation across tests
afterEach(() => {
  cleanup();
});
