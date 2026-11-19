import type { Env as RelayEnv } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends RelayEnv {
      TEST_SCHEMA: string;
    }
  }
}
