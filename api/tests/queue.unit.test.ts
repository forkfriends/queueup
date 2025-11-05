import { describe, expect, it } from 'vitest';
import { generateHostCookieValue, verifyHostCookie } from '../utils/auth';

describe('host auth helpers', () => {
  const secret = 'unit-test-secret';
  const sessionId = '1234567890abcdef';

  it('generates cookies that validate', async () => {
    const cookie = await generateHostCookieValue(sessionId, secret);
    expect(cookie.startsWith(`${sessionId}.`)).toBe(true);

    const ok = await verifyHostCookie(cookie, sessionId, secret);
    expect(ok).toBe(true);
  });

  it('fails when cookie signature changes', async () => {
    await generateHostCookieValue(sessionId, secret);
    const tampered = `${sessionId}.invalidsignature`;
    const ok = await verifyHostCookie(tampered, sessionId, secret);
    expect(ok).toBe(false);
  });

  it('fails when session id mismatches', async () => {
    const cookie = await generateHostCookieValue(sessionId, secret);
    const ok = await verifyHostCookie(cookie, 'other-session', secret);
    expect(ok).toBe(false);
  });
});
