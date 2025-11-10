import { buildPushPayload } from '@block65/webcrypto-web-push';
import {
  HOST_COOKIE_MAX_AGE_SECONDS,
  HOST_COOKIE_NAME,
  generateHostCookieValue,
  verifyHostCookie,
} from './utils/auth';
import { logAnalyticsEvent } from './analytics';
export { QueueDO } from './queue-do';

export interface Env {
  QUEUE_DO: DurableObjectNamespace;
  QUEUE_KV: KVNamespace;
  DB: D1Database;
  EVENTS: Queue;
  TURNSTILE_SECRET_KEY: string;
  HOST_AUTH_SECRET: string;
  VAPID_PUBLIC?: string;
  VAPID_PRIVATE?: string;
  VAPID_SUBJECT?: string;
  ALLOWED_ORIGINS?: string;
  TURNSTILE_BYPASS?: string;
  TEST_MODE?: string;
  APP_BASE_URL?: string;
}

const DEFAULT_APP_BASE_URL = 'https://forkfriends.github.io/queueup/';
const MS_PER_MINUTE = 60 * 1000;
const FALLBACK_CALL_WINDOW_MINUTES = 2;

const ROUTE =
  /^\/api\/queue(?:\/(create|[A-Za-z0-9]{6})(?:\/(join|declare-nearby|leave|advance|kick|close|connect|snapshot))?)?$/;
const SHORT_CODE_LENGTH = 6;
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MIN_QUEUE_CAPACITY = 1;
const MAX_QUEUE_CAPACITY = 100;
const MAX_LOCATION_LENGTH = 240;
const MAX_CONTACT_LENGTH = 500;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const queueLinkMatch = /^\/queue\/([A-Za-z0-9]{6})$/.exec(url.pathname);
      if (queueLinkMatch) {
        const code = queueLinkMatch[1].toUpperCase();
        const baseUrl =
          env.APP_BASE_URL && env.APP_BASE_URL.trim().length > 0
            ? env.APP_BASE_URL.trim()
            : DEFAULT_APP_BASE_URL;
        let redirectUrl: URL;
        try {
          redirectUrl = new URL(baseUrl);
        } catch (error) {
          console.warn('Invalid APP_BASE_URL, falling back to default');
          redirectUrl = new URL(DEFAULT_APP_BASE_URL);
        }
        redirectUrl.searchParams.set('code', code);
        return Response.redirect(redirectUrl.toString(), 302);
      }
    }

    const originResult = resolveAllowedOrigin(request, url, env);
    if (originResult instanceof Response) {
      return originResult;
    }
    const corsOrigin = originResult;

    if (request.method === 'OPTIONS') {
      return applyCors(new Response(null, { status: 204 }), corsOrigin, undefined, true);
    }

    // Push API: VAPID public key
    if (request.method === 'GET' && url.pathname === '/api/push/vapid') {
      const body = JSON.stringify({ publicKey: env.VAPID_PUBLIC ?? null });
      return applyCors(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }), corsOrigin);
    }

    // Push API: subscribe
    if (request.method === 'POST' && url.pathname === '/api/push/subscribe') {
      try {
        const { sessionId, partyId, subscription } = (await readJson(request)) ?? {};
        if (!sessionId || !partyId || !subscription || !subscription.endpoint || !subscription.keys) {
          return applyCors(jsonError('Invalid subscription payload', 400), corsOrigin);
        }
        const { endpoint, keys } = subscription as { endpoint: string; keys: { p256dh: string; auth: string } };
        await env.DB
          .prepare(
            `INSERT INTO push_subscriptions (session_id, party_id, endpoint, p256dh, auth)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(endpoint) DO UPDATE SET
               session_id=excluded.session_id,
               party_id=excluded.party_id,
               p256dh=excluded.p256dh,
               auth=excluded.auth,
               created_at=strftime('%s','now')`
          )
          .bind(sessionId, partyId, endpoint, keys.p256dh, keys.auth)
          .run();

        if (env.VAPID_PUBLIC && env.VAPID_PRIVATE) {
          ctx.waitUntil(
            sendPushNotification(env, {
              sessionId,
              partyId,
              subscription: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
              title: 'You joined the queue',
              body: 'We will alert you as you get closer to the front.',
              url: buildAppUrl(env),
              kind: 'join_confirm',
            }).catch((err) => console.warn('join push error', err))
          );
        }
        return applyCors(new Response('ok'), corsOrigin);
      } catch (e) {
        console.error('subscribe error', e);
        return applyCors(new Response('fail', { status: 500 }), corsOrigin);
      }
    }

    // Track events (notif clicks, etc.)
    if (request.method === 'POST' && url.pathname === '/api/track') {
      const payload = (await readJson(request)) ?? {};
      const { sessionId, partyId, type, meta } = payload;
      if (!type) {
        return applyCors(jsonError('type required', 400), corsOrigin);
      }
      try {
        const insertResult = await env.DB.prepare(
          'INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, ?3, ?4)'
        ).bind(
          sessionId ?? null,
          partyId ?? null,
          String(type),
          meta ? JSON.stringify(meta) : null
        ).run();
        if (insertResult.error) {
          console.warn('track insert warning', insertResult.error);
        }
      } catch (error) {
        console.error('track error', error);
      }
      return applyCors(new Response('ok'), corsOrigin);
    }

    // Manual test push endpoint
    if (request.method === 'POST' && url.pathname === '/api/push/test') {
      try {
        const { sessionId, partyId, title, body, url: targetUrl } = (await readJson(request)) ?? {};
        if (!sessionId || !partyId) return applyCors(jsonError('sessionId and partyId required', 400), corsOrigin);
        const sub = await env.DB.prepare(
          'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE session_id=?1 AND party_id=?2 ORDER BY created_at DESC LIMIT 1'
        ).bind(sessionId, partyId).first<{ endpoint: string; p256dh: string; auth: string }>();
        if (!sub) return applyCors(new Response('no subscription', { status: 404 }), corsOrigin);
        if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return applyCors(new Response('vapid not set', { status: 500 }), corsOrigin);
        const sent = await sendPushNotification(env, {
          sessionId,
          partyId,
          subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          title: title || 'QueueUp',
          body: body || 'Hello!',
          url: targetUrl || '/',
          kind: 'test',
          dedupe: false,
        });
        if (!sent) {
          return applyCors(new Response('stale removed', { status: 410 }), corsOrigin);
        }
        return applyCors(new Response('sent'), corsOrigin);
      } catch (e) {
        console.error('push test error', e);
        return applyCors(new Response('fail', { status: 500 }), corsOrigin);
      }
    }

    const match = ROUTE.exec(url.pathname);
    if (!match) {
      return applyCors(new Response('Not found', { status: 404 }), corsOrigin);
    }

    const primary = match[1];
    const action = match[2];
    try {
      if (request.method === 'POST' && primary === 'create') {
        const response = await handleCreate(request, env, url, corsOrigin);
        return applyCors(response, corsOrigin, ['set-cookie']);
      }

      if (primary && action === 'connect' && request.method === 'GET') {
        const response = await handleConnect(request, env, primary);
        if (response.status === 101) {
          return response;
        }
        return applyCors(response, corsOrigin, ['set-cookie']);
      }

      if (primary && action === 'snapshot' && request.method === 'GET') {
        const response = await handleSnapshot(request, env, primary);
        return applyCors(response, corsOrigin, ['etag']);
      }

      if (request.method === 'POST' && primary && action) {
        const response = await handleAction(request, env, primary, action);
        return applyCors(response, corsOrigin);
      }
    } catch (error) {
      console.error('Worker error:', error);
      return applyCors(new Response('Internal Server Error', { status: 500 }), corsOrigin);
    }

    return applyCors(new Response('Not found', { status: 404 }), corsOrigin);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled cleanup will arrive in later checkpoints.
  },

  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        const event = message.body as {
          type: string;
          sessionId: string;
          partyId?: string;
          position?: number;
          queueLength?: number;
          deadline?: number | null;
          reason?: string;
        };

        console.log(`[Queue Consumer] Processing event: ${event.type} for session ${event.sessionId}`);

        // Handle push notifications
        if (event.partyId) {
          switch (event.type) {
            case 'QUEUE_MEMBER_CALLED':
              {
                const msRemaining =
                  typeof event.deadline === 'number'
                    ? Math.max(event.deadline - Date.now(), 0)
                    : FALLBACK_CALL_WINDOW_MINUTES * MS_PER_MINUTE;
                const minutesRemaining = Math.max(
                  1,
                  Math.ceil(msRemaining / MS_PER_MINUTE)
                );
                const minuteLabel = minutesRemaining === 1 ? 'minute' : 'minutes';
                await sendPushToParty(env, event.sessionId, event.partyId, {
                  title: "It's your turn!",
                  body: `Please confirm within ${minutesRemaining} ${minuteLabel}.`,
                  kind: 'called',
                });
              }
              break;

            case 'QUEUE_POSITION_2':
              {
                const sent = await sendPushToParty(env, event.sessionId, event.partyId, {
                  title: 'Almost there!',
                  body: "You're next in line.",
                  kind: 'pos_2',
                });
                if (sent) {
                  await logAnalyticsEvent({
                    db: env.DB,
                    sessionId: event.sessionId,
                    partyId: event.partyId,
                    type: 'nudge_sent',
                    details: {
                      kind: 'pos_2',
                      position: event.position ?? 2,
                      queueLength: event.queueLength ?? null,
                    },
                  });
                }
              }
              break;

            case 'QUEUE_POSITION_5':
              {
                const sent = await sendPushToParty(env, event.sessionId, event.partyId, {
                  title: 'Getting close!',
                  body: "You're 5th in line.",
                  kind: 'pos_5',
                });
                if (sent) {
                  await logAnalyticsEvent({
                    db: env.DB,
                    sessionId: event.sessionId,
                    partyId: event.partyId,
                    type: 'nudge_sent',
                    details: {
                      kind: 'pos_5',
                      position: event.position ?? 5,
                      queueLength: event.queueLength ?? null,
                    },
                  });
                }
              }
              break;

            case 'QUEUE_MEMBER_JOINED':
              // Already handled in subscribe endpoint
              break;

            case 'QUEUE_MEMBER_SERVED':
            case 'QUEUE_MEMBER_DROPPED':
            case 'QUEUE_MEMBER_LEFT':
            case 'QUEUE_MEMBER_KICKED':
              // No push needed for these
              break;
          }
        }

        // Log event to D1 (optional analytics)
        await logAnalyticsEvent({
          db: env.DB,
          sessionId: event.sessionId,
          partyId: event.partyId ?? null,
          type: 'queue_event',
          details: { eventType: event.type, ...event },
        });

        message.ack();
      } catch (error) {
        console.error('[Queue Consumer] Error processing message:', error);
        message.retry();
      }
    }
  },
};

async function sendPushToParty(
  env: Env,
  sessionId: string,
  partyId: string,
  params: {
    title: string;
    body: string;
    kind?: string;
  }
): Promise<boolean> {
  const sub = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE session_id=?1 AND party_id=?2 ORDER BY created_at DESC LIMIT 1'
  )
    .bind(sessionId, partyId)
    .first<{ endpoint: string; p256dh: string; auth: string }>();

  if (!sub) {
    console.log(`[sendPushToParty] No subscription found for party ${partyId}`);
    return false;
  }

  return sendPushNotification(env, {
    sessionId,
    partyId,
    subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    title: params.title,
    body: params.body,
    url: buildAppUrl(env),
    kind: params.kind,
  });
}

async function sendPushNotification(
  env: Env,
  params: {
    sessionId: string;
    partyId: string;
    subscription: { endpoint: string; p256dh: string; auth: string };
    title: string;
    body: string;
    url?: string;
    kind?: string;
    dedupe?: boolean;
  }
): Promise<boolean> {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    return false;
  }

  if (params.kind && params.dedupe !== false) {
    const exists = await env.DB.prepare(
      "SELECT 1 AS x FROM events WHERE session_id=?1 AND party_id=?2 AND type='push_sent' AND json_extract(details, '$.kind') = ?3 LIMIT 1"
    )
      .bind(params.sessionId, params.partyId, params.kind)
      .first<{ x: number }>();
    if (exists?.x) {
      return true;
    }
  }

  try {
    const payload = await buildPushPayload(
      {
        data: JSON.stringify({
          title: params.title,
          body: params.body,
          url: params.url ?? '/',
          kind: params.kind ?? null,
        }),
        options: { ttl: 60 },
      },
      {
        endpoint: params.subscription.endpoint,
        keys: { p256dh: params.subscription.p256dh, auth: params.subscription.auth },
        expirationTime: null,
      },
      {
        subject: env.VAPID_SUBJECT ?? 'mailto:team@queue-up.app',
        publicKey: env.VAPID_PUBLIC,
        privateKey: env.VAPID_PRIVATE,
      }
    );

    const resp = await fetch(params.subscription.endpoint, {
      method: payload.method,
      headers: payload.headers as any,
      body: payload.body as any,
    });

    if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?1')
        .bind(params.subscription.endpoint)
        .run();
      return false;
    }

    if (!resp.ok) {
      console.warn('push delivery failed', resp.status, await resp.text());
      return false;
    }

    if (params.kind) {
      await env.DB.prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'push_sent', ?3)"
      )
        .bind(params.sessionId, params.partyId, JSON.stringify({ kind: params.kind }))
        .run();
    }

    return true;
  } catch (error: any) {
    const status = error?.status ?? error?.code;
    if (status === 404 || status === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?1')
        .bind(params.subscription.endpoint)
        .run()
        .catch(() => {});
    }
    console.warn('sendPushNotification error', error);
    return false;
  }
}

function buildAppUrl(env: Env): string {
  const base =
    env.APP_BASE_URL && env.APP_BASE_URL.trim().length > 0
      ? env.APP_BASE_URL.trim()
      : DEFAULT_APP_BASE_URL;
  try {
    return new URL(base).toString();
  } catch {
    return DEFAULT_APP_BASE_URL;
  }
}

function normalizeTimeString(value: string): string | null {
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  return match ? `${match[1]}:${match[2]}` : null;
}

function timeStringToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  return hours * 60 + minutes;
}

async function handleCreate(
  request: Request,
  env: Env,
  url: URL,
  corsOrigin: string | null
): Promise<Response> {
  const payload = await readJson(request);
  if (!payload || typeof payload !== 'object') {
    return jsonError('Invalid request body', 400);
  }

  const rawEventName = typeof (payload as any).eventName === 'string' ? (payload as any).eventName.trim() : '';
  if (!rawEventName) {
    return jsonError('eventName is required', 400);
  }
  if (rawEventName.length > 120) {
    return jsonError('eventName must be 120 characters or fewer', 400);
  }

  const rawLocation = typeof (payload as any).location === 'string'
    ? (payload as any).location.trim()
    : '';
  const normalizedLocation = rawLocation.length > 0 ? rawLocation.slice(0, MAX_LOCATION_LENGTH) : null;

  const rawContactInfo =
    typeof (payload as any).contactInfo === 'string'
      ? (payload as any).contactInfo.trim()
      : typeof (payload as any).contact === 'string'
        ? (payload as any).contact.trim()
        : '';
  const normalizedContactInfo =
    rawContactInfo.length > 0 ? rawContactInfo.slice(0, MAX_CONTACT_LENGTH) : null;

  const rawOpenTime =
    typeof (payload as any).openTime === 'string'
      ? (payload as any).openTime.trim()
      : '';
  const normalizedOpenTime = rawOpenTime.length > 0 ? normalizeTimeString(rawOpenTime) : null;
  if (rawOpenTime.length > 0 && !normalizedOpenTime) {
    return jsonError('openTime must be in HH:mm format', 400);
  }

  const rawCloseTime =
    typeof (payload as any).closeTime === 'string'
      ? (payload as any).closeTime.trim()
      : '';
  const normalizedCloseTime = rawCloseTime.length > 0 ? normalizeTimeString(rawCloseTime) : null;
  if (rawCloseTime.length > 0 && !normalizedCloseTime) {
    return jsonError('closeTime must be in HH:mm format', 400);
  }

  if (normalizedOpenTime && normalizedCloseTime) {
    const openMinutes = timeStringToMinutes(normalizedOpenTime);
    const closeMinutes = timeStringToMinutes(normalizedCloseTime);
    if (closeMinutes <= openMinutes) {
      return jsonError('closeTime must be after openTime', 400);
    }
  }

  const rawMaxGuests = (payload as any).maxGuests;
  let maxGuests: number | null = null;
  if (typeof rawMaxGuests === 'number') {
    maxGuests = rawMaxGuests;
  } else if (typeof rawMaxGuests === 'string' && rawMaxGuests.trim().length > 0) {
    const parsed = Number.parseInt(rawMaxGuests, 10);
    if (Number.isFinite(parsed)) {
      maxGuests = parsed;
    }
  }

  if (maxGuests === null || !Number.isInteger(maxGuests)) {
    return jsonError('maxGuests must be an integer', 400);
  }
  if (maxGuests < MIN_QUEUE_CAPACITY || maxGuests > MAX_QUEUE_CAPACITY) {
    return jsonError('maxGuests must be between 1 and 100', 400);
  }

  // Turnstile verification
  const turnstileToken = (payload as any).turnstileToken;
  const remoteIp = request.headers.get('CF-Connecting-IP') ?? undefined;
  const turnstileEnabled =
    env.TURNSTILE_BYPASS !== 'true' &&
    env.TURNSTILE_SECRET_KEY &&
    env.TURNSTILE_SECRET_KEY.trim().length > 0;

  console.log('[handleCreate] Turnstile check:', {
    enabled: turnstileEnabled,
    bypass: env.TURNSTILE_BYPASS,
    hasSecret: !!env.TURNSTILE_SECRET_KEY,
    hasToken: !!turnstileToken,
    tokenPreview: turnstileToken?.substring(0, 20),
  });

  if (turnstileEnabled) {
    if (!turnstileToken || typeof turnstileToken !== 'string' || turnstileToken.trim().length === 0) {
      console.warn('[handleCreate] Turnstile token missing!');
      return jsonError('Turnstile verification required', 400, {
        errors: ['missing-input-response'],
      });
    }

    const verification = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, remoteIp);
    console.log('[handleCreate] Turnstile verification result:', verification);
    if (!verification.success) {
      return jsonError('Turnstile verification failed', 400, {
        errors: verification['error-codes'] ?? [],
      });
    }
  }

  const eventName = rawEventName;
  const id = env.QUEUE_DO.newUniqueId();
  const sessionId = id.toString();

  const shortCode = await generateUniqueCode(env);

  const insertResult = await env.DB.prepare(
    "INSERT INTO sessions (id, short_code, status, event_name, max_guests, location, contact_info, open_time, close_time) VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?7, ?8)"
  )
    .bind(
      sessionId,
      shortCode,
      eventName,
      maxGuests,
      normalizedLocation,
      normalizedContactInfo,
      normalizedOpenTime,
      normalizedCloseTime
    )
    .run();

  if (insertResult.error) {
    console.error('Failed to insert session:', insertResult.error);
    return new Response('Failed to create session', { status: 500 });
  }

  await env.QUEUE_KV.put(shortCode, sessionId, { expirationTtl: HOST_COOKIE_MAX_AGE_SECONDS });

  const origin = url.origin;
  const joinUrl = new URL(`/queue/${shortCode}`, origin).toString();
  const wsUrl = new URL(`/api/queue/${shortCode}/connect`, origin).toString();

  const hostCookieValue = await generateHostCookieValue(sessionId, env.HOST_AUTH_SECRET);
  const headers = new Headers({
    'content-type': 'application/json',
  });
  headers.append(
    'set-cookie',
    buildSetCookie(hostCookieValue, HOST_COOKIE_MAX_AGE_SECONDS, corsOrigin ?? origin)
  );

  const body = JSON.stringify({
    code: shortCode,
    sessionId,
    joinUrl,
    wsUrl,
    hostAuthToken: hostCookieValue,
    eventName,
    maxGuests,
    location: normalizedLocation,
    contactInfo: normalizedContactInfo,
    openTime: normalizedOpenTime,
    closeTime: normalizedCloseTime,
  });

  return new Response(body, { status: 200, headers });
}

async function handleConnect(request: Request, env: Env, code: string): Promise<Response> {
  const normalizedCode = code.toUpperCase();
  const sessionId = await resolveSessionId(env, normalizedCode);
  if (!sessionId) {
    return new Response('Session not found', { status: 404 });
  }

  const id = env.QUEUE_DO.idFromString(sessionId);
  const stub = env.QUEUE_DO.get(id);

  const headers = new Headers(request.headers);
  headers.set('x-session-id', sessionId);
  if (headers.has('x-host-auth')) {
    console.log('[worker.handleConnect]', 'forwarding host auth header for session', sessionId);
  }

  const doUrl = new URL(request.url);
  doUrl.pathname = '/connect';

  const init: RequestInit = {
    method: request.method,
    headers,
  };
  const webSocket = (request as any).webSocket;
  if (webSocket) {
    (init as any).webSocket = webSocket;
  }
  if (request.body !== null && request.body !== undefined) {
    init.body = request.body as ReadableStream | null;
  }

  const forwardedRequest = new Request(doUrl.toString(), init);

  return stub.fetch(forwardedRequest);
}

async function handleSnapshot(request: Request, env: Env, code: string): Promise<Response> {
  const normalizedCode = code.toUpperCase();
  const sessionId = await resolveSessionId(env, normalizedCode);
  if (!sessionId) {
    return new Response('Session not found', { status: 404 });
  }

  const id = env.QUEUE_DO.idFromString(sessionId);
  const stub = env.QUEUE_DO.get(id);

  const headers = new Headers(request.headers);
  headers.set('x-session-id', sessionId);

  const doUrl = new URL(request.url);
  doUrl.pathname = '/snapshot';

  const forwardedRequest = new Request(doUrl.toString(), {
    method: 'GET',
    headers,
  });

  return stub.fetch(forwardedRequest);
}

async function handleAction(
  request: Request,
  env: Env,
  code: string,
  action: string
): Promise<Response> {
  const normalizedCode = code.toUpperCase();
  const sessionId = await resolveSessionId(env, normalizedCode);
  if (!sessionId) {
    return new Response('Session not found', { status: 404 });
  }

  switch (action) {
    case 'join':
      return handleJoin(request, env, sessionId);
    case 'declare-nearby':
    case 'leave':
      return handleGuestAction(request, env, sessionId, action);
    case 'advance':
    case 'kick':
    case 'close':
      return handleHostAction(request, env, sessionId, action);
    default:
      return new Response('Not found', { status: 404 });
  }
}

async function handleJoin(request: Request, env: Env, sessionId: string): Promise<Response> {
  const payload = await readJson(request);
  if (!payload) {
    return jsonError('Invalid JSON body', 400);
  }

  const { name, size, turnstileToken } = payload;
  if (name !== undefined && typeof name !== 'string') {
    return jsonError('name must be a string', 400);
  }
  if (size !== undefined && (!Number.isInteger(size) || size <= 0)) {
    return jsonError('size must be a positive integer', 400);
  }

  const remoteIp = request.headers.get('CF-Connecting-IP') ?? undefined;
  const turnstileEnabled =
    env.TURNSTILE_BYPASS !== 'true' &&
    env.TURNSTILE_SECRET_KEY &&
    env.TURNSTILE_SECRET_KEY.trim().length > 0;

  console.log('[handleJoin] Turnstile check:', {
    enabled: turnstileEnabled,
    bypass: env.TURNSTILE_BYPASS,
    hasSecret: !!env.TURNSTILE_SECRET_KEY,
    hasToken: !!turnstileToken,
    tokenPreview: turnstileToken?.substring(0, 20),
  });

  // If Turnstile is enabled, require a valid token
  if (turnstileEnabled) {
    if (!turnstileToken || typeof turnstileToken !== 'string' || turnstileToken.trim().length === 0) {
      console.warn('[handleJoin] Turnstile token missing!');
      return jsonError('Turnstile verification required', 400, {
        errors: ['missing-input-response'],
      });
    }

    const verification = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, remoteIp);
    console.log('[handleJoin] Turnstile verification result:', verification);
    if (!verification.success) {
      return jsonError('Turnstile verification failed', 400, {
        errors: verification['error-codes'] ?? [],
      });
    }
  }

  const body = {
    name,
    size,
  };
  return proxyJsonToQueueDO(env, sessionId, 'join', body, request.headers);
}

async function handleGuestAction(
  request: Request,
  env: Env,
  sessionId: string,
  action: 'declare-nearby' | 'leave'
): Promise<Response> {
  const payload = await readJson(request);
  if (!payload) {
    return jsonError('Invalid JSON body', 400);
  }

  const { partyId } = payload;
  if (typeof partyId !== 'string' || !partyId) {
    return jsonError('partyId is required', 400);
  }

  return proxyJsonToQueueDO(env, sessionId, action, { partyId }, request.headers);
}

async function handleHostAction(
  request: Request,
  env: Env,
  sessionId: string,
  action: 'advance' | 'kick' | 'close'
): Promise<Response> {
  const hostCookie = await requireHostAuth(request, sessionId, env);
  if (hostCookie instanceof Response) {
    return hostCookie;
  }

  let payload: any = {};
  if (action !== 'close') {
    const data = await readJson(request);
    payload = typeof data === 'object' && data !== null ? data : {};
  }

  let body: Record<string, unknown> = {};
  switch (action) {
    case 'advance': {
      const { servedParty, nextParty } = payload as {
        servedParty?: string;
        nextParty?: string;
      };
      if (servedParty !== undefined && typeof servedParty !== 'string') {
        return jsonError('servedParty must be a string', 400);
      }
      if (nextParty !== undefined && typeof nextParty !== 'string') {
        return jsonError('nextParty must be a string', 400);
      }
      body = { servedParty, nextParty };
      break;
    }
    case 'kick': {
      const { partyId } = payload as { partyId?: string };
      if (typeof partyId !== 'string' || !partyId) {
        return jsonError('partyId is required', 400);
      }
      body = { partyId };
      break;
    }
    case 'close': {
      body = {};
      break;
    }
  }

  return proxyJsonToQueueDO(env, sessionId, action, body, request.headers, hostCookie);
}

async function proxyJsonToQueueDO(
  env: Env,
  sessionId: string,
  action: string,
  body: Record<string, unknown>,
  originalHeaders: Headers,
  hostCookieValue?: string
): Promise<Response> {
  const id = env.QUEUE_DO.idFromString(sessionId);
  const stub = env.QUEUE_DO.get(id);

  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-session-id', sessionId);

  const ip = originalHeaders.get('CF-Connecting-IP');
  if (ip) {
    headers.set('cf-connecting-ip', ip);
  }

  if (hostCookieValue) {
    headers.set('x-host-auth', hostCookieValue);
  }

  const requestBody = JSON.stringify(body);
  const doRequest = new Request(`https://queue-do/${action}`, {
    method: 'POST',
    headers,
    body: requestBody,
  });

  return stub.fetch(doRequest);
}

async function generateUniqueCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomCode(SHORT_CODE_LENGTH);
    const existing = await env.QUEUE_KV.get(code);
    if (!existing) {
      return code;
    }
  }
  throw new Error('Unable to generate unique short code');
}

function randomCode(length: number): string {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  let result = '';
  for (let i = 0; i < buffer.length; i += 1) {
    const index = buffer[i] % SHORT_CODE_ALPHABET.length;
    result += SHORT_CODE_ALPHABET[index];
  }
  return result;
}

async function resolveSessionId(env: Env, code: string): Promise<string | undefined> {
  const normalizedCode = code.toUpperCase();
  let sessionId = await env.QUEUE_KV.get(normalizedCode);
  if (sessionId) {
    return sessionId;
  }

  const row = await env.DB.prepare('SELECT id FROM sessions WHERE short_code = ?1 LIMIT 1')
    .bind(normalizedCode)
    .first<{ id: string }>();

  if (row?.id) {
    sessionId = row.id;
    await env.QUEUE_KV.put(normalizedCode, sessionId, {
      expirationTtl: HOST_COOKIE_MAX_AGE_SECONDS,
    });
    return sessionId;
  }

  return undefined;
}

async function readJson(request: Request): Promise<any | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>): Response {
  const payload = JSON.stringify({ error: message, ...extra });
  return new Response(payload, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function applyCors(
  response: Response,
  origin: string | null,
  exposeHeaders?: string[],
  isPreflight?: boolean
): Response {
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Credentials', 'true');
  if (exposeHeaders && exposeHeaders.length > 0) {
    headers.set('Access-Control-Expose-Headers', exposeHeaders.join(', '));
  }
  if (isPreflight) {
    headers.set(
      'Access-Control-Allow-Headers',
      'content-type, cf-connecting-ip, authorization, x-host-auth, if-none-match'
    );
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Max-Age', '600');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function resolveAllowedOrigin(request: Request, url: URL, env: Env): string | null | Response {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return url.origin;
  }

  if (origin === url.origin) {
    return origin;
  }

  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowed.includes(origin)) {
    return origin;
  }

  return new Response('Origin not allowed', { status: 403 });
}

async function verifyTurnstile(
  secret: string,
  token: string,
  remoteip?: string
): Promise<TurnstileVerifyResponse> {
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (remoteip) {
    form.append('remoteip', remoteip);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    console.error('Turnstile verify failed with status', response.status);
    return { success: false, 'error-codes': ['request_failed'] };
  }

  const data = (await response.json()) as TurnstileVerifyResponse;
  return data;
}

async function requireHostAuth(
  request: Request,
  sessionId: string,
  env: Env
): Promise<string | Response> {
  const headerToken = request.headers.get('x-host-auth');
  if (headerToken) {
    const headerValid = await verifyHostCookie(headerToken, sessionId, env.HOST_AUTH_SECRET);
    if (headerValid) {
      return headerToken;
    }
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const cookieValue = cookies.get(HOST_COOKIE_NAME);
  if (!cookieValue) {
    if (headerToken) {
      return jsonError('Invalid host authentication', 403);
    }
    return jsonError('Host authentication required', 401);
  }

  const valid = await verifyHostCookie(cookieValue, sessionId, env.HOST_AUTH_SECRET);
  if (!valid) {
    return jsonError('Invalid host authentication', 403);
  }

  return cookieValue;
}

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) {
    return map;
  }
  const pairs = header.split(';');
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    map.set(name, value);
  }
  return map;
}

function buildSetCookie(value: string, maxAge: number, origin: string): string {
  const url = new URL(origin);
  const attributes = [
    `${HOST_COOKIE_NAME}=${value}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
  ];
  const domain = url.hostname;
  if (!isIpAddress(domain) && domain.includes('.')) {
    attributes.push(`Domain=${domain}`);
  }
  return attributes.join('; ');
}

function isIpAddress(hostname: string): boolean {
  return /^[\d.]+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
}

interface TurnstileVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  action?: string;
  cdata?: string;
}
