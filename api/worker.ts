import {
  HOST_COOKIE_MAX_AGE_SECONDS,
  HOST_COOKIE_NAME,
  generateHostCookieValue,
  verifyHostCookie,
} from './utils/auth';
export { QueueDO } from './queue-do';

export interface Env {
  QUEUE_DO: DurableObjectNamespace;
  QUEUE_KV: KVNamespace;
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HOST_AUTH_SECRET: string;
  ALLOWED_ORIGINS?: string;
  TURNSTILE_BYPASS?: string;
  TEST_MODE?: string;
}

const ROUTE =
  /^\/api\/queue(?:\/(create|[A-Za-z0-9]{6})(?:\/(join|declare-nearby|leave|advance|kick|close|connect))?)?$/;
const SHORT_CODE_LENGTH = 6;
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const originResult = resolveAllowedOrigin(request, url, env);
    if (originResult instanceof Response) {
      return originResult;
    }
    const corsOrigin = originResult;

    if (request.method === 'OPTIONS') {
      return applyCors(new Response(null, { status: 204 }), corsOrigin, undefined, true);
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
};

async function handleCreate(
  request: Request,
  env: Env,
  url: URL,
  corsOrigin: string | null
): Promise<Response> {
  const id = env.QUEUE_DO.newUniqueId();
  const sessionId = id.toString();

  const shortCode = await generateUniqueCode(env);

  const insertResult = await env.DB.prepare(
    "INSERT INTO sessions (id, short_code, status) VALUES (?1, ?2, 'active')"
  )
    .bind(sessionId, shortCode)
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
  const shouldVerify =
    env.TURNSTILE_BYPASS !== 'true' &&
    env.TURNSTILE_SECRET_KEY &&
    env.TURNSTILE_SECRET_KEY.trim().length > 0 &&
    typeof turnstileToken === 'string' &&
    turnstileToken.length > 0;

  if (shouldVerify) {
    const verification = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, remoteIp);
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
    headers.set('Access-Control-Allow-Headers', 'content-type, cf-connecting-ip, authorization');
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
  const cookies = parseCookies(request.headers.get('Cookie'));
  const cookieValue = cookies.get(HOST_COOKIE_NAME);
  if (!cookieValue) {
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
