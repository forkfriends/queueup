# Deployment Guide

This project ships its backend as a Cloudflare Worker using Wrangler 4.x. The Worker, Durable Object, KV namespace, and D1 database all live under the `api/` directory. CI/CD is provided through GitHub Actions but you can deploy manually with Wrangler.

## Prerequisites

- Cloudflare account with Workers/Durable Objects/D1/KV access (free tier is sufficient for development).
- Wrangler CLI ≥ 4.42 installed (locally or via `npx`).
- Node.js ≥ 20 for local testing.

## One-Time Cloudflare Setup

1. **Log in**
   ```sh
   npx wrangler login
   ```

2. **Create D1 database**
   ```sh
   npx wrangler d1 create queueup-db
   ```
   Copy the returned `database_id` into `api/wrangler.toml` under `[[d1_databases]]`.

3. **Create KV namespaces**
   ```sh
   npx wrangler kv namespace create QUEUE_KV
   npx wrangler kv namespace create QUEUE_KV --preview
   ```
   Update `api/wrangler.toml` with the `id` and `preview_id` values.

4. **Secrets**
   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY --config api/wrangler.toml
   npx wrangler secret put HOST_AUTH_SECRET --config api/wrangler.toml
   ```
   - `TURNSTILE_SECRET_KEY` – server-side key from Cloudflare Turnstile. During development you can use the official test secret: `0x4AAAAAAB5iY0hK9sjtt1JSiuWm7t1AfA4`.
   - `HOST_AUTH_SECRET` – a random 32+ byte string used to sign host cookies.

5. (Optional) configure CORS origins:
   ```sh
   npx wrangler secret put ALLOWED_ORIGINS --config api/wrangler.toml
   ```
   e.g. `https://app.example.com,https://host.example.com`.

## Database Migrations

Apply migrations before running or deploying the worker.

```sh
npm run migrate:apply
```

This executes `api/migrations/001_init.sql` against the `queueup-db` binding.

## Local Development

```sh
npx wrangler dev --config api/wrangler.toml
```

The dev server emulates KV, D1, and Durable Objects. Backend tests run inside Miniflare with:

```sh
npm run test
```

## Deployment

### Manual

```sh
npx wrangler deploy --config api/wrangler.toml
```

Upon success Wrangler prints the workers.dev URL and confirms the cron trigger registration.

### GitHub Actions

File `.github/workflows/deploy.yml` deploys automatically on pushes to `main` that touch `api/**`. It requires repository secrets:

- `CF_API_TOKEN` – token with `Workers Scripts:Edit`, `Workers KV Storage:Edit`, `Workers Routes:Edit`, `Account D1:Edit`.
- `CF_ACCOUNT_ID` – your Cloudflare account ID.

CI workflow (`ci.yml`) installs dependencies, runs lint/typecheck/tests, and thereby gates pull requests.

## Production Notes

- **Turnstile** – ensure you update frontend site keys and the Worker secret with live credentials before launch.
- **Host secrets** – rotate by invalidating cookies (change the secret) if compromised.
- **Scaling** – one Durable Object handles an entire queue session; create lightweight sessions to stay within DO CPU budgets.
- **Logs & debugging** – use `wrangler tail queueup-api` to watch production logs.
- **Cleanup** – future cron logic can prune expired sessions and KV entries. The scaffolded cron trigger (`*/15 * * * *`) is ready for wiring.
