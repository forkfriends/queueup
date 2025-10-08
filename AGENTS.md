# AGENTS.md — Agent Execution Plan (Cloudflare Workers backend for “On‑Demand QR Queue Sessions”)

> **Note for the agent:** This exact prompt is also available in `AGENTS.md` for future reference. Do not change the existing Expo frontend structure. All backend code must live in `api/`. Keep UI edits to a minimum (only tiny test screens if needed).

You are an autonomous coding agent with git access. Implement the **backend and thin mobile plumbing** for a QR‑first, on‑demand queueing app. **UI is not your focus** (another teammate is styling with NativeWind). Your work must run entirely on **Cloudflare Free** (Workers + Durable Objects + D1 + KV + Cron + Turnstile). **No paid services.**

Use **TypeScript** throughout.

---

## 0) Product in one sentence
Venues create **ephemeral queue sessions** via QR/link; guests join without installing an app, see their place/ETA, can mark “I’m nearby,” and are advanced by staff with minimal intervention. Real‑time updates fan out to guest devices and a “Now Serving” host screen.

## 1) Constraints & repo assumptions
- Existing project is **Expo** (React Native) + NativeWind with a skeleton frontend already set up.
- **Do not** restructure frontend or introduce workspaces/monorepo. Preserve current layout.
- **All backend lives under** `api/` in this repo (Cloudflare Worker + Durable Object + D1 migrations + tests).
- Minimal UI changes allowed **only** for testing (e.g., a bare Host/Guest test screen). No design work (NativeWind styling handled elsewhere).
- Free‑tier only: Workers, Durable Objects, D1, KV, Cron Triggers, Turnstile.

## 2) Why Cloudflare Workers (brief)
- **Correctness:** One **Durable Object (DO)** per queue session = single writer/arbiter → race‑free ordering and simple fan‑out via WebSockets.
- **Real‑time:** DO acts as a **WebSocket server** (hibernation supported) for live host/guest updates.
- **Free‑tier capacity:** D1 daily writes are generous for our write‑lean design (+ KV for fast code→DO routing).

## 3) Free‑tier guardrails to respect
- **Workers Free:** ~100k requests/day per account (design to keep API calls low).
- **D1 Free:** ~100k writes/day, ~5M reads/day, storage caps (write‑lean pattern below).
- **KV Free:** 100k reads/day, 1k writes/day (use sparingly for short‑code routing, small counters).
- **Queues product:** not used. Use **Cron** + **DO Alarms** for scheduled/timeout work.

---

## 4) Backend architecture (inside `api/`)
```
api/
├─ worker.ts            # HTTP router, Turnstile verify, code→DO resolution, scheduled handler
├─ queue-do.ts          # QueueDO: state machine, WS room, alarms, D1 writes
├─ migrations/
│  └─ 001_init.sql      # D1 schema: sessions, parties, events
├─ tests/               # Vitest/Jest + Miniflare
│  ├─ queue.unit.test.ts
│  └─ queue.int.test.ts
├─ wrangler.toml        # DO/D1/KV bindings + Cron
├─ tsconfig.json
└─ (optional) types/*.d.ts
```

### 4.1 Data model (D1) — write‑lean, analytics‑friendly
Create `api/migrations/001_init.sql`:
```sql
-- sessions: one DO-backed session per queue
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- DO id or UUID
  short_code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status TEXT NOT NULL DEFAULT 'active',      -- active|closed|expired
  expires_at INTEGER,                          -- optional
  host_pin TEXT                                 -- optional (if using PIN auth)
);

-- parties: members of a session's queue
CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT,
  size INTEGER,
  joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status TEXT NOT NULL DEFAULT 'waiting',      -- waiting|called|served|no_show|left
  nearby INTEGER NOT NULL DEFAULT 0,           -- 0|1
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- events: append-only audit
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  party_id TEXT,
  type TEXT NOT NULL,                          -- joined|advanced|no_show|left|close
  ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  details TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE INDEX idx_parties_session ON parties(session_id);
CREATE INDEX idx_events_session_ts ON events(session_id, ts);
```

### 4.2 HTTP & WS surface (Worker)
**Routes (prefix `/api/queue`)**
```
POST   /create                  -> { code, sessionId, joinUrl, wsUrl } + set host cookie (or return PIN)
POST   /{code}/join             -> { name, size, turnstileToken } -> { partyId, position }
POST   /{code}/declare-nearby   -> { partyId } -> { ok: true }
POST   /{code}/leave            -> { partyId } -> { ok: true }
POST   /{code}/advance          -> (host‑only) { servedParty?, nextParty? }
POST   /{code}/kick             -> (host‑only) { partyId } -> { ok: true }
POST   /{code}/close            -> (host‑only) { ok: true }
GET    /{code}/connect          -> WebSocket upgrade (host via cookie; guest via ?partyId=...)
```
- **Turnstile:** On `/join`, verify token server‑side (`/siteverify`) before forwarding to DO.
- **Routing:** Resolve `short_code → DO id` via KV; fallback `idFromName(code)` if needed; backfill KV.
- **Auth (host):** Signed HttpOnly cookie (HMAC(doId)). Alternatively, a short **PIN**. Verify on host endpoints & WS connect.

### 4.3 Durable Object (`QueueDO`)
Responsibilities:
- **Live state:** ordered queue, `nowServing`, `lastSeen`, `nearby` flags, connections map.
- **WebSockets:** accept host/guest sockets; broadcast **snapshot** on connect + **delta** on mutations.
- **Lifecycle mutations:** `join`, `declareNearby`, `advance`, `leave`, `kick`, `close`.
- **Anti‑ghosting:** on `advance`, set **Alarm**; if timer fires before confirmation → mark `no_show`, emit event, auto‑advance.
- **Persistence:** write‑lean: only persist lifecycle points (`joined`, `served/no_show/left`, `close`) to D1; avoid chatty writes.

Broadcast contract:
```json
// Host messages
{ "type":"queue_update", "queue":[ { "id":"...", "name":"...", "status":"waiting|called", "nearby":true, "size":2 }, ... ], "nowServing": { ... } }

// Guest messages
{ "type":"position", "position": 5, "aheadCount": 4 }
{ "type":"called" }
{ "type":"removed", "reason":"no_show|kicked|closed" }
{ "type":"closed" }
```

---

## 5) Security, abuse controls, rate‑limits
- **Turnstile** on join; server‑side verify **every** time.
- **Host actions** require signed cookie or PIN; verify on Worker and/or DO.
- **Rate‑limit write endpoints** (simple token bucket by IP; store counters in KV or a tiny per‑IP DO).
- **Input validation** with lightweight schema checks (zod or hand‑rolled guards).
- **CORS**: restrict to known app origins; send proper headers on API routes.

---

## 6) Implementation steps & git checkpoints
Use **conventional commits**. Create small, reviewable PRs.

### ✅ CHECKPOINT 1 — COMPLETED 2025-10-08
**Commit:** `chore(api): bootstrap Cloudflare Worker config and stubs`  
**Delivered:**
- `api/wrangler.toml` with DO/D1/KV bindings + cron schedule scaffold.
- Stubbed `api/worker.ts` exposing typed env + placeholder `fetch`/`scheduled`.
- Stubbed `api/queue-do.ts` with `QueueDO` skeleton and env import.
- `api/tsconfig.json` targeting Workers + dev dependency `@cloudflare/workers-types`.

### ✅ CHECKPOINT 2 — COMPLETED 2025-10-08
**Commit:** `feat(api): add D1 schema migration (sessions, parties, events)`  
**Delivered:**
- `api/migrations/001_init.sql` with sessions/parties/events tables plus indexes.
- Added `migrate:apply` script (`wrangler d1 migrations apply DB`) to `package.json`.

### ✅ CHECKPOINT 3
**Commit:** `feat(api): HTTP router + Turnstile siteverify + KV code map`  
**Do:**
- Implement endpoints in `worker.ts` (see section 4.2).
- Implement Turnstile `/siteverify` call on `/join`.
- Implement short‑code generation + uniqueness + KV put/get.
- Set host auth cookie (HMAC(doId)) or return PIN in JSON.

### ✅ CHECKPOINT 4
**Commit:** `feat(api): QueueDO WebSockets, state machine, alarms, D1 writes`  
**Do:**
- In `queue-do.ts`, accept WS upgrade, distinguish host vs guest (cookie vs `?partyId`).
- Implement `join/advance/declareNearby/leave/kick/close` (HTTP and/or WS message paths).
- Broadcast **snapshot/delta** to host & per‑guest updates.
- On `advance`, set **Alarm**; in `alarm()` mark **no_show** and auto‑advance.
- Persist only lifecycle events to D1.

### ✅ CHECKPOINT 5
**Commit:** `test(api): unit + integration tests (Miniflare), coverage thresholds`  
**Do:**
- **Unit:** code gen, cookie HMAC verify, small pure helpers.
- **Integration (Miniflare):** create → join → connect (host+guest WS) → advance → (optional) nearby → alarm(no_show) → auto‑advance → close.
- Provide script(s): `npm run test`.

### ✅ CHECKPOINT 6
**Commit:** `ci: add GitHub Actions (ci, e2e, deploy)`  
**Do:** Add three workflows (edit paths if repo differs):
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm run typecheck --if-present
      - run: npm test
```

```yaml
# .github/workflows/e2e.yml
name: E2E (scheduled)
on:
  schedule: [{ cron: "0 4 * * *" }]
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run test:e2e --if-present
```

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
    paths:
      - "api/**"
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Publish with Wrangler
        run: npx wrangler publish
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```

### ✅ CHECKPOINT 7
**Commit:** `docs: add API.md, ARCHITECTURE.md, DEPLOYMENT.md, AGENTS.md`  
**Do:** Write:
- **API.md** — HTTP endpoints & WS protocol (examples for each).
- **ARCHITECTURE.md** — DO as queue arbiter, WS fan‑out, D1 persistence, KV routing, Cron & Alarms, free‑tier notes.
- **DEPLOYMENT.md** — KV + D1 creation, secrets (`TURNSTILE_SECRET_KEY`, `HOST_AUTH_SECRET`), `wrangler d1 migrations apply`, `wrangler publish` or GH Actions deploy.
- **AGENTS.md** — this file.

---

## 7) Worker & DO implementation tips (pseudocode)

**`worker.ts` (sketch):**
```ts
export interface Env {
  QUEUE_DO: DurableObjectNamespace;
  QUEUE_KV: KVNamespace;
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HOST_AUTH_SECRET: string;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/queue(?:\/(create|[A-Z0-9]{6})(?:\/(join|declare-nearby|leave|advance|kick|close|connect))?)?$/);
    if (!m) return new Response("Not found", { status: 404 });
    const [, seg1, seg2] = m;
    if (req.method === "POST" && seg1 === "create") return handleCreate(env);
    if (seg1 && seg2 === "connect" && req.method === "GET") return handleConnectWS(req, env, seg1);
    if (req.method === "POST" && seg1 && seg2) return handleAction(req, env, seg1, seg2);
    return new Response("Not found", { status: 404 });
  },
  async scheduled(event, env) {
    // cleanup: close expired sessions, prune KV, optional rollups
  }
}
```

**`queue-do.ts` (sketch):**
```ts
export class QueueDO implements DurableObject {
  private sockets = new Map<WebSocket, { role:"host"| "guest"; partyId?:string }>();
  private queue: Array<{ id:string; name?:string; size?:number; status:"waiting"|"called"; nearby:boolean }> = [];
  private pending?: string; // partyId currently called & awaiting confirm

  constructor(private state: DurableObjectState, private env: Env) {
    this.state.blockConcurrencyWhile(async () => {
      // Load queue from D1 (waiting|called)
      // Optionally restore pending for alarm
    });
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") === "websocket" && url.pathname.endsWith("/connect")) {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]] as any;
      server.accept();
      // verify host cookie OR guest partyId param
      // register in this.sockets and send initial snapshot/deltas
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.endsWith("/join") && req.method === "POST") { /* join logic */ }
    if (url.pathname.endsWith("/advance") && req.method === "POST") { /* advance */ }
    if (url.pathname.endsWith("/declare-nearby") && req.method === "POST") { /* mark nearby */ }
    if (url.pathname.endsWith("/leave") && req.method === "POST") { /* leave */ }
    if (url.pathname.endsWith("/kick") && req.method === "POST") { /* kick */ }
    if (url.pathname.endsWith("/close") && req.method === "POST") { /* close */ }
    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    // if pending still not confirmed → mark no_show, persist, broadcast, auto-advance
  }

  private broadcastToHost(msg:any) { /* send to host socket(s) */ }
  private notifyGuest(partyId:string, msg:any) { /* lookup socket by partyId */ }
}
```

---

## 8) Testing plan (Vitest/Jest + Miniflare)
- **Unit:** code gen, cookie HMAC verify, input guards, small queue helpers.
- **Integration:** with **Miniflare** spin up Worker+DO+KV+D1.
  1) `POST /api/queue/create` → get `code` + host cookie.
  2) `POST /api/queue/{code}/join` (Turnstile verify stubbed in test) → `{ partyId, position }`.
  3) `GET  /api/queue/{code}/connect?partyId=...` (guest WS).
  4) Host WS connect (send cookie header).
  5) Host **advance** (via WS or HTTP) → guest receives `{ "type":"called" }`.
  6) No “nearby” → **Alarm** fires (short timeout in test) → guest removed as `no_show`, host sees update.
  7) **Close** → all sockets receive `{ "type":"closed" }`, then server closes.
- **Coverage goal:** ≥ **80% lines** on `api/` package.

---

## 9) GitHub Actions (CI/CD)
Add three workflows (tweak paths to match repo):

**CI (`.github/workflows/ci.yml`)** — lint, typecheck, test on every push/PR (see Checkpoint 6).  
**E2E (`.github/workflows/e2e.yml`)** — scheduled/nightly loadish test.  
**Deploy (`.github/workflows/deploy.yml`)** — on push to `main`, deploy with `wrangler publish` (requires `CF_API_TOKEN`, `CF_ACCOUNT_ID` secrets).  
Also document `wrangler d1 migrations apply` in `DEPLOYMENT.md` (run pre‑publish if needed).

---

## 10) Documentation to add
- **API.md** — full HTTP + WS interface with request/response examples and error codes.
- **ARCHITECTURE.md** — DO responsibilities, WS flows, D1 usage, KV mapping, Cron/Alarms, free‑tier rationale.
- **DEPLOYMENT.md** — setup KV/D1, set secrets (`TURNSTILE_SECRET_KEY`, `HOST_AUTH_SECRET`), run migrations, publish (or via GH Actions).
- **AGENTS.md** — this exact prompt/spec.

---

## 11) Definition of Done (DoD)
- **Functional**
  - `POST /api/queue/create` returns `{ code, sessionId, joinUrl, wsUrl }` and sets host cookie (or returns PIN).
  - Guests can **join**, **connect via WS**, **declare nearby**, **leave**.
  - Host can **advance**, **kick**, **close**; updates broadcast in real‑time.
  - **Anti‑ghosting:** on advance, alarm → no‑show → auto‑advance works.
  - D1 persist: sessions, parties, and append‑only events reflect reality.
- **Quality**
  - Typecheck & lint pass; **tests ≥ 80%** coverage; integration WS tests green.
  - Robust input validation; clear error responses; basic rate‑limits active.
- **Ops**
  - `wrangler publish` succeeds via GH Actions with secrets.
  - `DEPLOYMENT.md` accurate; `API.md` complete; logs observable via `wrangler tail`.
- **Safety**
  - Turnstile enforced on join (server‑side verify).
  - Host actions authenticated; secrets managed securely (not in git).

---

## 12) Nice‑to‑haves (optional if time remains)
- Per‑session analytics endpoints (avg wait, served count).
- CSV export of events by session.
- Simple QR generation helper for `joinUrl` (mobile only, dev aid).

---

## 13) Useful scripts (root or package scripts)
```json
{
  "scripts": {
    "dev:api": "wrangler d1 migrations apply DB && wrangler dev api/worker.ts",
    "migrate:apply": "wrangler d1 migrations apply DB",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.tsx",
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy": "wrangler publish"
  }
}
```

**End of AGENTS.md**
