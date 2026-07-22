export interface ContextUsageView {
  used: number;
  total: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
}

export interface UsageLimitView {
  id: string;
  label: string;
  group: 'session' | 'weekly';
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
  updatedAt: number;
  stale: boolean;
  status?: string;
  isUsingOverage?: boolean;
  overageResetsAt?: number;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitsSnapshot {
  provider: 'codex';
  fetchedAt: number;
  stale: boolean;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
}

export function contextUsageFromCodex(usage: Record<string, unknown>, total?: number): ContextUsageView {
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  const inputTokens = number(usage.input_tokens);
  const cachedInputTokens = number(usage.cached_input_tokens ?? usage.cache_read_input_tokens);
  const outputTokens = number(usage.output_tokens);
  const reasoningOutputTokens = number(usage.reasoning_output_tokens);
  return {
    used: inputTokens + outputTokens,
    total: typeof total === 'number' && total > 0 ? total : null,
    inputTokens,
    cachedInputTokens,
    cacheCreationTokens: 0,
    outputTokens,
    ...(reasoningOutputTokens > 0 ? { reasoningOutputTokens } : {}),
  };
}

export function resolveEffectiveContextWindow(...candidates: Array<number | undefined>): number | undefined {
  const valid = candidates.filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0);
  return valid.length ? Math.min(...valid) : undefined;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const CLAUDE_LABELS: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'All models',
  seven_day_opus: 'Opus only',
  seven_day_sonnet: 'Sonnet only',
  seven_day_oauth_apps: 'OAuth apps',
};

export function codexRateLimitsToViews(snapshot: CodexRateLimitsSnapshot): UsageLimitView[] {
  return ([
    ['primary', snapshot.primary, 'Current session', 'session'],
    ['secondary', snapshot.secondary, 'All models', 'weekly'],
  ] as const).flatMap(([id, window, label, group]) => window ? [{
    id: `codex-${id}`,
    label,
    group,
    usedPercent: clampPercent(window.usedPercent),
    resetsAt: window.resetsAt,
    windowDurationMins: window.windowDurationMins,
    updatedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
  }] : []);
}

export interface ClaudeRateLimitRecord {
  rateLimitType: string;
  resetsAt: number;
  status: string;
  isUsingOverage: boolean;
  overageResetsAt: number;
  utilization?: number;
  lastUpdated: number;
}

export function claudeRateLimitsToViews(
  limits: Map<string, ClaudeRateLimitRecord>,
  now = Date.now(),
): UsageLimitView[] {
  return [...limits.values()].flatMap((limit) => typeof limit.utilization === 'number' ? [{
    id: limit.rateLimitType,
    label: CLAUDE_LABELS[limit.rateLimitType] ?? limit.rateLimitType,
    group: limit.rateLimitType.startsWith('seven_day') ? 'weekly' as const : 'session' as const,
    usedPercent: clampPercent(limit.utilization * 100),
    resetsAt: limit.resetsAt || null,
    windowDurationMins: null,
    updatedAt: limit.lastUpdated,
    stale: now - limit.lastUpdated > 120_000,
    status: limit.status,
    isUsingOverage: limit.isUsingOverage,
    overageResetsAt: limit.overageResetsAt,
  }] : []);
}
