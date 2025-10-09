import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './HostQueueScreen.Styles';
import {
  advanceQueueHost,
  closeQueueHost,
  HostParty,
  HOST_COOKIE_NAME,
  buildHostConnectUrl,
} from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'HostQueueScreen'>;

type HostMessage =
  | { type: 'queue_update'; queue?: HostParty[]; nowServing?: HostParty | null }
  | Record<string, unknown>;

type ConnectionState = 'connecting' | 'open' | 'closed';

const RECONNECT_DELAY_MS = 3000;

export default function HostQueueScreen({ route }: Props) {
  const { code, sessionId, wsUrl, hostAuthToken } = route.params;

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [queue, setQueue] = useState<HostParty[]>([]);
  const [nowServing, setNowServing] = useState<HostParty | null>(null);
  const [closed, setClosed] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webSocketUrl = useMemo(
    () => buildHostConnectUrl(wsUrl, hostAuthToken),
    [wsUrl, hostAuthToken]
  );
  const hasHostAuth = Boolean(hostAuthToken);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as HostMessage;
        if (parsed.type === 'queue_update') {
          const queueEntries = Array.isArray(parsed.queue) ? parsed.queue : [];
          const serving = parsed.nowServing ?? null;
          setQueue(queueEntries);
          setNowServing(serving);
          if (queueEntries.length > 0 || serving) {
            setClosed(false);
          }
          setConnectionError(null);
        } else if (parsed.type === 'closed') {
          setQueue([]);
          setNowServing(null);
          setClosed(true);
        }
      } catch {
        // ignore malformed payloads
      }
    },
    []
  );

  const connect = useCallback(() => {
    if (!hasHostAuth) {
      setConnectionState('closed');
      setConnectionError(
        'Missing host authentication. Reopen the host controls on the device that created this queue.'
      );
      return;
    }

    clearReconnectTimeout();
    closeSocket();
    setConnectionState('connecting');
    setConnectionError(null);

    const socket = new WebSocket(webSocketUrl, undefined, {
      headers: {
        Cookie: `${HOST_COOKIE_NAME}=${hostAuthToken}`,
        'X-Host-Auth': hostAuthToken as string,
      },
    });
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('[HostQueueScreen] WebSocket open');
      setConnectionState('open');
      setConnectionError(null);
    };

    socket.onmessage = handleMessage;

    socket.onerror = (event) => {
      console.warn('[HostQueueScreen] WebSocket error', event);
      setConnectionError('WebSocket error. Attempting to reconnect…');
    };

    socket.onclose = (event) => {
      console.log('[HostQueueScreen] WebSocket closed', event.code, event.reason);
      setConnectionState('closed');
      if (!closed) {
        setConnectionError('Connection closed. Attempting to reconnect…');
      }
      if (hasHostAuth) {
        clearReconnectTimeout();
        reconnectTimeout.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      }
    };
  }, [
    hasHostAuth,
    clearReconnectTimeout,
    closeSocket,
    webSocketUrl,
    hostAuthToken,
    handleMessage,
    closed,
  ]);

  useEffect(() => {
    if (!hasHostAuth) {
      setConnectionState('closed');
       setConnectionError(
        'Missing host authentication. Reopen the host controls on the device that created this queue.'
       );
      return;
    }
    connect();
    return () => {
      clearReconnectTimeout();
      closeSocket();
    };
  }, [connect, clearReconnectTimeout, closeSocket, hasHostAuth]);

  const queueCount = queue.length;
  const connectionLabel =
    connectionState === 'open'
      ? 'Live'
      : connectionState === 'connecting'
      ? 'Connecting…'
      : 'Disconnected';

  const disabledAdvance =
    !hasHostAuth || actionLoading || closeLoading || closed || (queueCount === 0 && !nowServing);
  const disabledClose = !hasHostAuth || closeLoading || closed;

  const advance = useCallback(
    async (nextPartyId?: string) => {
      if (!hasHostAuth || actionLoading) {
        return;
      }
      setActionLoading(true);
      try {
        const result = await advanceQueueHost({
          code,
          hostAuthToken: hostAuthToken as string,
          servedPartyId: nowServing?.id,
          nextPartyId,
        });
        setNowServing(result.nowServing ?? null);
        setConnectionError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to advance queue';
        Alert.alert('Unable to advance', message);
      } finally {
        setActionLoading(false);
      }
    },
    [actionLoading, code, hasHostAuth, hostAuthToken, nowServing?.id]
  );

  const advanceSpecific = useCallback(
    (partyId: string) => {
      advance(partyId);
    },
    [advance]
  );

  const advanceCurrent = useCallback(() => {
    advance();
  }, [advance]);

  const handleCloseQueue = useCallback(() => {
    if (!hasHostAuth || closeLoading) {
      return;
    }
    const confirmClose = () => {
      setCloseLoading(true);
      closeQueueHost({ code, hostAuthToken: hostAuthToken as string })
        .then(() => {
          setClosed(true);
          setQueue([]);
          setNowServing(null);
          setConnectionError(null);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to close queue';
          Alert.alert('Unable to close queue', message);
        })
        .finally(() => {
          setCloseLoading(false);
        });
    };

    Alert.alert(
      'Close Queue',
      'Guests will no longer be able to join once closed. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close Queue', style: 'destructive', onPress: confirmClose },
      ],
      { cancelable: true }
    );
  }, [closeLoading, code, hasHostAuth, hostAuthToken]);

  const reconnectManually = useCallback(
    (event?: GestureResponderEvent) => {
      event?.preventDefault();
      connect();
    },
    [connect]
  );

  const renderQueueList = () => {
    if (queueCount === 0) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            {closed ? 'Queue closed.' : 'Queue is empty. Guests will appear here as they join.'}
          </Text>
        </View>
      );
    }

    return queue.map((party, index) => {
      const isLast = index === queueCount - 1;
      return (
        <View
          key={party.id}
          style={[styles.queueItem, isLast ? styles.queueItemLast : undefined]}>
          <Text style={styles.queueItemName}>
            {party.name?.trim() || 'Guest'} {party.size ? `(${party.size})` : ''}
          </Text>
          <Text style={styles.queueItemMeta}>
            Status: {party.status === 'waiting' ? 'Waiting' : 'Called'} ·{' '}
            {party.nearby ? 'Nearby' : 'Not nearby'}
          </Text>
          <Pressable
            style={styles.queueItemButton}
            onPress={() => advanceSpecific(party.id)}
            disabled={!hasHostAuth || actionLoading || closed}>
            {actionLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.queueItemButtonText}>Call This Party</Text>
            )}
          </Pressable>
        </View>
      );
    });
  };

  return (
    <SafeAreaProvider style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Host Console</Text>
          <Text style={styles.headerLine}>Queue code: {code}</Text>
          <Text style={styles.headerLine}>Session ID: {sessionId}</Text>
          <View style={styles.statusRow}>
            <Text
              style={[
                styles.statusBadge,
                closed ? styles.statusClosed : styles.statusActive,
              ]}>
              {closed ? 'Closed' : 'Active'}
            </Text>
            <Text style={styles.connectionText}>
              Connection: {connectionLabel}
            </Text>
          </View>
          {connectionError ? (
            <>
              <Text style={styles.connectionText}>{connectionError}</Text>
              {hasHostAuth ? (
                <Pressable style={styles.reconnectButton} onPress={reconnectManually}>
                  <Text style={styles.reconnectButtonText}>Reconnect</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {!hasHostAuth ? (
            <Text style={styles.connectionText}>
              Host authentication token missing. Create a queue on this device to control it.
            </Text>
          ) : null}
        </View>

        <View style={styles.nowServingCard}>
          <Text style={styles.nowServingHeading}>Now Serving</Text>
          <Text style={styles.nowServingValue}>
            {nowServing
              ? `${nowServing.name?.trim() || 'Guest'}${nowServing.size ? ` (${nowServing.size})` : ''}`
              : 'No party currently called.'}
          </Text>
        </View>

        <View style={styles.queueCard}>
          <ScrollView contentContainerStyle={styles.queueScroll}>{renderQueueList()}</ScrollView>
        </View>

        <View style={styles.queueActionsRow}>
          <Pressable
            style={[
              styles.primaryButton,
              disabledAdvance ? styles.primaryButtonDisabled : undefined,
            ]}
            disabled={disabledAdvance}
            onPress={advanceCurrent}>
            {actionLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {nowServing ? 'Mark Served & Call Next' : 'Call First Party'}
              </Text>
            )}
          </Pressable>

          <Pressable
            style={styles.destructiveButton}
            disabled={disabledClose}
            onPress={handleCloseQueue}>
            {closeLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Close Queue</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaProvider>
  );
}
