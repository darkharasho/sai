import { describe, it, expect } from 'vitest';
import { looksLikeApiError } from '../../../../src/components/Chat/parseAiError';

describe('looksLikeApiError', () => {
  it('returns true for the prefixed API Error envelope', () => {
    const text = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Output blocked by content filtering policy"},"request_id":"req_011CaeanuZcbSgzbnKUNX8hP"}';
    expect(looksLikeApiError(text)).toBe(true);
  });

  it('returns true for a bare JSON envelope without prefix', () => {
    const text = '{"type":"error","error":{"type":"api_error","message":"oops"}}';
    expect(looksLikeApiError(text)).toBe(true);
  });

  it('returns false for ordinary assistant text', () => {
    expect(looksLikeApiError('Sure! Here is the answer.')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(looksLikeApiError('')).toBe(false);
  });

  it('returns false for prose that mentions errors but is not an envelope', () => {
    expect(looksLikeApiError('I noticed your code has an error message in main.ts.')).toBe(false);
  });
});
