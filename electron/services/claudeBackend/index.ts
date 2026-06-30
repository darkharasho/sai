import { readSaiSetting } from '../claude';
export * from './types';

export function getClaudeBackendSetting(): 'cli' | 'sdk' {
  return readSaiSetting('claudeBackend') === 'sdk' ? 'sdk' : 'cli';
}
