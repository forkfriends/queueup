# QueueUp API

All backend endpoints are served from the Cloudflare Worker mounted at `/api/queue`. The worker proxies all queue lifecycle mutations into a per-session Durable Object (`QueueDO`) which owns ordering, persistence and fan-out.

Unless otherwise noted, responses use JSON and failures follow the structure:

```json
{ "error": "message" }
```

Every host-authenticated route requires the caller to present the host cookie (see [Host Auth](#host-auth)). Guest routes require the queue short code or the party identifier returned by `join`.

## Turnstile Support

`POST /{code}/join` expects a Turnstile token generated on the client. During tests we provide a `TURNSTILE_BYPASS` flag that skips verification; production traffic must send a valid token.

## Routes

### `POST /api/queue/create`

Creates a queue session and returns routing metadata.

**Response (200)**

```json
{
  "code": "ABC123",
  "sessionId": "c501a1b2-...",
  "joinUrl": "https://app.example/queue/ABC123",
  "wsUrl": "https://api.example/api/queue/ABC123/connect"
}
```

The response also sets an `HttpOnly` cookie (`queue_host_auth`) containing an HMAC of the Durable Object ID. This cookie authenticates subsequent host operations.

### `POST /api/queue/{code}/join`

Adds a party to the queue.

**Request**

```json
{
  "name": "Ada",
  "size": 2,
  "turnstileToken": "token-from-client"
}
```

`name` and `size` are optional. `turnstileToken` is required.

**Response (200)**

```json
{
  "partyId": "b31729c0-...",
  "position": 4
}
```

### `POST /api/queue/{code}/declare-nearby`

Marks a party as nearby.

**Request**

```json
{ "partyId": "b31729c0-..." }
```

**Response** – `{ "ok": true }`

### `POST /api/queue/{code}/leave`

Allows a guest to leave the queue voluntarily.

```json
{ "partyId": "b31729c0-..." }
```

### `POST /api/queue/{code}/advance` _(host only)_

Confirms the current party as served and optionally selects the next party.

**Request**

```json
{
  "servedParty": "b31729c0-...",   // optional: defaults to current call
  "nextParty": "a63e..."           // optional: pick specific waiting party
}
```

**Response**

```json
{
  "nowServing": {
    "id": "a63e...",
    "name": "Bob",
    "size": 3,
    "status": "called",
    "nearby": true,
    "joinedAt": 1738600000000
  }
}
```

### `POST /api/queue/{code}/kick` _(host only)_

```json
{ "partyId": "..." }
```

Marks the party as removed and notifies their socket (if connected).

### `POST /api/queue/{code}/close` _(host only)_

Transitions the queue to `closed`, clears pending parties, persists an audit event and broadcasts `{ "type": "closed" }` to all sockets. Response: `{ "ok": true }`.

### `GET /api/queue/{code}/connect`

Upgrades to a WebSocket. Both hosts and guests use the same endpoint:

- Hosts must present the host cookie (`queue_host_auth`).
- Guests append `?partyId=...`.

#### Host Messages

```json
{
  "type": "queue_update",
  "queue": [
    { "id": "...", "name": "Ada", "status": "waiting", "nearby": false, "joinedAt": 1738600000000 }
  ],
  "nowServing": { "id": "...", "name": "Bob", "status": "called", "nearby": true, "joinedAt": 1738599900000 }
}
```

#### Guest Messages

- `{ "type": "position", "position": 3, "aheadCount": 2 }`
- `{ "type": "called" }`
- `{ "type": "removed", "reason": "no_show" | "kicked" | "served" | "closed" }`
- `{ "type": "closed" }`

## Host Auth

Host actions require the HMAC cookie issued at creation time.

```
Set-Cookie: queue_host_auth=<sessionId>.<signature>;
            Max-Age=604800; HttpOnly; Secure; SameSite=Strict; Path=/
```

Signatures are computed with the `HOST_AUTH_SECRET` secret using HMAC-SHA256. The worker validates cookies on every host route and during WebSocket upgrades.

## Rate Limiting / Security

- Turnstile verification is performed server-side on `join`.
- Simple input validation guards request shape.
- Rate limiting hooks will be layered with KV/Durable Objects in future iterations. Currently the worker accepts Cloudflare edge IP limiting.
- CORS is restricted to known origins configured via the `ALLOWED_ORIGINS` binding (defaults to the request origin for native clients).

## Errors

Common HTTP codes:

| Status | Condition                                   |
| ------ | ------------------------------------------- |
| 400    | Invalid payload / Turnstile failure         |
| 401    | Missing host cookie or guest partyId        |
| 403    | Host signature mismatch                     |
| 404    | Queue short code or party not found         |
| 405    | Wrong method (non-POST on mutation routes)  |
| 409    | Queue already closed                        |
| 500    | Unexpected Durable Object / D1 failure      |

Errors contain diagnostics in the response body and, where relevant, include Turnstile error codes.
