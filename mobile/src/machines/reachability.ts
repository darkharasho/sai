import { getNative, type FullNativeApi } from '../native';
import type { Machine } from './store';

export const HEALTHZ_TIMEOUT_MS = 3000;

export async function checkReachable(machine: Pick<Machine, 'baseUrl'>, native: FullNativeApi = getNative()): Promise<boolean> {
  try {
    const res = await native.http({ method: 'GET', url: `${machine.baseUrl}/healthz`, timeoutMs: HEALTHZ_TIMEOUT_MS });
    return res.status === 200;
  } catch {
    return false;
  }
}
