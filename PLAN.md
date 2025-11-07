Plan: Ship Web Push on Cloudflare (QueueUp)

Goal
- Deliver low-cost, low-latency web push for guests so they get: “called”, “you’re #2”, and “you’re #5” alerts. Keep the plan aligned with our current Cloudflare Worker + Durable Objects + D1 design and existing tables (sessions, parties, events).

Architecture fit
- Frontend: Expo web app hosted on GitHub Pages at https://forkfriends.github.io/queueup/ (basePath /queueup/).
- Backend: Single Worker (api/worker.ts) that fronts Durable Object (QueueDO) + D1 + KV.
- New pieces: service worker (sw.js) served at the Pages origin, client helper to subscribe on user action, Worker endpoints to store subs and send pushes, and DO hooks to trigger sends.

Data model (D1)
- New table push_subscriptions. We scope per session+party so guests can be in multiple queues without collisions.
  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    party_id   TEXT NOT NULL,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (party_id)   REFERENCES parties(id)  ON DELETE CASCADE
  );
  CREATE INDEX idx_push_session_party ON push_subscriptions(session_id, party_id);
- Instrumentation: reuse existing events table. Add rows:
  - type='push_sent' details={"kind":"called"|"pos_2"|"pos_5"}
  - type='notif_click' details={"url":"/..."}
  - type='declare_confirm' already represented via existing flows (we’ll add event if missing).
- Migration: add api/migrations/004_push.sql with the DDL above; apply via npm run migrate:apply.

Secrets and config (Worker)
- One-time local VAPID keys:
  - npm i web-push -D
  - node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"
  - wrangler secret put VAPID_PUBLIC
  - wrangler secret put VAPID_PRIVATE
- Add to Env (api/worker.ts): VAPID_PUBLIC: string; VAPID_PRIVATE: string.
- Add dependency to api Worker project: npm i @block65/webcrypto-web-push (already used only on Worker side).

Worker endpoints (api/worker.ts)
- GET /api/push/vapid → returns { publicKey: env.VAPID_PUBLIC }. CORS align with existing applyCors.
- POST /api/push/subscribe → body { sessionId, partyId, subscription }.
  - Persist INSERT OR IGNORE into push_subscriptions (flatten keys: endpoint, keys.p256dh, keys.auth).
  - Return 200.
- POST /api/push/send → body { sessionId, partyId, payload:{title,body,url}, kind:"called"|"pos_2"|"pos_5" }.
  - Look up the newest sub for (sessionId, partyId); if not found 404.
  - sendWebPush(sub, JSON.stringify(payload), { vapid:{ subject:"mailto:team@queue-up.app", publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE }, request:{ headers:{ TTL:"60" } } })
  - On 404/410 from push service, delete that endpoint.
  - Insert events row (type='push_sent', details includes kind); return 200.
- POST /api/push/test → convenience wrapper to call /api/push/send without kind checks for manual QA.
- POST /api/track → body { sessionId, partyId?, type:'notif_click'|..., meta? }
  - Insert into events (session_id, party_id, type, details=JSON.stringify(meta)). 200.

Durable Object hooks (api/queue-do.ts)
- Called: after we set nowServing and persist (advanceQueue → notifyGuestCalled), add a fire-and-forget fetch to /api/push/send with kind:"called" for that party.
- Position n=2 and n=5: after queue mutations that change positions (advanceQueue, removeParty, handleJoin), compute the party’s new position using existing computePosition:
  - If position === 2 or 5, and we have NOT previously logged events(type='push_sent', details.kind='pos_2'|'pos_5') for this (sessionId, partyId): send push and log.
  - Dedup: cheap SELECT EXISTS from events or rely on events insert + UNIQUE(key) pattern via app-level check (keep minimal: SELECT first, then insert).
- No additional state fields required; we leverage events table for dedupe and audit.

Client integration (web only)
- Service worker registration and subscription are only shown on web Platform.
- Add a lightweight helper (e.g., components/Join/EnablePush.tsx) that:
  - fetches VAPID public key from /api/push/vapid,
  - registers sw.js with correct scope,
  - requests Notification permission after a user click,
  - subscribes via PushManager.subscribe and POSTs to /api/push/subscribe with { sessionId, partyId, subscription }.
- Wire this helper into JoinQueueScreen once the guest has a partyId from the join API. Do not auto-prompt; use a two-step ask.

Service worker (sw.js)
- Minimal:
  self.addEventListener('push', (event) => {
    if(!event.data) return;
    const data = event.data.json();
    event.waitUntil(self.registration.showNotification(data.title||'QueueUp', {
      body: data.body,
      icon: '/queueup/icons/icon-192.png',
      badge: '/queueup/icons/badge.png',
      data: { url: data.url || '/queueup/' }
    }));
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/queueup/';
    event.waitUntil((async () => {
      const all = await clients.matchAll({ type:'window', includeUncontrolled:true });
      const existing = all.find(c => new URL(c.url).origin === location.origin);
      if (existing) { existing.focus(); existing.postMessage({ type:'notif-open' }); }
      else { await clients.openWindow(url); }
      try { await fetch('/api/track', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ type:'notif_click' }) }); } catch {}
    })());
  });
- Hosting on GitHub Pages basePath (/queueup/): place sw.js at the Pages site root so scope aligns. For Expo web deploy, ensure sw.js is copied to the output root (e.g., via static file copy step in the Pages workflow or an assets/public folder). Register with scope '/queueup/'.

Routing and CORS
- Reuse applyCors in api/worker.ts for new endpoints. Add routes alongside existing /api/queue* handling.
- Allowed origins already include https://forkfriends.github.io; ensure local dev origin is permitted.

Rollout steps
- 1) Create migration 004_push.sql; apply to D1.
- 2) Add secrets VAPID_PUBLIC/PRIVATE.
- 3) Add Worker routes (/api/push/vapid, /api/push/subscribe, /api/push/send, /api/push/test, /api/track) and @block65/webcrypto-web-push.
- 4) Add DO trigger calls on called/position changes with event-based dedupe.
- 5) Add sw.js and client helper; conditionally render enable button on web when partyId is known.
- 6) QA matrix (Chrome/Edge/Firefox desktop, Android Chrome, iOS PWA via Add to Home Screen). Validate stale sub cleanup by deleting endpoint to force 404/410.

KPI instrumentation (reported from events table)
- notif→confirm conversion: percentage of guests who clicked a notif (notif_click) and confirmed (declare_confirm) within 2 minutes after a 'called' push_sent.
- median return time after pos_2 push.
- unsubscribes/failures: count of send failures and stale sub deletions.

Testing checklist
- Subscribe/unsubscribe loop works; re-subscribe after deleting row recovers.
- Called push arrives; tapping focuses the PWA and navigates to queue.
- pos_2 and pos_5 pushes are single-fire per party per session.
- Stale subscription cleanup path removes endpoints.
- iOS: verify after installing to Home Screen.

Notes and tradeoffs
- We key subs by (sessionId, partyId) to avoid cross-session collisions; a guest rejoining yields a new partyId which is fine.
- We avoid extra D1 state by using events for dedupe; if we see race-y double sends in prod, we can add a UNIQUE(session_id, party_id, kind) shadow table later.
- Public key delivery via endpoint avoids rebuilding the web app when rotating VAPID keys.
