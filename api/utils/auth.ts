const textEncoder = new TextEncoder();

export const HOST_COOKIE_NAME = 'queue_host_auth';
export const HOST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function generateHostCookieValue(sessionId: string, secret: string): Promise<string> {
  const signature = await signHostToken(sessionId, secret);
  return `${sessionId}.${signature}`;
}

export async function verifyHostCookie(
  cookieValue: string,
  sessionId: string,
  secret: string
): Promise<boolean> {
  const [cookieSessionId, signature] = cookieValue.split('.');
  if (!cookieSessionId || !signature) {
    return false;
  }
  if (cookieSessionId !== sessionId) {
    return false;
  }

  const expected = await signHostToken(sessionId, secret);
  return timingSafeEqual(signature, expected);
}

async function signHostToken(sessionId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(sessionId));
  return toBase64Url(signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
