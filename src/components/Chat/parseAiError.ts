import type { ChatMessage } from '../../types';

type ParsedError = NonNullable<ChatMessage['error']>;

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Authentication failed',
  403: 'Access denied',
  404: 'Not found',
  408: 'Request timeout',
  413: 'Request too large',
  429: 'Rate limit exceeded',
  500: 'Provider error',
  502: 'Provider unavailable',
  503: 'Provider unavailable',
  504: 'Provider timeout',
};

const ERROR_TYPE_TITLES: Record<string, string> = {
  permission_error: 'Access denied',
  authentication_error: 'Authentication failed',
  invalid_request_error: 'Invalid request',
  rate_limit_error: 'Rate limit exceeded',
  overloaded_error: 'Provider overloaded',
  api_error: 'Provider error',
  not_found_error: 'Not found',
};

function titleFor(status?: number, errorType?: string): string {
  if (errorType && ERROR_TYPE_TITLES[errorType]) return ERROR_TYPE_TITLES[errorType];
  if (status && STATUS_TITLES[status]) return STATUS_TITLES[status];
  return 'AI provider error';
}

function extractJson(text: string): { json: any; before: string } | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(start, i + 1);
        try {
          return { json: JSON.parse(raw), before: text.slice(0, start).trim() };
        } catch { return null; }
      }
    }
  }
  return null;
}

export function parseAiError(text: string): ParsedError {
  const trimmed = (text || '').trim();
  if (!trimmed) return { title: 'AI provider error', message: 'Unknown error' };

  // Try API Error: <status> {json}
  const apiMatch = trimmed.match(/^(?:.*?\b)?API Error:?\s*(\d{3})?\s*/i);
  const extracted = extractJson(trimmed);

  let status: number | undefined;
  let message = '';
  let errorType: string | undefined;
  let requestId: string | undefined;

  if (apiMatch && apiMatch[1]) status = Number(apiMatch[1]);

  if (extracted) {
    const j = extracted.json;
    const errObj = j?.error ?? j;
    if (typeof errObj?.message === 'string') message = errObj.message;
    if (typeof errObj?.type === 'string') errorType = errObj.type;
    if (typeof j?.request_id === 'string') requestId = j.request_id;
    if (typeof j?.requestId === 'string') requestId ??= j.requestId;
    if (!status && typeof j?.status === 'number') status = j.status;
  }

  if (!message) {
    // Strip any leading "API Error: 403" prefix from plain text.
    message = trimmed.replace(/^.*?API Error:?\s*\d{0,3}\s*/i, '').trim() || trimmed;
  }

  const title = titleFor(status, errorType);
  const details = extracted ? JSON.stringify(extracted.json, null, 2) : undefined;

  return { title, status, message, requestId, details, errorType };
}

export function looksLikeApiError(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (/^API Error\b/i.test(t)) return true;
  if (/"type"\s*:\s*"error"/.test(t) && /"message"\s*:/.test(t)) return true;
  return false;
}
