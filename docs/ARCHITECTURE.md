# QueueUp Backend Architecture

The QueueUp backend is designed for the Cloudflare Workers free tier. The Worker handles HTTP ingress, authenticates hosts, manages Turnstile validation, and forwards queue mutations to a per-session Durable Object (DO). Persistent state is stored in D1 with a narrow schema. KV offers fast code → session lookups.

```
┌────────────┐      ┌────────────┐      ┌────────────────────────┐
│  Client(s) │─────▶│ Worker API │─────▶│ Durable Object (Queue) │
└────────────┘      └────────────┘      └────────────┬───────────┘
         ▲                 │  ▲                     │
         │                 │  │                     │
         │          KV lookup  │         WebSocket fan-out
         │                 │  │                     │
         │                 ▼  │                     ▼
         │             Cloudflare KV           Cloudflare D1
         │                                     (sessions, parties, events)
         │
         └────────────── WebSocket updates / host cookie
```

## Worker Responsibilities

- **Routing** – All `/api/queue` HTTP endpoints terminate in `api/worker.ts`. Regex dispatch maps `create`, guest actions, host actions, and WebSocket upgrades.
- **Turnstile verification** – `POST /join` calls the official Turnstile verify endpoint. Tests set `TURNSTILE_BYPASS="true"` via bindings to avoid external calls.
- **Host authentication** – Worker signs DO IDs with HMAC (`HOST_AUTH_SECRET`). Host cookie is checked on every host mutation and WebSocket upgrade.
- **KV + D1 lookups** – `create` persists a session row in D1, seeds KV (`short_code → sessionId`) and returns metadata. Subsequent requests try KV first, then D1 to backfill cache misses.
- **WebSocket proxy** – Upgrades are forwarded directly to the DO with the retrieved session ID. If the DO responds with a 101, the worker skips CORS decoration (to preserve upgrade semantics).
- **Scheduled tasks** – Placeholder `scheduled()` handler will eventually run clean-up (expire old sessions, prune KV). Cron is configured in `wrangler.toml` for future use.

## Durable Object (`QueueDO`)

- **Single-writer queue arbiter** – Each DO instance represents one queue session. It holds queue state, now-serving record, and active sockets.
- **Initialization** – On first request the DO restores state from `DurableObjectState.storage`. If no snapshot exists it loads live entries from D1 (waiting/called parties) to rebuild queue and pending call.
- **WebSockets** – DO accepts host sockets (identified via cookie) and guest sockets (validated via `partyId`). It sends snapshots on connect and deltas on mutations. Guests receive targeted updates (position, called, removed, closed).
- **Lifecycle mutations** – Methods `join`, `declareNearby`, `leave`, `kick`, `advance`, and `close` update in-memory state, persist to D1 (sessions/parties/events), and broadcast updates. `advance` sets an alarm to detect no-shows.
- **Alarms** – When the DO calls a party, it schedules `_state.storage.setAlarm`. If `alarm()` fires before confirmation, the party is marked `no_show`, an event is written, sockets are notified, and `advance` is re-run to promote the next party.
- **Persistence** – Only lifecycle edges are written to D1 (joined, advanced/called, served/no-show, left, close). This keeps write volume low for the free tier.
- **Snapshot storage** – After each mutation the DO writes a condensed state blob to durable storage, enabling rapid restore across cold starts.
- **Safety guards** – WebSocket send operations ignore sockets already closing. Host/guest removal cleans up associated maps.

## Data Model

Tables live in `api/migrations/001_init.sql` and are applied during deployment/tests.

### `sessions`

| column       | type    | notes                              |
|--------------|---------|------------------------------------|
| `id`         | TEXT PK | Durable Object ID                  |
| `short_code` | TEXT    | Unique 6-character code            |
| `status`     | TEXT    | `active`, `closed`, `expired`      |
| `created_at` | INTEGER | Unix seconds                       |
| `expires_at` | INTEGER | optional expiry                    |
| `host_pin`   | TEXT    | optional fallback auth mechanism   |

### `parties`

Stores queue members with status (`waiting`, `called`, `served`, `no_show`, `left`) and `nearby` flag.

### `events`

Append-only audit trail: `joined`, `advanced`, `no_show`, `left`, `close` with optional JSON `details` for analytics.

## Bindings

Defined in `api/wrangler.toml`:

- `QUEUE_DO` – Durable Object class `QueueDO`.
- `QUEUE_KV` – KV namespace storing short-code → DO ID mappings.
- `DB` – D1 database for sessions/parties/events.
- `TURNSTILE_SECRET_KEY`, `HOST_AUTH_SECRET` – secrets configured via Wrangler.
- `ALLOWED_ORIGINS` (optional) – comma-separated origins for CORS.
- `TURNSTILE_BYPASS`, `TEST_MODE` – injected during tests to bypass Turnstile and inject fixtures.

## Testing Strategy

- **Unit** – `api/tests/queue.unit.test.ts` exercises HMAC helpers.
- **Integration** – `api/tests/queue.int.test.ts` spins up the Worker + DO via `@cloudflare/vitest-pool-workers`, walks through queue lifecycle and alarms using real WebSocket upgrades.
- **Setup** – `api/tests/setup.ts` seeds D1 with SQL equivalent to the live migration (inline SQL avoids bundler issues).

Vitest runs with a Worker runtime (Miniflare 4) so tests exercise the same code paths as production, including DO alarms, D1 writes, and KV routing. `TURNSTILE_BYPASS` is set to skip remote Turnstile calls.

## Observability & Future Work

- **Logs** – `console.*` output is available through `wrangler tail` or in Wrangler dev sessions. Alarm-triggered auto-advance logs no-show transitions.
- **Metrics** – Append-only `events` table enables downstream analytics (average wait, served counts, etc.).
- **TODOs** – Rate limiting per IP, host PIN fallback, DO state TTL enforcement, structured logging, and proper coverage integration (blocked by `node:inspector` availability in Workers runtime).
