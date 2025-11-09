import type { Env } from './worker';
import { HOST_COOKIE_NAME, verifyHostCookie } from './utils/auth';
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { logAnalyticsEvent } from './analytics';

type QueueStatus = 'waiting' | 'called';
type PartyRemovalReason = 'served' | 'left' | 'kicked' | 'no_show' | 'closed';

interface QueueParty {
  id: string;
  name?: string;
  size?: number;
  status: QueueStatus;
  nearby: boolean;
  joinedAt: number;
}

interface StoredState {
  queue: QueueParty[];
  nowServing: QueueParty | null;
  closed?: boolean;
  pendingPartyId?: string | null;
  maxGuests?: number;
  callDeadline?: number | null;
}

type ConnectionInfo = { role: 'host' } | { role: 'guest'; partyId: string };

const CALL_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_GUESTS = 100;
const AVERAGE_SERVICE_MINUTES = 3;
const MS_PER_MINUTE = 60 * 1000;

function logPrefix(sessionId: string, scope: string): string {
  return `[QueueDO ${sessionId}] ${scope}:`;
}

export class QueueDO implements DurableObject {
  private readonly sessionId: string;
  private queue: QueueParty[] = [];
  private nowServing: QueueParty | null = null;
  private pendingPartyId: string | null = null;
  private closed = false;
  private maxGuests = DEFAULT_MAX_GUESTS;
  private callDeadline: number | null = null;
  private createdAt: number;
  private lastActivityAt: number;

  private sockets = new Map<WebSocket, ConnectionInfo>();
  private guestSockets = new Map<string, Set<WebSocket>>();

  // Push notification batching state
  private pendingPushes = new Map<string, 'called' | 'pos_2' | 'pos_5'>();
  private pushAlarmScheduled = false;

  // Cost optimization settings
  private static readonly INACTIVE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
  private static readonly MAX_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours
  private static readonly HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
  private heartbeatTimer: number | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.sessionId = state.id.toString();
    const now = Date.now();
    this.createdAt = now;
    this.lastActivityAt = now;
    this.state.blockConcurrencyWhile(async () => {
      await this.restoreState();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket' && url.pathname === '/connect') {
      console.log(logPrefix(this.sessionId, 'fetch'), 'websocket connect request received');
      return this.handleWebSocket(request, url);
    }

    // GET /snapshot - read current state from KV (for polling clients)
    if (request.method === 'GET' && url.pathname === '/snapshot') {
      return this.handleSnapshot(request);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    switch (url.pathname) {
      case '/join':
        return this.handleJoin(request);
      case '/declare-nearby':
        return this.handleDeclareNearby(request);
      case '/leave':
        return this.handleLeave(request);
      case '/advance':
        return this.handleAdvance(request);
      case '/kick':
        return this.handleKick(request);
      case '/close':
        return this.handleClose(request);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();

    // Check for queue expiration (cost optimization)
    if (!this.closed) {
      const lifetime = now - this.createdAt;
      const inactiveDuration = now - this.lastActivityAt;

      // Force close if exceeded max lifetime
      if (lifetime > QueueDO.MAX_LIFETIME_MS) {
        console.log(`[QueueDO ${this.sessionId}] Auto-closing: exceeded max lifetime (${Math.round(lifetime / 3600000)}h)`);
        await this.handleAutoClose('max_lifetime_exceeded');
        return;
      }

      // Auto-close if inactive for too long AND queue is empty
      if (inactiveDuration > QueueDO.INACTIVE_TIMEOUT_MS && this.queue.length === 0 && !this.nowServing) {
        console.log(`[QueueDO ${this.sessionId}] Auto-closing: inactive for ${Math.round(inactiveDuration / 60000)} minutes`);
        await this.handleAutoClose('inactivity');
        return;
      }
    }

    // Handle no-show timeout if needed
    if (this.pendingPartyId && this.nowServing && this.nowServing.id === this.pendingPartyId) {
      const timeElapsed = now - (this.callDeadline ?? 0);
      const deadlineReached = timeElapsed >= 0 || this.env.TEST_MODE === 'true';
      // Only mark as no-show if call timeout has elapsed, unless running in test mode
      if (deadlineReached) {
        await this.markPartyAsNoShow(this.nowServing.id);
        await this.callNextParty();
      }
    }

    // Process batched push notifications
    await this.processPendingPushes();

    // Schedule next alarm for lifecycle checks if not closed
    if (!this.closed) {
      await this.scheduleLifecycleAlarm();
    }
  }

  private async handleJoin(request: Request): Promise<Response> {
    this.trackActivity(); // Cost optimization: track activity

    if (this.closed) {
      return this.jsonError('Session closed', 409);
    }

    const payload = await this.readJson(request);
    if (!payload) {
      return this.jsonError('Invalid JSON body', 400);
    }

    const { name, size } = payload;
    if (name !== undefined && typeof name !== 'string') {
      return this.jsonError('name must be a string', 400);
    }
    if (size !== undefined && (!Number.isInteger(size) || size <= 0)) {
      return this.jsonError('size must be a positive integer', 400);
    }

    const normalizedSize = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 1;
    const totalGuests = this.computeGuestCount();
    if (totalGuests + normalizedSize > this.maxGuests) {
      return this.jsonError('Queue is full', 409);
    }

    const party: QueueParty = {
      id: crypto.randomUUID(),
      name,
      size: normalizedSize,
      status: 'waiting',
      nearby: false,
      joinedAt: Date.now(),
    };

    this.queue.push(party);

    const statements = [
      this.env.DB.prepare(
        "INSERT INTO parties (id, session_id, name, size, status, nearby) VALUES (?1, ?2, ?3, ?4, 'waiting', 0)"
      ).bind(party.id, this.sessionId, name ?? null, normalizedSize),
      this.env.DB.prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'joined', ?3)"
      ).bind(
        this.sessionId,
        party.id,
        JSON.stringify({ name: party.name ?? null, size: party.size ?? null })
      ),
    ];

    const results = await this.env.DB.batch(statements);
    const errorResult = results.find((result) => result.error);
    if (errorResult) {
      this.queue.pop();
      console.error('Failed to persist join:', errorResult.error);
      return this.jsonError('Failed to join queue', 500);
    }

    await this.persistState();
    await this.publishState();

    // Emit event for background processing
    await this.emitEvent({
      type: 'QUEUE_MEMBER_JOINED',
      sessionId: this.sessionId,
      partyId: party.id,
      position: this.queue.length,
      queueLength: this.queue.length,
    });

    this.broadcastGuestPositions();
    await this.triggerPositionPushes();

    const aheadWaiting = this.queue.length - 1;
    const aheadCount = aheadWaiting + (this.nowServing ? 1 : 0);
    const position = aheadCount + 1;
    const queueLength = this.computeQueueLength();
    const estimatedWaitMs = this.estimateWaitMs(aheadCount);

    return this.jsonResponse({
      partyId: party.id,
      position,
      sessionId: this.sessionId,
      queueLength,
      estimatedWaitMs,
    });
  }

  private async handleDeclareNearby(request: Request): Promise<Response> {
    this.trackActivity(); // Cost optimization: track activity
    const payload = await this.readJson(request);
    if (!payload) {
      return this.jsonError('Invalid JSON body', 400);
    }
    const { partyId } = payload;
    if (typeof partyId !== 'string' || !partyId) {
      return this.jsonError('partyId is required', 400);
    }

    const party = this.findParty(partyId);
    if (!party) {
      return this.jsonError('Party not found', 404);
    }

    if (!party.nearby) {
      party.nearby = true;
      await this.env.DB.prepare('UPDATE parties SET nearby = 1 WHERE id = ?1').bind(partyId).run();
      await logAnalyticsEvent({
        db: this.env.DB,
        sessionId: this.sessionId,
        partyId,
        type: 'nudge_ack',
        details: { source: 'declare_nearby' },
      });
      await this.persistState();
      await this.publishState();
    }

    return this.jsonResponse({ ok: true });
  }

  private async handleLeave(request: Request): Promise<Response> {
    this.trackActivity(); // Cost optimization: track activity
    const payload = await this.readJson(request);
    if (!payload) {
      return this.jsonError('Invalid JSON body', 400);
    }
    const { partyId } = payload;
    if (typeof partyId !== 'string' || !partyId) {
      return this.jsonError('partyId is required', 400);
    }

    const removed = await this.removeParty(partyId, 'left');
    if (!removed) {
      return this.jsonError('Party not found', 404);
    }

    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE parties SET status = 'left' WHERE id = ?1").bind(partyId),
      this.env.DB.prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'left', ?3)"
      ).bind(this.sessionId, partyId, JSON.stringify({ reason: 'guest_left' })),
    ]);

    return this.jsonResponse({ ok: true });
  }

  private async handleKick(request: Request): Promise<Response> {
    const hostVerified = await this.verifyHostRequest(request);
    if (hostVerified instanceof Response) {
      return hostVerified;
    }

    const payload = await this.readJson(request);
    if (!payload) {
      return this.jsonError('Invalid JSON body', 400);
    }

    const { partyId } = payload;
    if (typeof partyId !== 'string' || !partyId) {
      return this.jsonError('partyId is required', 400);
    }

    const removed = await this.removeParty(partyId, 'kicked');
    if (!removed) {
      return this.jsonError('Party not found', 404);
    }

    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE parties SET status = 'left' WHERE id = ?1").bind(partyId),
      this.env.DB.prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'left', ?3)"
      ).bind(this.sessionId, partyId, JSON.stringify({ reason: 'kicked' })),
    ]);

    return this.jsonResponse({ ok: true });
  }

  private async handleAdvance(request: Request): Promise<Response> {
    this.trackActivity(); // Cost optimization: track activity

    const hostVerified = await this.verifyHostRequest(request);
    if (hostVerified instanceof Response) {
      return hostVerified;
    }

    const payload = await this.readJson(request);
    const servedParty = payload?.servedParty as string | undefined;
    const nextParty = payload?.nextParty as string | undefined;

    const result = await this.advanceQueue(servedParty, nextParty);
    if (result instanceof Response) {
      return result;
    }

    await this.triggerPositionPushes();
    return this.jsonResponse(result);
  }

  private async handleClose(request: Request): Promise<Response> {
    const hostVerified = await this.verifyHostRequest(request);
    if (hostVerified instanceof Response) {
      return hostVerified;
    }

    if (this.closed) {
      return this.jsonResponse({ ok: true });
    }

    this.closed = true;
    this.queue = [];
    this.nowServing = null;
    this.pendingPartyId = null;
    this.callDeadline = null;

    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE sessions SET status = 'closed' WHERE id = ?1").bind(
        this.sessionId
      ),
      this.env.DB.prepare(
        "INSERT INTO events (session_id, type, details) VALUES (?1, 'close', NULL)"
      ).bind(this.sessionId),
    ]);

    await this.state.storage.deleteAlarm();
    await this.persistState();

    await this.publishState();

    // Emit event for queue closed
    await this.emitEvent({
      type: 'QUEUE_CLOSED',
      sessionId: this.sessionId,
    });

    this.notifyAllGuestsClosed();

    return this.jsonResponse({ ok: true });
  }

  private async handleSnapshot(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const partyId = url.searchParams.get('partyId');

    // Guest snapshot (partyId provided)
    if (partyId) {
      return this.handleGuestSnapshot(request, partyId);
    }

    // Host snapshot (read from KV)
    const key = `queue:${this.sessionId}:snapshot`;
    const snapshot = await this.env.QUEUE_KV.get(key);

    if (!snapshot) {
      // No snapshot yet, return empty queue state
      return new Response(
        JSON.stringify({
          type: 'queue_update',
          queue: [],
          nowServing: null,
          maxGuests: this.maxGuests,
          callDeadline: null,
          closed: this.closed,
        }),
        {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-cache, no-store, must-revalidate',
          },
        }
      );
    }

    // Compute ETag from snapshot content
    const encoder = new TextEncoder();
    const data = encoder.encode(snapshot);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    const etag = `"${hashHex.substring(0, 16)}"`;

    // Check if client has current version
    const clientEtag = request.headers.get('if-none-match');
    if (clientEtag === etag) {
      return new Response(null, { status: 304 });
    }

    return new Response(snapshot, {
      headers: {
        'content-type': 'application/json',
        etag,
        'cache-control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  private async handleGuestSnapshot(request: Request, partyId: string): Promise<Response> {
    // Load current state from storage (needed for guest position calculation)
    await this.restoreState();

    // Build guest-specific snapshot (same logic as sendGuestInitialState)
    let guestSnapshot: string;
    
    if (this.closed) {
      guestSnapshot = JSON.stringify({ type: 'closed' });
    } else if (this.nowServing && this.nowServing.id === partyId) {
      guestSnapshot = JSON.stringify({
        type: 'called',
        deadline: this.callDeadline ?? null,
      });
    } else if (!this.findParty(partyId)) {
      guestSnapshot = JSON.stringify({
        type: 'removed',
        reason: 'served',
      });
    } else {
      const payload = this.buildGuestPositionPayload(partyId);
      guestSnapshot = JSON.stringify({
        type: 'position',
        ...payload,
      });
    }

    // Compute ETag from guest snapshot content
    const encoder = new TextEncoder();
    const data = encoder.encode(guestSnapshot);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    const etag = `"${hashHex.substring(0, 16)}"`;

    // Check if client has current version
    const clientEtag = request.headers.get('if-none-match');
    if (clientEtag === etag) {
      return new Response(null, { status: 304 });
    }

    return new Response(guestSnapshot, {
      headers: {
        'content-type': 'application/json',
        etag,
        'cache-control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    const { response, server } = this.createWebSocketPair();

    const connectionInfo = await this.identifyConnection(request, url);
    if (connectionInfo instanceof Response) {
      return connectionInfo;
    }

    server.accept();
    this.registerSocket(server, connectionInfo);

    if (connectionInfo.role === 'host') {
      this.sendHostSnapshot(server);
    } else {
      this.sendGuestInitialState(server, connectionInfo.partyId);
    }

    return response;
  }

  private createWebSocketPair(): { response: Response; server: WebSocket } {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    return {
      response: new Response(null, { status: 101, webSocket: client }),
      server,
    };
  }

  private async identifyConnection(request: Request, url: URL): Promise<ConnectionInfo | Response> {
    const cookieHeader = request.headers.get('Cookie');
    const hostCookie = this.extractCookie(cookieHeader, HOST_COOKIE_NAME);
    const headerToken = request.headers.get('x-host-auth');
    const queryToken = url.searchParams.get('hostToken');

    const triedTokens = [headerToken, hostCookie, queryToken].filter((token): token is string =>
      Boolean(token)
    );

    for (const token of triedTokens) {
      const valid = await verifyHostCookie(token, this.sessionId, this.env.HOST_AUTH_SECRET);
      if (valid) {
        console.log(
          logPrefix(this.sessionId, 'identifyConnection'),
          'host authenticated via token'
        );
        return { role: 'host' };
      }
    }

    if (triedTokens.length > 0) {
      console.warn(
        logPrefix(this.sessionId, 'identifyConnection'),
        'host authentication failed for provided tokens',
        triedTokens.map((token) => token.slice(0, 8)).join(',')
      );
    } else {
      console.warn(logPrefix(this.sessionId, 'identifyConnection'), 'no host token provided');
    }

    const partyId = url.searchParams.get('partyId');
    if (!partyId) {
      console.warn(
        logPrefix(this.sessionId, 'identifyConnection'),
        'guest connect without partyId'
      );
      return new Response('Unauthorized', { status: 401 });
    }

    if (!this.findParty(partyId) && (!this.nowServing || this.nowServing.id !== partyId)) {
      console.warn(logPrefix(this.sessionId, 'identifyConnection'), 'party not found', partyId);
      return new Response('Party not found', { status: 404 });
    }

    console.log(logPrefix(this.sessionId, 'identifyConnection'), 'guest authenticated', partyId);
    return { role: 'guest', partyId };
  }

  private registerSocket(socket: WebSocket, info: ConnectionInfo): void {
    this.sockets.set(socket, info);
    console.log(logPrefix(this.sessionId, 'registerSocket'), 'socket added', info.role);
    socket.addEventListener('message', (event) => this.handleSocketMessage(socket, event));
    socket.addEventListener('close', () => this.unregisterSocket(socket));
    socket.addEventListener('error', () => this.unregisterSocket(socket));

    if (info.role === 'guest') {
      const set = this.guestSockets.get(info.partyId) ?? new Set<WebSocket>();
      set.add(socket);
      this.guestSockets.set(info.partyId, set);
    }

    // Start heartbeat if this is the first socket
    if (this.sockets.size === 1 && !this.heartbeatTimer) {
      this.startHeartbeat();
    }
  }

  private unregisterSocket(socket: WebSocket): void {
    const info = this.sockets.get(socket);
    if (!info) {
      return;
    }
    this.sockets.delete(socket);
    console.log(logPrefix(this.sessionId, 'unregisterSocket'), 'socket removed', info.role);

    if (info.role === 'guest') {
      const set = this.guestSockets.get(info.partyId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          this.guestSockets.delete(info.partyId);
        }
      }
    }

    // Stop heartbeat if no more sockets
    if (this.sockets.size === 0 && this.heartbeatTimer) {
      this.stopHeartbeat();
    }
  }

  private handleSocketMessage(socket: WebSocket, event: MessageEvent): void {
    const info = this.sockets.get(socket);
    if (!info) {
      return;
    }

    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : null;
      if (!data) {
        return;
      }

      if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        console.log(logPrefix(this.sessionId, 'handleSocketMessage'), 'pong sent to', info.role);
      }
    } catch (error) {
      console.error('WebSocket message error', error);
    }
  }

  private async advanceQueue(
    servedPartyId?: string,
    nextPartyId?: string
  ): Promise<Response | { nowServing: QueueParty | null }> {
    if (servedPartyId) {
      if (!this.nowServing || this.nowServing.id !== servedPartyId) {
        return this.jsonError('servedParty does not match current', 400);
      }

      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE parties SET status = 'served' WHERE id = ?1").bind(
          servedPartyId
        ),
        this.env.DB.prepare(
          "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'advanced', ?3)"
        ).bind(this.sessionId, servedPartyId, JSON.stringify({ action: 'served' })),
      ]);

      this.notifyGuestRemoval(servedPartyId, 'served');

      // Emit event for served party
      await this.emitEvent({
        type: 'QUEUE_MEMBER_SERVED',
        sessionId: this.sessionId,
        partyId: servedPartyId,
      });

      this.nowServing = null;
      this.pendingPartyId = null;
      await this.state.storage.deleteAlarm();
      this.callDeadline = null;
    }

    let selectedParty: QueueParty | undefined;
    if (nextPartyId) {
      const index = this.queue.findIndex((entry) => entry.id === nextPartyId);
      if (index === -1) {
        return this.jsonError('nextParty not found in queue', 404);
      }
      selectedParty = this.queue.splice(index, 1)[0];
    } else if (this.queue.length > 0) {
      selectedParty = this.queue.shift();
    }

    if (selectedParty) {
      selectedParty.status = 'called';
      this.nowServing = selectedParty;
      this.pendingPartyId = selectedParty.id;
      this.callDeadline = Date.now() + CALL_TIMEOUT_MS;

      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE parties SET status = 'called' WHERE id = ?1").bind(
          selectedParty.id
        ),
        this.env.DB.prepare(
          "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'advanced', ?3)"
        ).bind(this.sessionId, selectedParty.id, JSON.stringify({ action: 'called' })),
      ]);

      await this.state.storage.setAlarm(this.callDeadline);
      await this.persistState();

      this.notifyGuestCalled(selectedParty.id);

      // Emit event for push notification
      await this.emitEvent({
        type: 'QUEUE_MEMBER_CALLED',
        sessionId: this.sessionId,
        partyId: selectedParty.id,
        deadline: this.callDeadline,
      });
    } else {
      this.nowServing = null;
      this.pendingPartyId = null;
      await this.state.storage.deleteAlarm();
      this.callDeadline = null;
      await this.persistState();
    }

    await this.publishState();
    this.broadcastGuestPositions();

    return { nowServing: this.nowServing ? this.toHostParty(this.nowServing) : null };
  }

  private async callNextParty(): Promise<void> {
    const result = await this.advanceQueue(undefined, undefined);
    if (result instanceof Response) {
      console.error('Failed to auto-advance queue via alarm');
    }
  }

  private async markPartyAsNoShow(partyId: string): Promise<void> {
    if (!this.nowServing || this.nowServing.id !== partyId) {
      return;
    }

    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE parties SET status = 'no_show' WHERE id = ?1").bind(partyId),
      this.env.DB.prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'no_show', NULL)"
      ).bind(this.sessionId, partyId),
    ]);

    this.notifyGuestRemoval(partyId, 'no_show');

    // Emit event for dropped party (no-show)
    await this.emitEvent({
      type: 'QUEUE_MEMBER_DROPPED',
      sessionId: this.sessionId,
      partyId,
      reason: 'no_show',
    });

    this.nowServing = null;
    this.pendingPartyId = null;
    this.callDeadline = null;
    await this.persistState();
  }

  private async removeParty(partyId: string, reason: PartyRemovalReason): Promise<boolean> {
    if (this.nowServing && this.nowServing.id === partyId) {
      this.nowServing = null;
      this.pendingPartyId = null;
      await this.state.storage.deleteAlarm();
      this.callDeadline = null;
    } else {
      const index = this.queue.findIndex((entry) => entry.id === partyId);
      if (index === -1) {
        return false;
      }
      this.queue.splice(index, 1);
    }

    await this.persistState();
    await this.publishState();
    this.broadcastGuestPositions();
    this.notifyGuestRemoval(partyId, reason);

    // Emit event for dropped party
    const eventType = reason === 'left' ? 'QUEUE_MEMBER_LEFT' : reason === 'kicked' ? 'QUEUE_MEMBER_KICKED' : 'QUEUE_MEMBER_DROPPED';
    await this.emitEvent({
      type: eventType as any,
      sessionId: this.sessionId,
      partyId,
      reason,
    });

    await this.triggerPositionPushes();
    return true;
  }

  private async verifyHostRequest(request: Request): Promise<true | Response> {
    const token =
      request.headers.get('x-host-auth') ??
      this.extractCookie(request.headers.get('Cookie'), HOST_COOKIE_NAME);
    if (!token) {
      return this.jsonError('Host authentication required', 401);
    }

    const valid = await verifyHostCookie(token, this.sessionId, this.env.HOST_AUTH_SECRET);
    if (!valid) {
      return this.jsonError('Invalid host authentication', 403);
    }

    return true;
  }

  /**
   * Write current queue state snapshot to KV for client polling.
   * Expires after 60 seconds (minimum KV TTL) to ensure fresh data.
   */
  private async writeSnapshotToKV(): Promise<void> {
    const snapshot = {
      type: 'queue_update',
      queue: this.queue.map((entry) => this.toHostParty(entry)),
      nowServing: this.nowServing ? this.toHostParty(this.nowServing) : null,
      maxGuests: this.maxGuests,
      callDeadline: this.callDeadline,
      closed: this.closed,
    };
    const key = `queue:${this.sessionId}:snapshot`;
    await this.env.QUEUE_KV.put(key, JSON.stringify(snapshot), { expirationTtl: 60 });
  }

  /**
   * Emit an event to Cloudflare Queue for background processing.
   * Events include push notifications, analytics, and D1 logging.
   */
  private async emitEvent(event: {
    type: 'QUEUE_MEMBER_CALLED' | 'QUEUE_POSITION_2' | 'QUEUE_POSITION_5' | 'QUEUE_MEMBER_DROPPED' | 'QUEUE_MEMBER_SERVED' | 'QUEUE_MEMBER_LEFT' | 'QUEUE_MEMBER_KICKED' | 'QUEUE_CLOSED' | 'QUEUE_MEMBER_JOINED';
    sessionId: string;
    partyId?: string;
    reason?: string;
    position?: number;
    queueLength?: number;
    deadline?: number | null;
  }): Promise<void> {
    try {
      await this.env.EVENTS.send(event);
    } catch (error) {
      console.error(logPrefix(this.sessionId, 'emitEvent'), 'Failed to send event:', error);
    }
  }

  /**
   * Publish current state to both KV (for polling) and WebSockets (for legacy clients).
   * This should be called after any state mutation.
   */
  private async publishState(): Promise<void> {
    // Write to KV for polling clients
    await this.writeSnapshotToKV();

    // Broadcast to WebSocket clients (legacy support)
    this.broadcastHostSnapshot();
  }

  /**
   * Legacy method kept for WebSocket support (deprecated).
   * New clients should use HTTP polling against KV snapshot.
   */
  private broadcastHostSnapshot(): void {
    const message = JSON.stringify({
      type: 'queue_update',
      queue: this.queue.map((entry) => this.toHostParty(entry)),
      nowServing: this.nowServing ? this.toHostParty(this.nowServing) : null,
      maxGuests: this.maxGuests,
      callDeadline: this.callDeadline,
    });

    for (const [socket, info] of this.sockets.entries()) {
      if (info.role === 'host') {
        this.safeSend(socket, message);
      }
    }
  }

  private broadcastGuestPositions(): void {
    for (const [partyId, sockets] of this.guestSockets.entries()) {
      if (this.nowServing && this.nowServing.id === partyId) {
        continue;
      }
      const payload = this.buildGuestPositionPayload(partyId);
      const message = JSON.stringify({
        type: 'position',
        ...payload,
      });
      for (const socket of sockets) {
        this.safeSend(socket, message);
      }
    }
  }

  private notifyGuestCalled(partyId: string): void {
    const sockets = this.guestSockets.get(partyId);
    if (!sockets) return;
    const message = JSON.stringify({ type: 'called', deadline: this.callDeadline ?? null });
    for (const socket of sockets) {
      this.safeSend(socket, message);
    }
  }

  private async triggerPositionPushes(): Promise<void> {
    if (!this.nowServing) return;
    // Queue indices for position-based notifications when nowServing exists:
    // - index 0 = position 2 (first in queue after the currently served guest)
    // - index 3 = position 5 (fourth in queue after the currently served guest)
    const candidates: Array<[number, 'pos_2' | 'pos_5']> = [
      [0, 'pos_2'],  // position 2
      [3, 'pos_5'],  // position 5
    ];
    for (const [idx, kind] of candidates) {
      const party = this.queue[idx];
      if (!party) continue;
      // Emit event to Cloudflare Queue for background push notification
      if (kind === 'pos_2') {
        await this.emitEvent({
          type: 'QUEUE_POSITION_2',
          sessionId: this.sessionId,
          partyId: party.id,
          position: 2,
          queueLength: this.queue.length,
        });
      } else if (kind === 'pos_5') {
        await this.emitEvent({
          type: 'QUEUE_POSITION_5',
          sessionId: this.sessionId,
          partyId: party.id,
          position: 5,
          queueLength: this.queue.length,
        });
      }
    }
  }

  /**
   * Queue a push notification to be sent in the next alarm cycle.
   * This defers expensive crypto operations out of the request path.
   * Later notifications for the same party override earlier ones (only send most recent state).
   */
  private queuePushNotification(partyId: string, kind: 'called' | 'pos_2' | 'pos_5'): void {
    // Priority: 'called' > 'pos_2' > 'pos_5'
    // If user is being called, don't send position updates
    const existing = this.pendingPushes.get(partyId);
    if (existing === 'called') return; // Don't override 'called' with position updates
    if (kind === 'called' || existing !== 'called') {
      this.pendingPushes.set(partyId, kind);
    }
  }

  /**
   * Schedule an alarm to process pending push notifications.
   * Uses a short delay (2-5 seconds) to batch multiple operations.
   */
  private async scheduleNextPushAlarm(): Promise<void> {
    if (this.pendingPushes.size === 0) return;
    if (this.pushAlarmScheduled) return; // Already scheduled

    // Delay push notifications by 3 seconds to allow batching
    // This means position updates arrive 3s delayed, but saves massive CPU
    const PUSH_BATCH_DELAY_MS = 3000;

    // Check if there's already an alarm scheduled for no-show timeout
    const existingAlarm = await this.state.storage.getAlarm();

    if (existingAlarm === null) {
      // No alarm scheduled, schedule one for push processing
      await this.state.storage.setAlarm(Date.now() + PUSH_BATCH_DELAY_MS);
      this.pushAlarmScheduled = true;
    } else {
      // There's already an alarm (likely for no-show timeout)
      // Don't override it - pushes will be processed when that alarm fires
      const existingTime = existingAlarm;
      const pushTime = Date.now() + PUSH_BATCH_DELAY_MS;

      // Only reschedule if push alarm would fire before the existing alarm
      if (pushTime < existingTime) {
        await this.state.storage.setAlarm(pushTime);
      }
      this.pushAlarmScheduled = true;
    }
  }

  /**
   * Process all pending push notifications in a batch.
   * Called by alarm handler - runs outside the request path.
   */
  private async processPendingPushes(): Promise<void> {
    this.pushAlarmScheduled = false;

    if (this.pendingPushes.size === 0) return;

    // Skip if VAPID keys not configured (e.g., in tests)
    if (!this.env.VAPID_PUBLIC || !this.env.VAPID_PRIVATE) {
      this.pendingPushes.clear();
      return;
    }

    const batch = Array.from(this.pendingPushes.entries());
    this.pendingPushes.clear();

    console.log(`[QueueDO] Processing ${batch.length} batched push notifications`);

    // Process all notifications concurrently for speed
    // Use allSettled to prevent one failure from blocking others
    await Promise.allSettled(
      batch.map(([partyId, kind]) => this.sendPushSafe(partyId, kind))
    );
  }

  private async sendPushSafe(partyId: string, kind: 'called' | 'pos_2' | 'pos_5'): Promise<void> {
    try {
      // VAPID keys are required for push notifications
      if (!this.env.VAPID_PUBLIC || !this.env.VAPID_PRIVATE) {
        console.error('Missing VAPID_PUBLIC or VAPID_PRIVATE environment variable. Skipping push notification.');
        return;
      }

      const exists = await this.env.DB.prepare(
        "SELECT 1 AS x FROM events WHERE session_id=?1 AND party_id=?2 AND type='push_sent' AND json_extract(details, '$.kind') = ?3 LIMIT 1"
      )
        .bind(this.sessionId, partyId, kind)
        .first<{ x: number }>();
      if (exists?.x) return;

      const sub = await this.env.DB.prepare(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE session_id=?1 AND party_id=?2 ORDER BY created_at DESC LIMIT 1'
      )
        .bind(this.sessionId, partyId)
        .first<{ endpoint: string; p256dh: string; auth: string }>();
      if (!sub) return;

      const title =
        kind === 'called'
          ? "It's your turn"
          : kind === 'pos_2'
            ? "You're #2—almost up"
            : "You're #5—start heading back";
      const body =
        kind === 'called'
          ? 'Please check in at the host within 2 minutes to keep your spot.'
          : kind === 'pos_2'
            ? 'Almost your turn. Please make your way back.'
            : 'You may want to start returning.';

      const payload = await buildPushPayload(
        { data: JSON.stringify({ title, body }), options: { ttl: 60 } },
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth }, expirationTime: null },
        {
          subject: this.env.VAPID_SUBJECT ?? 'mailto:team@queue-up.app',
          publicKey: this.env.VAPID_PUBLIC,
          privateKey: this.env.VAPID_PRIVATE,
        }
      );
      const resp = await fetch(sub.endpoint, {
        method: payload.method,
        headers: payload.headers as any,
        body: payload.body as any,
      });
      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        try {
          await this.env.DB.prepare('DELETE FROM push_subscriptions WHERE session_id=?1 AND party_id=?2')
            .bind(this.sessionId, partyId)
            .run();
        } catch {}
        return;
      }

      await this.env.DB.prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'push_sent', ?3)"
      )
        .bind(this.sessionId, partyId, JSON.stringify({ kind }))
        .run();
    } catch (e: any) {
      const status = e?.status ?? e?.code ?? 0;
      if (status === 404 || status === 410) {
        try {
          await this.env.DB.prepare('DELETE FROM push_subscriptions WHERE session_id=?1 AND party_id=?2')
            .bind(this.sessionId, partyId)
            .run();
        } catch {}
      }
      // swallow to avoid breaking queue ops
    }
  }

  private notifyGuestRemoval(partyId: string, reason: PartyRemovalReason): void {
    const sockets = this.guestSockets.get(partyId);
    if (!sockets) return;
    const message = JSON.stringify({ type: 'removed', reason });
    for (const socket of sockets) {
      this.safeSend(socket, message);
      try {
        socket.close(1000, reason);
      } catch (error) {
        console.error('Failed to close guest socket', error);
      }
    }
    this.guestSockets.delete(partyId);
  }

  private notifyAllGuestsClosed(): void {
    const message = JSON.stringify({ type: 'closed' });
    for (const [socket] of this.sockets.entries()) {
      this.safeSend(socket, message);
      try {
        socket.close(1000, 'closed');
      } catch (error) {
        console.error('Failed to close socket on session close', error);
      }
    }
    this.sockets.clear();
    this.guestSockets.clear();
  }

  private sendHostSnapshot(socket: WebSocket): void {
    const message = JSON.stringify({
      type: 'queue_update',
      queue: this.queue.map((entry) => this.toHostParty(entry)),
      nowServing: this.nowServing ? this.toHostParty(this.nowServing) : null,
      maxGuests: this.maxGuests,
      callDeadline: this.callDeadline,
    });
    this.safeSend(socket, message);
  }

  private sendGuestInitialState(socket: WebSocket, partyId: string): void {
    if (this.closed) {
      this.safeSend(socket, JSON.stringify({ type: 'closed' }));
      socket.close(1000, 'closed');
      return;
    }

    if (this.nowServing && this.nowServing.id === partyId) {
      this.safeSend(
        socket,
        JSON.stringify({ type: 'called', deadline: this.callDeadline ?? null })
      );
      return;
    }

    if (!this.findParty(partyId)) {
      this.safeSend(socket, JSON.stringify({ type: 'removed', reason: 'served' }));
      socket.close(1000, 'served');
      return;
    }

    const payload = this.buildGuestPositionPayload(partyId);
    this.safeSend(socket, JSON.stringify({ type: 'position', ...payload }));
  }

  private computePosition(partyId: string): { position: number; aheadCount: number } {
    const index = this.queue.findIndex((entry) => entry.id === partyId);
    const aheadWaiting = index === -1 ? 0 : index;
    const aheadCount = aheadWaiting + (this.nowServing ? 1 : 0);
    return {
      aheadCount,
      position: aheadCount + 1,
    };
  }

  private buildGuestPositionPayload(partyId: string): {
    position: number;
    aheadCount: number;
    queueLength: number;
    estimatedWaitMs: number;
  } {
    const { position, aheadCount } = this.computePosition(partyId);
    return {
      position,
      aheadCount,
      queueLength: this.computeQueueLength(),
      estimatedWaitMs: this.estimateWaitMs(aheadCount),
    };
  }

  private computeQueueLength(): number {
    return this.queue.length + (this.nowServing ? 1 : 0);
  }

  private estimateWaitMs(aheadCount: number): number {
    const safeAhead = Math.max(0, aheadCount);
    return safeAhead * AVERAGE_SERVICE_MINUTES * MS_PER_MINUTE;
  }

  private computeGuestCount(): number {
    const waiting = this.queue.reduce((sum, entry) => sum + this.partySize(entry), 0);
    const serving = this.partySize(this.nowServing);
    return waiting + serving;
  }

  private partySize(party: QueueParty | null | undefined): number {
    if (!party) {
      return 0;
    }
    const value = party.size;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
  }

  private toHostParty(party: QueueParty): Omit<QueueParty, 'joinedAt'> & { joinedAt: number } {
    return {
      id: party.id,
      name: party.name,
      size: party.size,
      status: party.status,
      nearby: party.nearby,
      joinedAt: party.joinedAt,
    };
  }

  private findParty(partyId: string): QueueParty | undefined {
    if (this.nowServing && this.nowServing.id === partyId) {
      return this.nowServing;
    }
    return this.queue.find((entry) => entry.id === partyId);
  }

  private async restoreState(): Promise<void> {
    const stored = await this.state.storage.get<StoredState>('state');
    if (stored) {
      this.queue = (stored.queue ?? []).map((entry) => ({
        ...entry,
        status: entry.status ?? 'waiting',
      }));
      this.nowServing = stored.nowServing ?? null;
      if (this.nowServing) {
        this.nowServing.status = 'called';
      }
      this.closed = stored.closed ?? false;
      this.pendingPartyId = stored.pendingPartyId ?? (this.nowServing ? this.nowServing.id : null);
      this.maxGuests = stored.maxGuests ?? DEFAULT_MAX_GUESTS;
      this.callDeadline = stored.callDeadline ?? null;
      return;
    }

    await this.loadFromDatabase();
    await this.persistState();
  }

  private async loadFromDatabase(): Promise<void> {
    const sessionRow = await this.env.DB.prepare(
      'SELECT status, max_guests FROM sessions WHERE id = ?1'
    )
      .bind(this.sessionId)
      .first<{ status: string; max_guests?: number | null }>();

    this.closed = sessionRow?.status === 'closed';
    if (typeof sessionRow?.max_guests === 'number' && Number.isFinite(sessionRow.max_guests)) {
      this.maxGuests = sessionRow.max_guests;
    } else {
      this.maxGuests = DEFAULT_MAX_GUESTS;
    }

    const { results } = await this.env.DB.prepare(
      "SELECT id, name, size, joined_at, status, nearby FROM parties WHERE session_id = ?1 AND status IN ('waiting','called') ORDER BY joined_at ASC"
    )
      .bind(this.sessionId)
      .all<{
        id: string;
        name?: string | null;
        size?: number | null;
        joined_at: number | null;
        status: string;
        nearby: number;
      }>();

    this.queue = [];
    this.nowServing = null;
    this.callDeadline = null;
    if (results) {
      for (const row of results) {
        const sizeValue =
          typeof row.size === 'number' && Number.isFinite(row.size) && row.size > 0
            ? row.size
            : 1;
        const party: QueueParty = {
          id: row.id,
          name: row.name ?? undefined,
          size: sizeValue,
          status: row.status === 'called' ? 'called' : 'waiting',
          nearby: row.nearby === 1,
          joinedAt: (row.joined_at ?? Math.floor(Date.now() / 1000)) * 1000,
        };
        if (party.status === 'called') {
          this.nowServing = party;
          this.pendingPartyId = party.id;
        } else {
          this.queue.push(party);
        }
      }
    }
  }

  private async persistState(): Promise<void> {
    await this.state.storage.put<StoredState>('state', {
      queue: this.queue,
      nowServing: this.nowServing,
      closed: this.closed,
      pendingPartyId: this.pendingPartyId,
      maxGuests: this.maxGuests,
      callDeadline: this.callDeadline,
    });
  }

  private async readJson(request: Request): Promise<any | undefined> {
    try {
      return await request.json();
    } catch {
      return undefined;
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  private jsonError(message: string, status: number): Response {
    return this.jsonResponse({ error: message }, status);
  }

  private extractCookie(header: string | null, name: string): string | null {
    if (!header) return null;
    const parts = header.split(';');
    for (const part of parts) {
      const [cookieName, ...rest] = part.trim().split('=');
      if (cookieName === name) {
        return rest.join('=');
      }
    }
    return null;
  }

  private safeSend(socket: WebSocket, data: string): void {
    try {
      const readyState = (socket as any).readyState;
      if (typeof readyState === 'number' && readyState >= 2) {
        return;
      }
      socket.send(data);
    } catch (error) {
      console.error('Failed to send WebSocket message', error);
      this.unregisterSocket(socket);
    }
  }

  /**
   * Track activity to prevent auto-close of active queues.
   * Called on every guest/host action.
   */
  private trackActivity(): void {
    this.lastActivityAt = Date.now();
  }

  /**
   * Auto-close queue due to inactivity or lifetime limits.
   * This is a cost optimization to prevent forgotten queues from running forever.
   */
  private async handleAutoClose(reason: 'inactivity' | 'max_lifetime_exceeded'): Promise<void> {
    if (this.closed) return;

    console.log(`[QueueDO ${this.sessionId}] Auto-closing queue: ${reason}`);

    this.closed = true;
    this.queue = [];
    this.nowServing = null;
    this.pendingPartyId = null;

    await this.env.DB.batch([
      this.env.DB.prepare("UPDATE sessions SET status = 'closed' WHERE id = ?1").bind(
        this.sessionId
      ),
      this.env.DB.prepare(
        "INSERT INTO events (session_id, type, details) VALUES (?1, 'auto_close', ?2)"
      ).bind(this.sessionId, JSON.stringify({ reason })),
    ]);

    await this.state.storage.deleteAlarm();
    await this.persistState();

    await this.publishState();

    // Emit event for auto-closed queue
    await this.emitEvent({
      type: 'QUEUE_CLOSED',
      sessionId: this.sessionId,
      reason,
    });

    this.notifyAllGuestsClosed();
  }

  /**
   * Schedule an alarm to check queue lifecycle (inactivity/expiration).
   * Runs every 15 minutes to check if queue should be auto-closed.
   */
  private async scheduleLifecycleAlarm(): Promise<void> {
    const existingAlarm = await this.state.storage.getAlarm();

    // If there's already an alarm scheduled sooner, don't override it
    const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
    const nextCheck = Date.now() + CHECK_INTERVAL_MS;

    if (!existingAlarm || existingAlarm > nextCheck) {
      await this.state.storage.setAlarm(nextCheck);
    }
  }

  /**
   * Start sending heartbeat pings to all connected WebSockets.
   * Helps detect dead connections and clean them up to save costs.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      const deadSockets: WebSocket[] = [];

      for (const [socket, info] of this.sockets.entries()) {
        try {
          const readyState = (socket as any).readyState;
          // 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
          if (readyState === 1) {
            // Send ping only to open sockets
            socket.send(JSON.stringify({ type: 'ping' }));
          } else if (readyState >= 2) {
            // Mark closed/closing sockets for cleanup
            deadSockets.push(socket);
          }
        } catch (error) {
          console.error('Heartbeat error', error);
          deadSockets.push(socket);
        }
      }

      // Clean up dead sockets
      for (const socket of deadSockets) {
        this.unregisterSocket(socket);
      }
    }, QueueDO.HEARTBEAT_INTERVAL_MS) as any;
  }

  /**
   * Stop the heartbeat timer.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
