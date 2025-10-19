import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import type { RootStackParamList } from '../../types/navigation';
import styles from './HostQueueScreen.Styles';
import {
  advanceQueueHost,
  closeQueueHost,
  HostParty,
  buildHostConnectUrl,
} from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'HostQueueScreen'>;

type HostMessage =
  | { type: 'queue_update'; queue?: HostParty[]; nowServing?: HostParty | null; maxGuests?: number }
  | Record<string, unknown>;

type ConnectionState = 'connecting' | 'open' | 'closed';

const RECONNECT_DELAY_MS = 3000;

type QRCodeRef = {
  toDataURL?: (callback: (data: string) => void) => void;
};

export default function HostQueueScreen({ route }: Props) {
  const {
    code,
    sessionId,
    wsUrl,
    hostAuthToken: initialHostAuthToken,
    joinUrl,
    eventName,
    maxGuests: initialMaxGuests,
  } = route.params;
  const storageKey = `queueup-host-auth:${sessionId}`;

  const displayEventName = eventName?.trim() || null;
  const [capacity, setCapacity] = useState<number | null>(
    typeof initialMaxGuests === 'number' ? initialMaxGuests : null
  );

  const [hostToken, setHostToken] = useState<string | undefined>(() => {
    if (initialHostAuthToken) {
      return initialHostAuthToken;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.sessionStorage.getItem(storageKey) ?? undefined;
    }
    return undefined;
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [queue, setQueue] = useState<HostParty[]>([]);
  const [nowServing, setNowServing] = useState<HostParty | null>(null);
  const [closed, setClosed] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [savingQr, setSavingQr] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrCodeRef = useRef<QRCodeRef | null>(null);

  useEffect(() => {
    if (!initialHostAuthToken) {
      return;
    }
    setHostToken(initialHostAuthToken);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(storageKey, initialHostAuthToken);
      } catch {
        // Ignore storage errors in restricted environments
      }
    }
  }, [initialHostAuthToken, storageKey]);

  const webSocketUrl = useMemo(() => buildHostConnectUrl(wsUrl, hostToken), [wsUrl, hostToken]);
  const hasHostAuth = Boolean(hostToken);
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

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

  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== 'string') {
      return;
    }
    try {
      const parsed = JSON.parse(event.data) as HostMessage;
      if (parsed.type === 'queue_update') {
        const queueEntries = Array.isArray(parsed.queue)
          ? (parsed.queue as HostParty[])
          : [];
        const serving = (parsed.nowServing ?? null) as HostParty | null;
        setQueue(queueEntries);
        setNowServing(serving);
        if (typeof parsed.maxGuests === 'number') {
          setCapacity(parsed.maxGuests);
        }
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
  }, []);

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

    const socket = new WebSocket(webSocketUrl);
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
    hostToken,
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
  const shareableLink = joinUrl ?? null;

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
          hostAuthToken: hostToken as string,
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
  [actionLoading, code, hasHostAuth, hostToken, nowServing?.id]
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

  const handleShareQr = useCallback(async () => {
    if (!shareableLink) {
      return;
    }
    try {
      await Share.share({
        message: `Join our queue with code ${code}: ${shareableLink}`,
        url: shareableLink,
        title: 'Join our queue',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to share QR code.';
      Alert.alert('Share failed', message);
    }
  }, [code, shareableLink]);

  const handleSaveQr = useCallback(async () => {
    if (!shareableLink || !qrCodeRef.current || savingQr) {
      if (!qrCodeRef.current) {
        Alert.alert('QR unavailable', 'Generate the QR code again and try saving.');
      }
      return;
    }

    const ensurePermission = async () => {
      if (mediaPermission?.granted) {
        return true;
      }
      try {
        // Use requestMediaPermission consistently for requesting media permissions.
        const response = await requestMediaPermission();
        return response?.granted ?? false;
      } catch (err) {
        console.warn('Media permission request failed', err);
        return false;
      }
    };

    const hasPermission = await ensurePermission();
    if (!hasPermission) {
      Alert.alert('Access needed', 'Allow photo library access to save the QR code image.');
      return;
    }

    setSavingQr(true);
    try {
      if (typeof qrCodeRef.current?.toDataURL !== 'function') {
        throw new Error('Saving QR codes is not supported on this device.');
      }

      const base64 = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Timed out generating QR image data.'));
          }
        }, 3000);

        try {
          qrCodeRef.current?.toDataURL?.((data: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(data);
          });
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(err);
          }
        }
      });

      // Prefer cacheDirectory for temporary storage of the QR code image before moving it to the user's photo library.
      // cacheDirectory is used because the file only needs to persist long enough to be imported into MediaLibrary,
      // and using cacheDirectory avoids cluttering documentDirectory with temporary files.
      // If cacheDirectory is unavailable, fall back to documentDirectory.
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) {
        throw new Error('No writable directory available to save the QR code.');
      }
      const fileUri = `${directory}queue-${code}.png`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      const album = await MediaLibrary.getAlbumAsync('QueueUp');
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync('QueueUp', asset, false);
      }
      Alert.alert('Saved', 'QR code saved to your photos.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save QR code.';
      Alert.alert('Save failed', message);
    } finally {
      setSavingQr(false);
    }
  }, [code, mediaPermission, requestMediaPermission, savingQr, shareableLink]);

  const handleCloseQueue = useCallback(() => {
    if (!hasHostAuth || closeLoading) {
      return;
    }
    const confirmClose = () => {
      setCloseLoading(true);
  closeQueueHost({ code, hostAuthToken: hostToken as string })
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
  }, [closeLoading, code, hasHostAuth, hostToken]);

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
        <View key={party.id} style={[styles.queueItem, isLast ? styles.queueItemLast : undefined]}>
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
          {displayEventName ? (
            <Text style={styles.headerEvent} numberOfLines={2} ellipsizeMode="tail">
              {displayEventName}
            </Text>
          ) : null}
          {typeof capacity === 'number' ? (
            <Text style={styles.headerLine}>Guest capacity: {capacity}</Text>
          ) : null}
          <Text style={styles.headerLine}>Queue code: {code}</Text>
          <Text style={styles.headerLine}>Session ID: {sessionId}</Text>
          {shareableLink ? (
            <Text style={styles.headerLine} numberOfLines={1} ellipsizeMode="middle">
              Guest link: {shareableLink}
            </Text>
          ) : null}
          <View style={styles.statusRow}>
            <Text style={[styles.statusBadge, closed ? styles.statusClosed : styles.statusActive]}>
              {closed ? 'Closed' : 'Active'}
            </Text>
            <Text style={styles.connectionText}>Connection: {connectionLabel}</Text>
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

        {shareableLink ? (
          <View style={styles.qrCard}>
            <Text style={styles.qrHeading}>Guest QR Code</Text>
            <View style={styles.qrCodeWrapper}>
              <QRCode
                value={shareableLink}
                size={180}
                getRef={(ref) => {
                  qrCodeRef.current = ref;
                }}
              />
            </View>
            <Text style={styles.qrHint}>Have guests scan to join instantly.</Text>
            <View style={styles.qrActions}>
              <Pressable style={styles.qrShareButton} onPress={handleShareQr}>
                <Text style={styles.qrShareText}>Share QR Link</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.qrSaveButton,
                  savingQr ? styles.qrButtonDisabled : undefined,
                ]}
                onPress={handleSaveQr}
                disabled={savingQr}>
                {savingQr ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <Text style={styles.qrSaveText}>Save to Photos</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

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
