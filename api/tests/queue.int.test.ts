import { describe, expect, it } from 'vitest';
import { env, SELF, runDurableObjectAlarm } from 'cloudflare:test';

interface QueueUpdateMessage {
  type: 'queue_update';
  queue: {
    id: string;
    name?: string;
    size?: number;
    status: string;
    nearby: boolean;
  }[];
  nowServing: null | {
    id: string;
    status: string;
  };
  maxGuests?: number;
}

interface PositionMessage {
  type: 'position';
  position: number;
  aheadCount: number;
}

type GuestMessage =
  | PositionMessage
  | { type: 'called' }
  | { type: 'removed'; reason: string }
  | { type: 'closed' };

async function connectWebSocket(
  path: string,
  initHeaders?: HeadersInit
): Promise<{ socket: WebSocket; waitForMessage: <T = unknown>() => Promise<T> }> {
  const url = new URL(path, 'https://example.com');
  const response = await SELF.fetch(url, {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      ...initHeaders,
    },
  });
  if (response.status !== 101) {
    throw new Error(`WebSocket upgrade failed with ${response.status}`);
  }
  const socket = response.webSocket;
  if (!socket) {
    throw new Error('No WebSocket on response');
  }
  socket.accept();

  const queue: unknown[] = [];
  const resolvers: ((value: unknown) => void)[] = [];

  socket.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (resolvers.length > 0) {
      const resolve = resolvers.shift()!;
      resolve(data);
    } else {
      queue.push(data);
    }
  });

  const waitForMessage = <T = unknown>(): Promise<T> =>
    new Promise((resolve) => {
      if (queue.length > 0) {
        const value = queue.shift();
        resolve(value as T);
      } else {
        resolvers.push((value) => resolve(value as T));
      }
    });

  return { socket, waitForMessage };
}

async function fetchJson(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, 'https://example.com');
  return SELF.fetch(url, init);
}

describe('queue lifecycle integration', () => {
  it('supports create, join, real-time updates, alarms, and close flows', async () => {
    const desiredEventName = 'Integration Test Event';
    const desiredMaxGuests = 2;
    const createResponse = await fetchJson('/api/queue/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventName: desiredEventName, maxGuests: desiredMaxGuests }),
    });
    expect(createResponse.status).toBe(200);
    const createBody = await createResponse.json<{
      code: string;
      sessionId: string;
      joinUrl: string;
      wsUrl: string;
      eventName: string;
      maxGuests: number;
    }>();
    expect(createBody.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(createBody.sessionId).toBeTruthy();
    expect(createBody.eventName).toBe(desiredEventName);
    expect(createBody.maxGuests).toBe(desiredMaxGuests);
    const sessionId = createBody.sessionId;
    const shortCode = createBody.code;

    const setCookie = createResponse.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const hostCookie = setCookie!.split(';')[0];

    // Host websocket connection receives initial snapshot.
    const hostWs = await connectWebSocket(`/api/queue/${shortCode}/connect`, {
      Cookie: hostCookie,
    });

    const hostInitial = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(hostInitial.type).toBe('queue_update');
    expect(hostInitial.queue.length).toBe(0);
  expect(hostInitial.maxGuests).toBe(desiredMaxGuests);

    // Guest joins queue.
    const joinResponse = await fetchJson(`/api/queue/${shortCode}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', size: 2, turnstileToken: 'stub-token' }),
    });
    expect(joinResponse.status).toBe(200);
    const joinBody = await joinResponse.json<{ partyId: string; position: number }>();
    expect(joinBody.position).toBe(1);
    const partyId = joinBody.partyId;

    const hostAfterJoin = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(hostAfterJoin.queue.length).toBe(1);
    expect(hostAfterJoin.queue[0].id).toBe(partyId);
    expect(hostAfterJoin.queue[0].status).toBe('waiting');
    expect(hostAfterJoin.maxGuests).toBe(desiredMaxGuests);

    // Additional guest should not be able to join while capacity is full.
    const overCapacityResponse = await fetchJson(`/api/queue/${shortCode}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Overflow', size: 1, turnstileToken: 'stub-token' }),
    });
    expect(overCapacityResponse.status).toBe(409);

    // Guest websocket connection receives position updates.
    const guestWs = await connectWebSocket(`/api/queue/${shortCode}/connect?partyId=${partyId}`);

    const guestInitial = await guestWs.waitForMessage<GuestMessage>();
    expect(guestInitial.type).toBe('position');
    if (guestInitial.type === 'position') {
      expect(guestInitial.position).toBe(1);
    }

    // Guest declares nearby.
    const nearbyResponse = await fetchJson(`/api/queue/${shortCode}/declare-nearby`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partyId }),
    });
    expect(nearbyResponse.status).toBe(200);
    const hostAfterNearby = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(hostAfterNearby.queue[0].nearby).toBe(true);
  expect(hostAfterNearby.maxGuests).toBe(desiredMaxGuests);

    // Host advances queue.
    const advanceResponse = await fetchJson(`/api/queue/${shortCode}/advance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: hostCookie,
      },
      body: JSON.stringify({}),
    });
    expect(advanceResponse.status).toBe(200);
    const advanceBody = await advanceResponse.json<{ nowServing: { id: string } | null }>();
    expect(advanceBody.nowServing?.id).toBe(partyId);

    const hostAfterAdvance = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(hostAfterAdvance.nowServing?.id).toBe(partyId);
  expect(hostAfterAdvance.maxGuests).toBe(desiredMaxGuests);

    const guestCalled = await guestWs.waitForMessage<GuestMessage>();
    expect(guestCalled.type).toBe('called');

    // Alarm should mark the party as no_show and auto-advance.
    const durableId = env.QUEUE_DO.idFromString(sessionId);
    const stub = env.QUEUE_DO.get(durableId);
    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(true);

    const hostAfterAlarm = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(hostAfterAlarm.nowServing).toBeNull();
  expect(hostAfterAlarm.maxGuests).toBe(desiredMaxGuests);

    const guestRemoved = await guestWs.waitForMessage<GuestMessage>();
    expect(guestRemoved).toEqual({ type: 'removed', reason: 'no_show' });

    // Join a second party to exercise kick + leave flows.
    const secondJoinResponse = await fetchJson(`/api/queue/${shortCode}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', size: 1, turnstileToken: 'stub-token' }),
    });
    const { partyId: secondParty } = await secondJoinResponse.json<{ partyId: string }>();
    await hostWs.waitForMessage<QueueUpdateMessage>(); // queue update with second party

    // Kick the second party.
    const kickResponse = await fetchJson(`/api/queue/${shortCode}/kick`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: hostCookie,
      },
      body: JSON.stringify({ partyId: secondParty }),
    });
    expect(kickResponse.status).toBe(200);
    const hostAfterKick = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(hostAfterKick.queue.length).toBe(0);

    // Close the session.
    const closeResponse = await fetchJson(`/api/queue/${shortCode}/close`, {
      method: 'POST',
      headers: {
        Cookie: hostCookie,
      },
    });
    expect(closeResponse.status).toBe(200);

    const postCloseUpdate = await hostWs.waitForMessage<QueueUpdateMessage>();
    expect(postCloseUpdate.nowServing).toBeNull();

    const closedMessage = await hostWs.waitForMessage<GuestMessage>();
    expect(closedMessage).toEqual({ type: 'closed' });

    const eventRow = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM events WHERE session_id = ?1'
    )
      .bind(sessionId)
      .first();
    const totalEvents = (eventRow as { count: number } | null)?.count ?? 0;
    expect(totalEvents >= 4).toBe(true);

    const sessionRow = await env.DB.prepare('SELECT event_name FROM sessions WHERE id = ?1')
      .bind(sessionId)
      .first<{ event_name: string | null }>();
    expect(sessionRow?.event_name).toBe(desiredEventName);

    const capacityRow = await env.DB.prepare('SELECT max_guests FROM sessions WHERE id = ?1')
      .bind(sessionId)
      .first<{ max_guests: number | null }>();
    expect(capacityRow?.max_guests).toBe(desiredMaxGuests);

    hostWs.socket.close(1000, 'done');
    guestWs.socket.close(1000, 'done');
  }, 20000);
});
