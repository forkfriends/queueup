import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Turnstile } from '@marsidev/react-turnstile';
import type { RootStackParamList } from '../../types/navigation';
import styles from './JoinQueueScreen.Styles';
import { buildGuestConnectUrl, joinQueue, leaveQueue, getVapidPublicKey, savePushSubscription, API_BASE_URL } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinQueueScreen'>;

const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 10;
const DEFAULT_QUEUE_SIZE = 1;

export default function JoinQueueScreen({ navigation, route }: Props) {
  const routeCode =
    route.params?.code && route.params.code.trim().length > 0
      ? route.params.code.trim().toUpperCase().slice(-6)
      : '';
  const [key, setKey] = useState(routeCode);
  const [name, setName] = useState('');
  const [partySize, setPartySize] = useState<number>(DEFAULT_QUEUE_SIZE);
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed'>(
    'idle'
  );
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pushReady, setPushReady] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveConfirmVisibleWeb, setLeaveConfirmVisibleWeb] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const autoPushAttemptRef = useRef<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const turnstileRef = useRef<any>(null);
  const inQueue = Boolean(joinedCode && partyId);
  const isWeb = Platform.OS === 'web';

  useEffect(() => {
    if (!route.params?.code || inQueue) {
      return;
    }
    const normalized = route.params.code.trim().toUpperCase().slice(-6);
    if (!normalized) {
      return;
    }
    setKey((current) => (current === normalized ? current : normalized));
  }, [route.params?.code, inQueue]);

  const onSubmit = async () => {
    if (loading) return;
    if (inQueue) {
      Alert.alert('Already in a queue', 'Please leave your current queue before joining another.');
      return;
    }
    const trimmed = key.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert('Enter queue code', 'Please enter the queue key to continue.');
      return;
    }

    setLoading(true);
    setResultText(null);
    setJoinedCode(null);
    setPartyId(null);
    setConnectionState('idle');

    // Debug: Log turnstile token status
    console.log('[QueueUp][join] Turnstile token:', turnstileToken ? 'present' : 'MISSING', turnstileToken?.substring(0, 20));

    try {
      const joinResult = await joinQueue({
        code: trimmed,
        name,
        size: partySize,
        turnstileToken: turnstileToken ?? undefined,
      });
      setResultText(`You're number ${joinResult.position} in line. We'll keep this updated.`);
      setJoinedCode(trimmed);
      setPartyId(joinResult.partyId);
      setSessionId(joinResult.sessionId ?? null);
      // Reset Turnstile for next use
      setTurnstileToken(null);
      if (turnstileRef.current?.reset) {
        turnstileRef.current.reset();
      }
      // Debug: log identifiers for wrangler-side push testing
      if (typeof window !== 'undefined' && (window as any).console) {
        console.log('[QueueUp][join]', {
          ts: new Date().toISOString(),
          sessionId: joinResult.sessionId ?? null,
          partyId: joinResult.partyId,
          code: trimmed,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error joining queue';

      // Check if it's a Turnstile verification error
      if (message.includes('Turnstile verification') || message.includes('verification required')) {
        Alert.alert(
          'Verification Required',
          'Please complete the Cloudflare security check above before joining the queue.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Unable to join queue', message);
      }

      // Reset Turnstile on error
      setTurnstileToken(null);
      if (turnstileRef.current?.reset) {
        turnstileRef.current.reset();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCloseScanner = () => {
    setScannerActive(false);
    setScannerVisible(false);
  };

  const handleOpenScanner = async () => {
    if (cameraPermission?.granted) {
      setScannerVisible(true);
      setScannerActive(true);
      return;
    }

    if (cameraPermission && !cameraPermission.canAskAgain && !cameraPermission.granted) {
      Alert.alert(
        'Camera access needed',
        'Enable camera permissions in your device settings to scan QR codes.'
      );
      return;
    }

    const permissionResult = await requestCameraPermission();
    if (permissionResult?.granted) {
      setScannerVisible(true);
      setScannerActive(true);
    } else {
      Alert.alert(
        'Camera access needed',
        'Enable camera permissions in your device settings to scan QR codes.'
      );
    }
  };

  const handleBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (!scannerActive) {
      return;
    }
    const scanned = typeof data === 'string' ? data.trim() : '';
    if (!scanned) {
      return;
    }

    setScannerActive(false);
    setKey(scanned.toUpperCase().slice(-6)); // use last 6 chars as key
    setScannerVisible(false);
  };

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const closeActiveSocket = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close(1000, 'client_closed');
      } catch {
        // ignore socket close errors
      }
      socketRef.current = null;
    }
  }, []);

  const resetSession = useCallback(
    (message?: string) => {
      shouldReconnectRef.current = false;
      clearReconnect();
      closeActiveSocket();
      reconnectAttempt.current = 0;
      setJoinedCode(null);
      setPartyId(null);
      setSessionId(null);
      setPushReady(false);
      setPushMessage(null);
      autoPushAttemptRef.current = null;
      setConnectionState('idle');
      if (message !== undefined) {
        setResultText(message);
      }
    },
    [clearReconnect, closeActiveSocket]
  );

  useEffect(() => {
    if (!joinedCode || !partyId) {
      return;
    }

    shouldReconnectRef.current = true;
    const wsUrl = buildGuestConnectUrl(joinedCode, partyId);

    const connect = () => {
      clearReconnect();
      closeActiveSocket();
      setConnectionState('connecting');

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;
      socket.onopen = () => {
        setConnectionState('open');
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          switch (data.type) {
            case 'position': {
              const position = Number(data.position);
              const aheadCount = Number(data.aheadCount);
              if (!Number.isNaN(position)) {
                setResultText(
                  aheadCount >= 0
                    ? `You're number ${position} in line. ${aheadCount} ${
                        aheadCount === 1 ? 'party' : 'parties'
                      } ahead of you.`
                    : `You're number ${position} in line.`
                );
              }
              break;
            }
            case 'called': {
              setResultText("You're being served now! Please head to the host.");
              break;
            }
            case 'removed': {
              const reason = data.reason;
              const reasonMessages: Record<string, string> = {
                served: 'All set! You have been marked as served.',
                no_show: "We couldn't reach you, so you were removed from the queue.",
                kicked: 'The host removed you from the queue.',
                closed: 'Queue closed. Thanks for your patience!',
              };
              const message = reasonMessages[reason as string] ?? 'You have left the queue.';
              resetSession(message);
              break;
            }
            case 'closed': {
              resetSession('Queue closed by the host. Thanks for waiting with us!');
              break;
            }
            default:
              break;
          }
        } catch (err) {
          console.warn('Failed to parse guest WS payload', err);
        }
      };
      socket.onclose = (event) => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setConnectionState('closed');
        if (shouldReconnectRef.current && event.code !== 1000) {
          clearReconnect();
          reconnectTimer.current = setTimeout(() => {
            reconnectAttempt.current += 1;
            connect();
          }, 2000);
        }
      };
      socket.onerror = () => {
        setConnectionState('closed');
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnect();
      closeActiveSocket();
    };
  }, [joinedCode, partyId, clearReconnect, closeActiveSocket, resetSession]);

  const enablePush = useCallback(
    async (options?: { sessionOverride?: string | null; partyOverride?: string | null; silent?: boolean }) => {
      if (Platform.OS !== 'web') {
        return;
      }
      const targetSession = options?.sessionOverride ?? sessionId;
      const targetParty = options?.partyOverride ?? partyId;
      if (!targetSession || !targetParty) {
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
          Alert.alert('Push not supported', 'This browser does not support web push notifications.');
        }
        return;
      }
      try {
        setPushMessage('Enabling notifications…');
        const publicKey = await getVapidPublicKey();
        if (!publicKey) {
          throw new Error('Missing VAPID key');
        }
        const b64ToU8 = (b64: string) =>
          Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
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
                'Enable notifications in your browser settings to receive alerts.'
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
          sessionId: targetSession,
          partyId: targetParty,
          subscription: subscription.toJSON?.() ?? (subscription as any),
        });
        console.log('[QueueUp][push] saved subscription', {
          endpoint: subscription.endpoint,
          apiBase: API_BASE_URL,
          sessionId: targetSession,
          partyId: targetParty,
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
    return () => {
      clearReconnect();
      closeActiveSocket();
    };
  }, [clearReconnect, closeActiveSocket]);

  useEffect(() => {
    if (!isWeb || !sessionId || !partyId || pushReady) {
      return;
    }
    const key = `${sessionId}:${partyId}`;
    if (autoPushAttemptRef.current === key) {
      return;
    }
    autoPushAttemptRef.current = key;
    enablePush({ sessionOverride: sessionId, partyOverride: partyId, silent: true }).catch(() => {
      // Errors are surfaced through pushMessage state; no-op here to avoid unhandled rejections.
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

  const performLeave = useCallback(async () => {
    if (!joinedCode || !partyId) {
      return;
    }
    setLeaveLoading(true);
    try {
      await leaveQueue({ code: joinedCode, partyId });
      resetSession('You have left the queue.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to leave queue';
      Alert.alert('Unable to leave queue', message);
    } finally {
      setLeaveConfirmVisibleWeb(false);
      setLeaveLoading(false);
    }
  }, [joinedCode, partyId, resetSession]);

  const cancelLeaveWeb = useCallback(() => {
    if (leaveLoading) {
      return;
    }
    setLeaveConfirmVisibleWeb(false);
  }, [leaveLoading]);

  const confirmLeave = useCallback(() => {
    if (!joinedCode || !partyId || leaveLoading) {
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
  }, [joinedCode, partyId, leaveLoading, performLeave, isWeb]);

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
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Join Queue</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Enter Key</Text>
            <TextInput
              placeholder="Value"
              value={key}
              onChangeText={setKey}
              style={[styles.input, inQueue ? styles.inputDisabled : undefined]}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!inQueue}
              returnKeyType="done"
            />
            <Pressable style={styles.scanButton} onPress={handleOpenScanner}>
              <Text style={styles.scanButtonText}>Scan QR Code</Text>
            </Pressable>

            <Text style={styles.label}>Your Name</Text>
            <TextInput
              placeholder="(optional)"
              value={name}
              onChangeText={setName}
              style={[styles.input, inQueue ? styles.inputDisabled : undefined]}
              editable={!inQueue}
              returnKeyType="next"
            />

            <Text style={styles.label}>Party Size</Text>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderValue}>{partySize}</Text>
              <Text style={styles.sliderHint}>guests</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={MIN_QUEUE_SIZE}
              maximumValue={MAX_QUEUE_SIZE}
              step={1}
              value={partySize}
              minimumTrackTintColor="#1f6feb"
              maximumTrackTintColor="#d0d7de"
              thumbTintColor="#1f6feb"
              onValueChange={(value) => setPartySize(Math.round(value))}
            />

            {isWeb && !inQueue && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ? (
              <View style={{ marginVertical: 16, alignItems: 'center' }}>
                <Turnstile
                  ref={turnstileRef}
                  siteKey={process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY}
                  onSuccess={(token) => {
                    console.log('[QueueUp][Turnstile] Token received:', token?.substring(0, 30));
                    setTurnstileToken(token);
                  }}
                  onError={(error) => {
                    console.error('[QueueUp][Turnstile] Error:', error);
                    setTurnstileToken(null);
                  }}
                  onExpire={() => {
                    console.warn('[QueueUp][Turnstile] Token expired');
                    setTurnstileToken(null);
                  }}
                  onWidgetLoad={(widgetId) => {
                    console.log('[QueueUp][Turnstile] Widget loaded:', widgetId);
                  }}
                  options={{
                    theme: 'auto',
                    size: 'normal',
                  }}
                />
              </View>
            ) : null}

            {isWeb && !inQueue && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken ? (
              <Text style={{ textAlign: 'center', color: '#586069', fontSize: 14, marginBottom: 12 }}>
                Complete the verification above to join
              </Text>
            ) : null}

            <View style={styles.actionsRow}>
              {inQueue ? (
                <Pressable
                  style={[
                    styles.leaveButton,
                    leaveLoading ? styles.leaveButtonDisabled : undefined,
                  ]}
                  onPress={confirmLeave}
                  disabled={leaveLoading}>
                  {leaveLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Leave Queue</Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  style={[
                    styles.button,
                    (loading || (isWeb && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken))
                      ? styles.buttonDisabled
                      : undefined
                  ]}
                  onPress={onSubmit}
                  disabled={loading || inQueue || (isWeb && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)}>
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Join Queue</Text>
                  )}
                </Pressable>
              )}
            </View>
          </View>

          {resultText ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultText}>{resultText}</Text>
              {inQueue ? <Text style={styles.resultHint}>{connectionLabel}</Text> : null}
              {isWeb && inQueue && pushMessage ? (
                <Text style={styles.resultHint}>{pushMessage}</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={scannerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleCloseScanner}>
        <SafeAreaView style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scannerActive ? handleBarcodeScanned : undefined}
          />
          <View style={styles.scannerControls}>
            <Text style={styles.scannerHint}>Align the QR code with the frame to fill the key.</Text>
            <Pressable style={styles.scannerCloseButton} onPress={handleCloseScanner}>
              <Text style={styles.scannerCloseText}>Close</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
      {webLeaveModal}
    </SafeAreaProvider>
  );
}
