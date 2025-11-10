import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { API_BASE_URL } from '../lib/backend';

const ANALYTICS_ID_STORAGE_KEY = 'queueup:analytics:anon_id';
const ANALYTICS_VARIANT_KEY = 'queueup:analytics:variant';

type Nullable<T> = T | null | undefined;

export type AnalyticsEvent =
  | 'push_prompt_shown'
  | 'push_granted'
  | 'push_denied'
  | 'qr_scanned'
  | 'join_started'
  | 'join_completed'
  | 'nudge_sent'
  | 'nudge_ack'
  | 'abandon_after_eta'
  | 'trust_survey_submitted'
  | 'queue_create_started'
  | 'queue_create_completed'
  | 'queue_create_failed'
  | 'host_call_next'
  | 'host_call_specific'
  | 'host_close_queue'
  | 'host_close_queue_cancelled'
  | 'qr_shared'
  | 'qr_share_failed'
  | 'qr_saved'
  | 'qr_save_failed';

export interface TrackEventOptions {
  sessionId?: Nullable<string>;
  partyId?: Nullable<string>;
  queueCode?: Nullable<string>;
  props?: Record<string, unknown>;
}

let anonIdPromise: Promise<string> | null = null;
let variantPromise: Promise<string | null> | null = null;

function generateAnonId(): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `anon_${stamp}_${random}`;
}

async function resolveAnonId(): Promise<string> {
  if (anonIdPromise) {
    return anonIdPromise;
  }
  anonIdPromise = (async () => {
    try {
      const existing = await AsyncStorage.getItem(ANALYTICS_ID_STORAGE_KEY);
      if (existing) {
        return existing;
      }
    } catch {
      // Ignore storage read errors and fall through to generating a new ID.
    }

    const next = generateAnonId();
    try {
      await AsyncStorage.setItem(ANALYTICS_ID_STORAGE_KEY, next);
    } catch {
      // Non-fatal; the ID will be regenerated in a future session if persistence fails.
    }
    return next;
  })();
  return anonIdPromise;
}

function variantFromEnv(): string | null {
  const value = process.env.EXPO_PUBLIC_ANALYTICS_VARIANT ?? process.env.EXPO_PUBLIC_VARIANT;
  return value && value.trim().length > 0 ? value.trim() : null;
}

function variantFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const variant = params.get('variant');
    return variant && variant.trim().length > 0 ? variant.trim() : null;
  } catch {
    return null;
  }
}

async function resolveVariant(): Promise<string | null> {
  if (variantPromise) {
    return variantPromise;
  }

  variantPromise = (async () => {
    try {
      const stored = await AsyncStorage.getItem(ANALYTICS_VARIANT_KEY);
      if (stored) {
        return stored;
      }
    } catch {
      // Ignore storage read errors.
    }

    const fromUrl = variantFromUrl();
    if (fromUrl) {
      try {
        await AsyncStorage.setItem(ANALYTICS_VARIANT_KEY, fromUrl);
      } catch {
        // Ignore storage write failures.
      }
      return fromUrl;
    }

    const fromEnv = variantFromEnv();
    if (fromEnv) {
      try {
        await AsyncStorage.setItem(ANALYTICS_VARIANT_KEY, fromEnv);
      } catch {
        // Ignore storage write failures.
      }
      return fromEnv;
    }

    return null;
  })();

  return variantPromise;
}

export async function setAnalyticsVariant(variant: string | null): Promise<void> {
  try {
    if (variant && variant.trim().length > 0) {
      await AsyncStorage.setItem(ANALYTICS_VARIANT_KEY, variant.trim());
      variantPromise = Promise.resolve(variant.trim());
    } else {
      await AsyncStorage.removeItem(ANALYTICS_VARIANT_KEY);
      variantPromise = Promise.resolve(null);
    }
  } catch {
    // Ignore storage errors.
  }
}

export async function trackEvent(event: AnalyticsEvent, options?: TrackEventOptions): Promise<void> {
  if (!API_BASE_URL) {
    return;
  }

  try {
    const [anonId, variant] = await Promise.all([resolveAnonId(), resolveVariant()]);

    const meta: Record<string, unknown> = {
      platform: Platform.OS,
      ...(options?.queueCode ? { queueCode: options.queueCode } : {}),
      ...(options?.props ?? {}),
    };

    if (variant) {
      meta.variant = variant;
    }
    if (anonId) {
      meta.anonUserId = anonId;
    }

    const body: Record<string, unknown> = {
      type: event,
    };

    if (options?.sessionId) {
      body.sessionId = options.sessionId;
    }
    if (options?.partyId) {
      body.partyId = options.partyId;
    }
    if (Object.keys(meta).length > 0) {
      body.meta = meta;
    }

    await fetch(`${API_BASE_URL}/api/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[analytics] trackEvent failed', { event, error });
    }
  }
}

export async function trackTrustSurveySubmitted(
  options?: TrackEventOptions & { answers?: Record<string, unknown> }
): Promise<void> {
  await trackEvent('trust_survey_submitted', {
    ...options,
    props: {
      ...(options?.props ?? {}),
      ...(options?.answers ?? {}),
    },
  });
}
