# QueueUp

10/8 - Replicated Figma UI
Todo - Make Submit logic for textfields if necessary for prototype and find other requirements for our app

## Backend quickstart (Cloudflare Workers)

All server code lives in `api/`. To run or deploy the worker locally you need Wrangler ≥4.42.

1. Install dependencies (only once):
   ```sh
   npm install
   ```
2. Authenticate and provision Cloudflare resources (only once per account):
   ```sh
   npx wrangler login
   npx wrangler d1 create queueup-db
   npx wrangler kv namespace create QUEUE_KV
   npx wrangler kv namespace create QUEUE_KV --preview
   ```
   Update `api/wrangler.toml` with the IDs printed by Wrangler.
3. Register secrets (use your real values; the Turnstile test secret works during dev):
   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY --config api/wrangler.toml
   npx wrangler secret put HOST_AUTH_SECRET --config api/wrangler.toml
   ```
4. Apply the initial D1 migration:
   ```sh
   npm run migrate:apply
   ```
5. Run the worker locally or deploy:
  ```sh
  npx wrangler dev --config api/wrangler.toml   # local dev
  npx wrangler deploy --config api/wrangler.toml
  ```

## Testing

We use Vitest plus `@cloudflare/vitest-pool-workers` to execute tests inside a Workers runtime. Run the full suite with:

```sh
npm run test
```

This covers both unit helpers and an end-to-end Durable Object flow (queue creation, join, WebSocket fan-out, advance/alarms, close). Use `npm run test:watch` for quick feedback during development.

### Mobile client configuration

Set `EXPO_PUBLIC_API_BASE_URL` in your environment (or `.env`) to the deployed Worker origin, e.g.

```
EXPO_PUBLIC_API_BASE_URL=https://queueup-api.danielnwachukwu.workers.dev
```

If unset, the app defaults to `http://localhost:8787` (`127.0.0.1` on iOS simulator, `10.0.2.2` on Android emulator) which matches Wrangler's dev server.
