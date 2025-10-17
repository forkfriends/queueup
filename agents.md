# QR Join Flow Plan

1. Increase worker share link fidelity
   - Add an env var such as `APP_PUBLIC_BASE_URL` in `api/wrangler.toml` (fallback to `url.origin`).
   - Update `handleCreate` in `api/worker.ts` to build `joinUrl` with that base so new queues point at the public app (e.g. `https://app.example/queue/<code>`).
   - Redeploy worker and smoke-test by creating a queue to confirm the generated link.

2. Configure deep linking in the Expo app
   - Update `App.tsx` navigation container with a linking config mapping `/queue/:code` → `JoinQueueScreen`.
   - Register platform-specific prefixes (custom scheme and the public HTTPS origin) so links from QR work on native and web.

3. Auto-fill join flow for scanned links
   - Accept a `code` param in `JoinQueueScreen` and set the initial `key` state from navigation params.
   - If `code` exists, focus the form on name/party size; optionally auto-submit once details are provided.
   - Handle join errors gracefully (invalid code, queue closed) while keeping websocket reconnection logic intact.

4. Web landing polish
   - Ensure Expo web build resolves `/queue/<code>` to `JoinQueueScreen` during SSR/static export.
   - Add contextual messaging for guests arriving via link (e.g. show queue name/status once available).

5. Optional follow-ups
   - Expose quick actions ("I'm nearby", "Leave queue") post-join.
   - Provide a fallback hosted web page if the native app is not installed.
