export type Provider = 'claude' | 'codex' | 'gemini' | 'kimi';

export interface ScopeTag {
  instance: number;
  provider: Provider;
  projectPath: string;
  /** '*' = all scopes of the provider in the project */
  scope: string;
}

export type Level = 'normal' | 'warning' | 'critical';
export type Owner = 'sai-ai' | 'sai-app' | 'sai-terminal' | 'game' | 'other';

export interface ProcInfo {
  pid: number;
  ppid: number;
  comm: string;
  /** argv joined, ≤200 chars */
  cmd: string;
  startTicks: number;
  rssKb: number;
  swapKb: number;
  cgroup: string;
  tag: ScopeTag | null;
}

export interface SystemSample {
  ts: number;
  memTotalKb: number;
  memAvailableKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
  psiMemSome10: number;
  psiMemFull10: number;
  psiCpuSome10: number;
  gpu: { utilPct: number; vramUsedMb: number; vramTotalMb: number } | null;
}

export interface TopUser {
  label: string;
  sizeKb: number;
  owner: Owner;
  tag?: ScopeTag;
}

export type UnitKind = 'command' | 'service' | 'agent';

export interface AiUnit {
  rootPid: number;
  kind: UnitKind;
  tag: ScopeTag;
  sizeKb: number;
  /** descendants-first */
  pids: number[];
  label: string;
  startTicks: number;
}
