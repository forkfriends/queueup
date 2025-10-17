import { Platform } from 'react-native';

const DEFAULT_LOCALHOST = Platform.select({
  ios: 'http://127.0.0.1:8787',
  android: 'http://10.0.2.2:8787',
  default: 'http://localhost:8787',
});

const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const apiBaseUrlWithDefault = rawApiBaseUrl ?? DEFAULT_LOCALHOST;
const apiBaseUrlSanitized = apiBaseUrlWithDefault ? apiBaseUrlWithDefault.replace(/\/$/, '') : '';
const API_BASE_URL = apiBaseUrlSanitized ?? '';

export interface CreateQueueResult {
  code: string;
  sessionId: string;
  joinUrl: string;
  wsUrl: string;
  hostAuthToken?: string;
  eventName?: string;
  maxGuests: number;
}

export interface CreateQueueParams {
  eventName: string;
  maxGuests: number;
}

export const HOST_COOKIE_NAME = 'queue_host_auth';
const WEBSOCKET_PROTOCOL_HTTP = /^http:/i;
const WEBSOCKET_PROTOCOL_HTTPS = /^https:/i;

function extractHostToken(setCookieHeader: string | null): string | undefined {
  if (!setCookieHeader) {
    return undefined;
  }

  // React Native fetch collapses multiple Set-Cookie headers into a comma-separated string.
  const maybeCookies = setCookieHeader.split(',');
  for (const maybeCookie of maybeCookies) {
    const cookie = maybeCookie.trim();
    if (!cookie.startsWith(`${HOST_COOKIE_NAME}=`)) {
      continue;
    }
    const firstPart = cookie.split(';', 1)[0];
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const value = firstPart.slice(eqIndex + 1);
    if (value) {
      return value;
    }
  }

  return undefined;
}

const MIN_QUEUE_CAPACITY = 1;
const MAX_QUEUE_CAPACITY = 100;

export async function createQueue({ eventName, maxGuests }: CreateQueueParams): Promise<CreateQueueResult> {
  const trimmedEventName = eventName.trim();
  const normalizedMaxGuests = Number.isFinite(maxGuests)
    ? Math.min(MAX_QUEUE_CAPACITY, Math.max(MIN_QUEUE_CAPACITY, Math.round(maxGuests)))
    : MAX_QUEUE_CAPACITY;
  const body = {
    eventName: trimmedEventName,
    maxGuests: normalizedMaxGuests,
  };
  const response = await fetch(`${API_BASE_URL}/api/queue/create`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  const data = (await response.json()) as CreateQueueResult;
  const hostAuthToken = data.hostAuthToken ?? extractHostToken(response.headers.get('set-cookie'));
  return { ...data, hostAuthToken };
}

export interface JoinQueueParams {
  code: string;
  name?: string;
  size?: number;
}

export interface JoinQueueResult {
  partyId: string;
  position: number;
}

export async function joinQueue({ code, name, size }: JoinQueueParams): Promise<JoinQueueResult> {
  const payload = {
    name: name?.trim() || undefined,
    size: size && Number.isFinite(size) ? size : undefined,
  };

  const response = await fetch(`${API_BASE_URL}/api/queue/${code.toUpperCase()}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  return (await response.json()) as JoinQueueResult;
}

function toWebSocketUrl(url: string): string {
  if (WEBSOCKET_PROTOCOL_HTTPS.test(url)) {
    return url.replace(WEBSOCKET_PROTOCOL_HTTPS, 'wss:');
  }
  if (WEBSOCKET_PROTOCOL_HTTP.test(url)) {
    return url.replace(WEBSOCKET_PROTOCOL_HTTP, 'ws:');
  }
  return url;
}

export function buildHostConnectUrl(wsUrl: string, hostAuthToken?: string): string {
  if (!hostAuthToken) {
    return toWebSocketUrl(wsUrl);
  }
  try {
    const parsed = new URL(wsUrl);
    parsed.searchParams.set('hostToken', hostAuthToken);
    return toWebSocketUrl(parsed.toString());
  } catch {
    const separator = wsUrl.includes('?') ? '&' : '?';
    return toWebSocketUrl(`${wsUrl}${separator}hostToken=${encodeURIComponent(hostAuthToken)}`);
  }
}

export function buildGuestConnectUrl(code: string, partyId: string): string {
  const normalizedCode = code.toUpperCase();
  const base = `${API_BASE_URL || DEFAULT_LOCALHOST}/api/queue/${normalizedCode}/connect`;
  try {
    const parsed = new URL(base);
    parsed.searchParams.set('partyId', partyId);
    return toWebSocketUrl(parsed.toString());
  } catch {
    const separator = base.includes('?') ? '&' : '?';
    return toWebSocketUrl(`${base}${separator}partyId=${encodeURIComponent(partyId)}`);
  }
}

export interface AdvanceQueueParams {
  code: string;
  hostAuthToken: string;
  servedPartyId?: string;
  nextPartyId?: string;
}

export interface HostParty {
  id: string;
  name?: string;
  size?: number;
  status: 'waiting' | 'called';
  nearby: boolean;
  joinedAt: number;
}

export interface AdvanceQueueResult {
  nowServing: HostParty | null;
}

export async function advanceQueueHost({
  code,
  hostAuthToken,
  servedPartyId,
  nextPartyId,
}: AdvanceQueueParams): Promise<AdvanceQueueResult> {
  const payload = {
    servedParty: servedPartyId,
    nextParty: nextPartyId,
  };

  const response = await fetch(`${API_BASE_URL}/api/queue/${code.toUpperCase()}/advance`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-host-auth': hostAuthToken,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  return (await response.json()) as AdvanceQueueResult;
}

export interface CloseQueueParams {
  code: string;
  hostAuthToken: string;
}

export async function closeQueueHost({ code, hostAuthToken }: CloseQueueParams): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/queue/${code.toUpperCase()}/close`, {
    method: 'POST',
    headers: {
      'x-host-auth': hostAuthToken,
    },
  });

  if (!response.ok) {
    throw await buildError(response);
  }
}

async function buildError(response: Response): Promise<Error> {
  try {
    const data = await response.json();
    const message = typeof data?.error === 'string' ? data.error : JSON.stringify(data);
    return new Error(message || `Request failed with status ${response.status}`);
  } catch {
    const text = await response.text();
    return new Error(text || `Request failed with status ${response.status}`);
  }
}
