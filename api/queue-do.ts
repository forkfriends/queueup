import type { Env } from './worker';
import { HOST_COOKIE_NAME, verifyHostCookie } from './utils/auth';

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
}

type ConnectionInfo = { role: 'host' } | { role: 'guest'; partyId: string };

const CALL_TIMEOUT_MS = 2 * 60 * 1000;

export class QueueDO implements DurableObject {
  private readonly sessionId: string;
  private queue: QueueParty[] = [];
  private nowServing: QueueParty | null = null;
  private pendingPartyId: string | null = null;
  private closed = false;

  private sockets = new Map<WebSocket, ConnectionInfo>();
  private guestSockets = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.sessionId = state.id.toString();
    this.state.blockConcurrencyWhile(async () => {
      await this.restoreState();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket' && url.pathname === '/connect') {
      return this.handleWebSocket(request, url);
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
    if (!this.pendingPartyId || !this.nowServing || this.nowServing.id !== this.pendingPartyId) {
      return;
    }

    await this.markPartyAsNoShow(this.nowServing.id);
    await this.callNextParty();
  }

  private async handleJoin(request: Request): Promise<Response> {
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

    const party: QueueParty = {
      id: crypto.randomUUID(),
      name,
      size,
      status: 'waiting',
      nearby: false,
      joinedAt: Date.now(),
    };

    this.queue.push(party);

    const statements = [
      this.env.DB.prepare(
        "INSERT INTO parties (id, session_id, name, size, status, nearby) VALUES (?1, ?2, ?3, ?4, 'waiting', 0)"
      ).bind(party.id, this.sessionId, name ?? null, size ?? null),
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
    this.broadcastHostSnapshot();
    this.broadcastGuestPositions();

    const aheadWaiting = this.queue.length - 1;
    const aheadCount = aheadWaiting + (this.nowServing ? 1 : 0);
    const position = aheadCount + 1;

    return this.jsonResponse({ partyId: party.id, position });
  }

  private async handleDeclareNearby(request: Request): Promise<Response> {
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
      await this.persistState();
      this.broadcastHostSnapshot();
    }

    return this.jsonResponse({ ok: true });
  }

  private async handleLeave(request: Request): Promise<Response> {
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

    this.broadcastHostSnapshot();
    this.notifyAllGuestsClosed();

    return this.jsonResponse({ ok: true });
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

    if (hostCookie) {
      const valid = await verifyHostCookie(hostCookie, this.sessionId, this.env.HOST_AUTH_SECRET);
      if (valid) {
        return { role: 'host' };
      }
    }

    const partyId = url.searchParams.get('partyId');
    if (!partyId) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (!this.findParty(partyId) && (!this.nowServing || this.nowServing.id !== partyId)) {
      return new Response('Party not found', { status: 404 });
    }

    return { role: 'guest', partyId };
  }

  private registerSocket(socket: WebSocket, info: ConnectionInfo): void {
    this.sockets.set(socket, info);
    socket.addEventListener('message', (event) => this.handleSocketMessage(socket, event));
    socket.addEventListener('close', () => this.unregisterSocket(socket));
    socket.addEventListener('error', () => this.unregisterSocket(socket));

    if (info.role === 'guest') {
      const set = this.guestSockets.get(info.partyId) ?? new Set<WebSocket>();
      set.add(socket);
      this.guestSockets.set(info.partyId, set);
    }
  }

  private unregisterSocket(socket: WebSocket): void {
    const info = this.sockets.get(socket);
    if (!info) {
      return;
    }
    this.sockets.delete(socket);

    if (info.role === 'guest') {
      const set = this.guestSockets.get(info.partyId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          this.guestSockets.delete(info.partyId);
        }
      }
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
      this.nowServing = null;
      this.pendingPartyId = null;
      await this.state.storage.deleteAlarm();
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

      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE parties SET status = 'called' WHERE id = ?1").bind(
          selectedParty.id
        ),
        this.env.DB.prepare(
          "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, 'advanced', ?3)"
        ).bind(this.sessionId, selectedParty.id, JSON.stringify({ action: 'called' })),
      ]);

      await this.state.storage.setAlarm(Date.now() + CALL_TIMEOUT_MS);
      await this.persistState();

      this.notifyGuestCalled(selectedParty.id);
    } else {
      this.nowServing = null;
      this.pendingPartyId = null;
      await this.state.storage.deleteAlarm();
      await this.persistState();
    }

    this.broadcastHostSnapshot();
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
    this.nowServing = null;
    this.pendingPartyId = null;
    await this.persistState();
  }

  private async removeParty(partyId: string, reason: PartyRemovalReason): Promise<boolean> {
    if (this.nowServing && this.nowServing.id === partyId) {
      this.nowServing = null;
      this.pendingPartyId = null;
      await this.state.storage.deleteAlarm();
    } else {
      const index = this.queue.findIndex((entry) => entry.id === partyId);
      if (index === -1) {
        return false;
      }
      this.queue.splice(index, 1);
    }

    await this.persistState();
    this.broadcastHostSnapshot();
    this.broadcastGuestPositions();
    this.notifyGuestRemoval(partyId, reason);

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

  private broadcastHostSnapshot(): void {
    const message = JSON.stringify({
      type: 'queue_update',
      queue: this.queue.map((entry) => this.toHostParty(entry)),
      nowServing: this.nowServing ? this.toHostParty(this.nowServing) : null,
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
      const { position, aheadCount } = this.computePosition(partyId);
      const message = JSON.stringify({
        type: 'position',
        position,
        aheadCount,
      });
      for (const socket of sockets) {
        this.safeSend(socket, message);
      }
    }
  }

  private notifyGuestCalled(partyId: string): void {
    const sockets = this.guestSockets.get(partyId);
    if (!sockets) return;
    const message = JSON.stringify({ type: 'called' });
    for (const socket of sockets) {
      this.safeSend(socket, message);
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
      this.safeSend(socket, JSON.stringify({ type: 'called' }));
      return;
    }

    if (!this.findParty(partyId)) {
      this.safeSend(socket, JSON.stringify({ type: 'removed', reason: 'served' }));
      socket.close(1000, 'served');
      return;
    }

    const { position, aheadCount } = this.computePosition(partyId);
    this.safeSend(socket, JSON.stringify({ type: 'position', position, aheadCount }));
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
      return;
    }

    await this.loadFromDatabase();
    await this.persistState();
  }

  private async loadFromDatabase(): Promise<void> {
    const sessionRow = await this.env.DB.prepare('SELECT status FROM sessions WHERE id = ?1')
      .bind(this.sessionId)
      .first<{ status: string }>();

    this.closed = sessionRow?.status === 'closed';

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
    if (results) {
      for (const row of results) {
        const party: QueueParty = {
          id: row.id,
          name: row.name ?? undefined,
          size: row.size ?? undefined,
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
}
