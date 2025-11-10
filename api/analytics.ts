import type { D1Database } from '@cloudflare/workers-types';

export interface AnalyticsLogOptions {
  db: D1Database;
  sessionId?: string | null;
  partyId?: string | null;
  type: string;
  details?: Record<string, unknown> | null;
}

export async function logAnalyticsEvent(options: AnalyticsLogOptions): Promise<void> {
  const { db, sessionId, partyId, type, details } = options;
  try {
    await db
      .prepare(
        "INSERT INTO events (session_id, party_id, type, details) VALUES (?1, ?2, ?3, ?4)"
      )
      .bind(sessionId ?? null, partyId ?? null, type, details ? JSON.stringify(details) : null)
      .run();
  } catch (error) {
    console.warn('[analytics] failed to log event', type, error);
  }
}
