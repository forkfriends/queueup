import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const wranglerConfigPath = resolve(rootDir, 'wrangler.toml');

export default defineWorkersConfig({
  resolve: {
    alias: {
      'node:worker_threads': resolve(rootDir, 'tests/stubs/worker-threads.ts'),
    },
  },
  test: {
    globals: true,
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        main: resolve(rootDir, 'worker.ts'),
        isolatedStorage: false,
        wrangler: {
          configPath: wranglerConfigPath,
        },
        miniflare: {
          compatibilityDate: '2025-10-08',
          bindings: {
            TURNSTILE_SECRET_KEY: 'test-secret',
            HOST_AUTH_SECRET: 'test-host-secret',
            TURNSTILE_BYPASS: 'true',
            TEST_MODE: 'true',
            ALLOWED_ORIGINS: 'https://example.com',
          },
          kvNamespaces: ['QUEUE_KV'],
          d1Databases: ['DB'],
          modules: [
            {
              type: 'CommonJS',
              path: 'node:worker_threads',
              contents: `
class FakePort {
  constructor() {
    this._peer = null;
    this._message = undefined;
  }
  unref() {}
  postMessage(value, _transfer) {
    if (this._peer) {
      this._peer._message = value;
    }
  }
}
class FakeMessageChannel {
  constructor() {
    this.port1 = new FakePort();
    this.port2 = new FakePort();
    this.port1._peer = this.port2;
    this.port2._peer = this.port1;
  }
}
function receiveMessageOnPort(port) {
  if (port && port._message !== undefined) {
    const value = port._message;
    port._message = undefined;
    return { message: value };
  }
  return undefined;
}
module.exports = {
  parentPort: null,
  isMainThread: true,
  workerData: undefined,
  threadId: () => 0,
  MessageChannel: FakeMessageChannel,
  receiveMessageOnPort
};
`,
            },
          ],
        },
      },
    },
    coverage: {
      reporter: ['text', 'json-summary', 'html'],
      provider: 'v8',
      include: ['api/**/*.ts'],
      thresholds: {
        lines: 0,
        functions: 0,
        statements: 0,
        branches: 0,
      },
    },
    setupFiles: [resolve(rootDir, 'tests', 'setup.ts')],
  },
});
