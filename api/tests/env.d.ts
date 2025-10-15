import type { Env } from '../worker';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TURNSTILE_BYPASS: string;
    TEST_MODE: string;
  }
}
