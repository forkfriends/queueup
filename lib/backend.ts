import { Platform } from 'react-native';

const DEFAULT_LOCALHOST = Platform.select({
  ios: 'http://127.0.0.1:8787',
  android: 'http://10.0.2.2:8787',
  default: 'http://localhost:8787',
});

const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_LOCALHOST)?.replace(/\/$/, '') ?? '';

export interface CreateQueueResult {
  code: string;
  sessionId: string;
  joinUrl: string;
  wsUrl: string;
  hostAuthCookie?: string;
}

export async function createQueue(): Promise<CreateQueueResult> {
  const response = await fetch(`${API_BASE_URL}/api/queue/create`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  const data = (await response.json()) as CreateQueueResult;
  const hostAuthCookie = response.headers.get('set-cookie') ?? undefined;
  return { ...data, hostAuthCookie };
}

export interface JoinQueueParams {
  code: string;
  name?: string;
  size?: number;
  turnstileToken?: string;
}

export interface JoinQueueResult {
  partyId: string;
  position: number;
}

export async function joinQueue({
  code,
  name,
  size,
  turnstileToken,
}: JoinQueueParams): Promise<JoinQueueResult> {
  const payload = {
    name: name?.trim() || undefined,
    size: size && Number.isFinite(size) ? size : undefined,
    turnstileToken: turnstileToken ?? '1x0000000000000000000000000000000AA',
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
