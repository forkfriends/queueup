# QueueUp Backend Quickstart

This guide walks through standing up the QueueUp backend, which is built on Cloudflare Workers, Durable Objects, KV, and D1 for storage. All server code lives in the `api/` directory of the repository.

## Prerequisites

- Node.js 20 or newer and npm
- A Cloudflare account with access to Workers, KV, and D1
- Wrangler CLI ≥ 4.42 (`npm install -g wrangler`)

## Install Dependencies

From the project root, install the full project dependencies (needed for migrations and tests):

```sh
npm install
```

## Authenticate And Provision Cloudflare Resources

Log in once per Cloudflare account, then create the data stores that QueueUp needs:

```sh
npx wrangler login
npx wrangler d1 create queueup-db
npx wrangler kv namespace create QUEUE_KV
npx wrangler kv namespace create QUEUE_KV --preview
```

Copy the generated IDs into `api/wrangler.toml` so Wrangler knows which resources to use.

## Configure Secrets

Register the required secrets (replace the values with your production keys). The Turnstile test secret works during development:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY --config api/wrangler.toml
npx wrangler secret put HOST_AUTH_SECRET --config api/wrangler.toml
```

## Run Database Migrations

Apply the D1 migrations once to initialize the schema:

```sh
npm run migrate:apply
```

## Develop Or Deploy

Start the Worker locally with Wrangler's dev server, or deploy it to Cloudflare once you're ready:

```sh
npx wrangler dev --config api/wrangler.toml     # local dev
npx wrangler deploy --config api/wrangler.toml  # production deploy
```

The dev server listens on <http://127.0.0.1:8787> by default. Mobile clients should use the LAN address Wrangler prints in the console.

## What's Next?

- Review overall architecture in `docs/ARCHITECTURE.md`.
- See `docs/API.md` for request/response details.
- Run the automated backend test suite with `npm run test`.

