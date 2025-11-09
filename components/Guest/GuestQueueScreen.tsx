import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import styles from './GuestQueueScreen.Styles';
import type { RootStackParamList } from '../../types/navigation';
import {
  API_BASE_URL,
  buildGuestConnectUrl,
  getVapidPublicKey,
  leaveQueue,
  savePushSubscription,
} from '../../lib/backend';
import { storage } from '../../utils/storage';
import Timer from '../Timer';

type Props = NativeStackScreenProps<RootStackParamList, 'GuestQueueScreen'>;

const MS_PER_MINUTE = 60 * 1000;
const POLL_INTERVAL_MS = 10000;

export default function GuestQueueScreen({ route, navigation }: Props) {
    // Override the back button behavior to go to HomeScreen
    useEffect(() => {
        navigation.setOptions({
            headerLeft: () => (
                <Pressable
                    onPress={() => navigation.navigate('HomeScreen')}
                    style={({ pressed }) => [
                        { opacity: pressed ? 0.7 : 1 },
                        { marginLeft: 10 }
                    ]}>
                    <Text style={{ color: '#007AFF', fontSize: 17 }}>Home</Text>
                </Pressable>
            ),
        });
    }, [navigation]);
    const {
        code,
        partyId,
        sessionId: initialSessionId = null,
        initialPosition,
        initialAheadCount,
        initialQueueLength,
        initialEtaMs,
        guestName,
        partySize,
    } = route.params;

    const derivedAhead = useMemo(() => {
        if (typeof initialAheadCount === 'number') {
        return Math.max(initialAheadCount, 0);
        }
        if (typeof initialPosition === 'number') {
        return Math.max(initialPosition - 1, 0);
        }
        return null;
    }, [initialAheadCount, initialPosition]);

    const [position, setPosition] = useState<number | null>(
        typeof initialPosition === 'number' ? initialPosition : null
    );
    const [aheadCount, setAheadCount] = useState<number | null>(derivedAhead);
    const [queueLength, setQueueLength] = useState<number | null>(
        typeof initialQueueLength === 'number' ? initialQueueLength : null
    );
    const [estimatedWaitMs, setEstimatedWaitMs] = useState<number | null>(
        typeof initialEtaMs === 'number' ? initialEtaMs : null
    );
    const [statusText, setStatusText] = useState(
        typeof initialPosition === 'number'
        ? `You're number ${initialPosition} in line.`
        : 'Connecting for live updates…'
    );
    const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed'>(
        'idle'
    );
    const [pushReady, setPushReady] = useState(false);
    const [pushMessage, setPushMessage] = useState<string | null>(null);
    const [leaveLoading, setLeaveLoading] = useState(false);
    const [leaveConfirmVisibleWeb, setLeaveConfirmVisibleWeb] = useState(false);
    const [isActive, setIsActive] = useState(true);
  const [sessionId] = useState<string | null>(initialSessionId ?? null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [called, setCalled] = useState(false);
  const [callDeadline, setCallDeadline] = useState<number | null>(null);
    const isWeb = Platform.OS === 'web';

    const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldReconnectRef = useRef(true);
    const autoPushAttemptRef = useRef<string | null>(null);
    const etag = useRef<string | null>(null);

    const clearReconnect = useCallback(() => {
        if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
        }
    }, []);

    const stopPolling = useCallback(() => {
        if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
        }
    }, []);

    const endSession = useCallback(
        async (message: string) => {
      shouldReconnectRef.current = false;
      clearReconnect();
      stopPolling();
      setConnectionState('closed');
      setIsActive(false);
      setStatusText(message);
      setCallDeadline(null);
      try {
        if (code) {
          await storage.removeJoinedQueue(code);
        }
      } catch (error) {
        console.warn('Failed to remove joined queue from storage', error);
      }
    },
    [clearReconnect, stopPolling, code]
  );

    const snapshotUrl = useMemo(() => {
        if (!code || !partyId) return null;
        const wsUrl = buildGuestConnectUrl(code, partyId);
        return wsUrl.replace('/connect', '/snapshot').replace('wss://', 'https://').replace('ws://', 'http://');
    }, [code, partyId]);

    const handleSnapshot = useCallback((data: Record<string, unknown>) => {
        try {
            switch (data.type) {
                case 'position': {
                const newPosition = Number(data.position);
                const newAhead = Number(data.aheadCount);
                const newQueueLength =
                    typeof data.queueLength === 'number' ? data.queueLength : null;
                const newEtaMs =
                    typeof data.estimatedWaitMs === 'number' ? data.estimatedWaitMs : null;

                if (!Number.isNaN(newPosition)) {
                    setPosition(newPosition);
                    if (!Number.isNaN(newAhead)) {
                    setStatusText(
                        newAhead >= 0
                        ? `You're number ${newPosition} in line. ${newAhead} ${
                            newAhead === 1 ? 'party' : 'parties'
                            } ahead.`
                        : `You're number ${newPosition} in line.`
                    );
                    } else {
                    setStatusText(`You're number ${newPosition} in line.`);
                    }
                }

                if (!Number.isNaN(newAhead)) {
                    setAheadCount(Math.max(newAhead, 0));
                }

                if (newQueueLength !== null) {
                    setQueueLength(newQueueLength);
                }

              if (newEtaMs !== null) {
                setEstimatedWaitMs(newEtaMs);
              }

              setCalled(false);
              setInfoMessage(null);
              setCallDeadline(null);
              break;
            }
            case 'called': {
              setCalled(true);
              setStatusText("You're being served now! Please head to the host.");
              setInfoMessage('Head to the host stand within 2 minutes to keep your spot.');
              setEstimatedWaitMs(0);
              setPosition(1);
              setAheadCount(0);
              setQueueLength((prev) => (prev != null ? Math.max(prev, 1) : 1));
              const deadlineValue =
                typeof data.deadline === 'number' ? data.deadline : null;
              setCallDeadline(deadlineValue);
              break;
            }
            case 'removed': {
              const reason = data.reason;
              const reasonMessages: Record<string, string> = {
                served: 'All set! You have been marked as served.',
                no_show:
                  "Time ran out before you could check in, so we had to release your spot.",
                kicked: 'The host removed you from the queue.',
                closed: 'Queue closed. Thanks for your patience!',
                left: 'You have left the queue.',
              };
              const key = typeof reason === 'string' ? reason : '';
              const message = reasonMessages[key] ?? 'You have left the queue.';
              setInfoMessage(message);
              setPosition(null);
              setAheadCount(null);
              setQueueLength(null);
              setEstimatedWaitMs(null);
              setCallDeadline(null);
              setCalled(false);
              endSession(message);
              break;
            }
            case 'closed': {
              const message = 'Queue closed by the host. Thanks for waiting with us!';
              setInfoMessage(message);
              setPosition(null);
              setAheadCount(null);
              setQueueLength(null);
              setEstimatedWaitMs(null);
              setCallDeadline(null);
              endSession(message);
              break;
            }
                default:
                break;
            }
        } catch (error) {
            console.warn('Failed to parse guest snapshot payload', error);
        }
    }, [endSession]);

    const poll = useCallback(async () => {
        if (!snapshotUrl) {
            return;
        }

        try {
            const headers: HeadersInit = {};
            if (etag.current) {
                headers['If-None-Match'] = etag.current;
            }

            const response = await fetch(snapshotUrl, { headers });

            if (response.status === 304) {
                // No changes, connection is healthy
                setConnectionState('open');
                return;
            }

            if (response.ok) {
                const newEtag = response.headers.get('ETag');
                if (newEtag) {
                    etag.current = newEtag;
                }
                const data = await response.json();
                handleSnapshot(data);
                setConnectionState('open');
            } else {
                console.warn('[GuestQueueScreen] Poll failed:', response.status);
                setConnectionState('closed');
            }
        } catch (error) {
            console.error('[GuestQueueScreen] Poll error:', error);
            setConnectionState('closed');
        }
    }, [snapshotUrl, handleSnapshot]);

    const startPolling = useCallback(() => {
        if (!snapshotUrl) {
            return;
        }

        clearReconnect();
        stopPolling();
        setConnectionState('connecting');

        console.log('[GuestQueueScreen] Starting polling');

        // Poll immediately
        poll();

        // Then poll every POLL_INTERVAL_MS
        pollInterval.current = setInterval(() => {
            poll();
        }, POLL_INTERVAL_MS);
    }, [snapshotUrl, clearReconnect, stopPolling, poll]);

    useEffect(() => {
        if (!partyId || !code || !isActive) {
        return undefined;
        }

        shouldReconnectRef.current = true;
        startPolling();

        return () => {
        shouldReconnectRef.current = false;
        clearReconnect();
        stopPolling();
        };
    }, [code, partyId, isActive, clearReconnect, stopPolling, startPolling]);

    useEffect(() => {
        return () => {
        clearReconnect();
        stopPolling();
        };
    }, [clearReconnect, stopPolling]);

    const enablePush = useCallback(
        async (options?: { silent?: boolean }) => {
        if (Platform.OS !== 'web') {
            return;
        }
        if (!sessionId || !partyId) {
            return;
        }
        if (typeof window === 'undefined' || typeof navigator === 'undefined') {
            return;
        }
        const hasServiceWorker = 'serviceWorker' in navigator;
        const hasPushManager = 'PushManager' in window;
        const hasNotificationApi = typeof Notification !== 'undefined';
        if (!hasServiceWorker || !hasPushManager || !hasNotificationApi) {
            setPushMessage('Notifications not supported in this browser.');
            if (!options?.silent) {
            Alert.alert('Push not supported', 'This browser does not support notifications.');
            }
            return;
        }
        try {
            setPushMessage('Enabling notifications…');
            const publicKey = await getVapidPublicKey();
            if (!publicKey) {
            throw new Error('Missing VAPID key');
            }
            const b64ToU8 = (b64: string) => {
            try {
                return Uint8Array.from(
                atob(b64.replace(/-/g, '+').replace(/_/g, '/')),
                (c) => c.charCodeAt(0)
                );
            } catch (error) {
                throw new Error('Invalid VAPID public key format');
            }
            };
            const isGhPages = window.location.pathname.startsWith('/queueup');
            const swPath = isGhPages ? '/queueup/sw.js' : '/sw.js';
            const swScope = isGhPages ? '/queueup/' : '/';
            const registration = await navigator.serviceWorker.register(swPath, { scope: swScope });
            let subscription = await registration.pushManager.getSubscription();
            const requestPermission = async () => {
            if (Notification.permission === 'granted') {
                return 'granted' as NotificationPermission;
            }
            if (Notification.permission === 'denied') {
                return 'denied' as NotificationPermission;
            }
            return Notification.requestPermission();
            };
            if (!subscription) {
            const perm = await requestPermission();
            if (perm !== 'granted') {
                setPushMessage('Notifications are blocked in your browser settings.');
                if (!options?.silent) {
                Alert.alert(
                    'Notifications blocked',
                    'Enable notifications in your browser settings to get alerts.'
                );
                }
                return;
            }
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: b64ToU8(publicKey),
            });
            }
            await savePushSubscription({
            sessionId,
            partyId,
            subscription: subscription.toJSON?.() ?? (subscription as any),
            });
            console.log('[QueueUp][push] saved subscription', {
            endpoint: subscription.endpoint,
            apiBase: API_BASE_URL,
            sessionId,
            partyId,
            });
            setPushReady(true);
            setPushMessage('Notifications on');
            if (!options?.silent) {
            Alert.alert('Notifications enabled', 'We will alert you when it is your turn.');
            }
        } catch (e) {
            console.warn('enablePush failed', e);
            setPushMessage('Unable to enable notifications right now.');
            if (!options?.silent) {
            Alert.alert('Failed to enable push', 'Please try again in a moment.');
            }
        }
        },
        [partyId, sessionId]
    );

    useEffect(() => {
        if (!isWeb || !sessionId || !partyId || pushReady) {
        return;
        }
        const key = `${sessionId}:${partyId}`;
        if (autoPushAttemptRef.current === key) {
        return;
        }
        autoPushAttemptRef.current = key;
        enablePush({ silent: true }).catch(() => {
        // handled through pushMessage state
        });
    }, [isWeb, sessionId, partyId, pushReady, enablePush]);

    const connectionLabel = useMemo(() => {
        switch (connectionState) {
        case 'open':
            return 'Live updates on';
        case 'connecting':
            return 'Connecting for live updates…';
        case 'closed':
            return 'Connection lost. Waiting to retry…';
        default:
            return 'Waiting to connect…';
        }
    }, [connectionState]);

    const aheadDisplay = aheadCount ?? (typeof position === 'number' ? Math.max(position - 1, 0) : null);
    const queueLengthDisplay = queueLength ?? (typeof position === 'number' ? position : null);
    const etaText = useMemo(() => {
        if (estimatedWaitMs == null) {
        return '—';
        }
        if (estimatedWaitMs <= MS_PER_MINUTE) {
        return '< 1 min';
        }
        return `${Math.round(estimatedWaitMs / MS_PER_MINUTE)} min`;
    }, [estimatedWaitMs]);

    const performLeave = useCallback(async () => {
        if (!code || !partyId) {
        return;
        }
        setLeaveLoading(true);
        try {
        await leaveQueue({ code, partyId });
        try {
          await storage.removeJoinedQueue(code);
        } catch (storageError) {
          console.warn('Failed to remove joined queue from storage', storageError);
        }
        Alert.alert('Left queue', 'You have left the queue.');
        navigation.replace('HomeScreen');
        } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to leave queue';
        Alert.alert('Unable to leave queue', message);
        } finally {
        setLeaveConfirmVisibleWeb(false);
        setLeaveLoading(false);
        }
    }, [code, partyId, navigation]);

    const cancelLeaveWeb = useCallback(() => {
        if (leaveLoading) {
        return;
        }
        setLeaveConfirmVisibleWeb(false);
    }, [leaveLoading]);

    const confirmLeave = useCallback(() => {
        if (!code || !partyId || leaveLoading) {
        return;
        }
        if (isWeb) {
        setLeaveConfirmVisibleWeb(true);
        return;
        }
        Alert.alert('Leave queue?', 'You will lose your place in line.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave Queue', style: 'destructive', onPress: () => void performLeave() },
        ]);
    }, [code, partyId, leaveLoading, performLeave, isWeb]);

    const handleReturnHome = useCallback(() => {
        navigation.replace('JoinQueueScreen', { id: 'new', code });
    }, [navigation, code]);

    const webLeaveModal = isWeb ? (
        <Modal
        visible={leaveConfirmVisibleWeb}
        transparent
        animationType="fade"
        onRequestClose={cancelLeaveWeb}>
        <View style={styles.webModalBackdrop}>
            <View style={styles.webModalCard}>
            <Text style={styles.webModalTitle}>Leave queue?</Text>
            <Text style={styles.webModalMessage}>
                You will lose your place in line. Are you sure you want to leave?
            </Text>
            <View style={styles.webModalActions}>
                <Pressable style={styles.webModalCancelButton} onPress={cancelLeaveWeb}>
                <Text style={styles.webModalCancelText}>Stay</Text>
                </Pressable>
                <Pressable
                style={[
                    styles.webModalConfirmButton,
                    leaveLoading ? styles.webModalConfirmButtonDisabled : undefined,
                ]}
                onPress={() => void performLeave()}
                disabled={leaveLoading}>
                {leaveLoading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.webModalConfirmText}>Leave Queue</Text>
                )}
                </Pressable>
            </View>
            </View>
        </View>
        </Modal>
    ) : null;

    return (
        <SafeAreaProvider style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>Your Spot</Text>

            <View style={styles.card}>
            <View style={styles.codeBadge}>
              <View style={styles.codeBadgeTextGroup}>
                <Text style={styles.codeBadgeLabel}>Queue Code</Text>
                <Text style={styles.codeBadgeValue}>{code}</Text>
              </View>
              <View
                style={[
                  styles.codeBadgeStatus,
                  isActive ? styles.codeBadgeStatusActive : styles.codeBadgeStatusComplete,
                ]}>
                <Text
                  style={[
                    styles.codeBadgeStatusText,
                    isActive
                      ? styles.codeBadgeStatusTextActive
                      : styles.codeBadgeStatusTextComplete,
                  ]}>
                  {isActive ? 'Active' : 'Finished'}
                </Text>
              </View>
            </View>
            <Text style={styles.statusText}>{statusText}</Text>
            {infoMessage ? <Text style={styles.infoText}>{infoMessage}</Text> : null}
            {isActive ? (
              <>
                <Text style={styles.connectionText}>{connectionLabel}</Text>
                {called ? <Text style={styles.calledText}>It’s your turn!</Text> : null}
                {called ? (
                  <View style={styles.timerRow}>
                    <Timer targetTimestamp={callDeadline} label="Time left" compact />
                  </View>
                ) : null}
                {isWeb ? (
                  <Pressable
                    style={[styles.pushButton, pushReady ? styles.pushButtonActive : undefined]}
                    onPress={() => enablePush()}
                    disabled={pushReady}>
                    <Text
                      style={[styles.pushButtonText, pushReady ? styles.pushButtonTextActive : undefined]}>
                      {pushReady ? 'Notifications On' : 'Enable Browser Alerts'}
                    </Text>
                  </Pressable>
                ) : null}
                {pushMessage ? <Text style={styles.metaText}>{pushMessage}</Text> : null}
              </>
            ) : null}
            </View>

            {isActive ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Queue Metrics</Text>
                <View style={styles.metricsGrid}>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Your Position</Text>
                    <Text style={styles.metricValue}>
                      {typeof position === 'number' ? `#${position}` : '—'}
                    </Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Ahead of You</Text>
                    <Text style={styles.metricValue}>
                      {aheadDisplay != null ? `${aheadDisplay}` : '—'}
                    </Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Queue Size</Text>
                    <Text style={styles.metricValue}>
                      {queueLengthDisplay != null ? `${queueLengthDisplay}` : '—'}
                    </Text>
                  </View>
                  <View style={styles.metricItem}>
                    <Text style={styles.metricLabel}>Est. Wait</Text>
                    <Text style={styles.metricValue}>{etaText}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your Party</Text>
            <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Name</Text>
                <Text style={styles.detailValue}>{guestName?.trim() || 'Anonymous'}</Text>
            </View>
            <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Party Size</Text>
                <Text style={styles.detailValue}>{partySize ?? '—'}</Text>
            </View>
            </View>

            {isActive ? (
            <View style={styles.actions}>
                <Pressable
                style={[styles.leaveButton, leaveLoading ? styles.leaveButtonDisabled : undefined]}
                onPress={confirmLeave}
                disabled={leaveLoading}>
                {leaveLoading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={styles.leaveButtonText}>Leave Queue</Text>
                )}
                </Pressable>
            </View>
            ) : (
            <View style={styles.actions}>
                <Pressable style={styles.secondaryButton} onPress={handleReturnHome}>
                <Text style={styles.secondaryButtonText}>Back to Join Screen</Text>
                </Pressable>
            </View>
            )}
        </ScrollView>
        {webLeaveModal}
        </SafeAreaProvider>
    );
}
