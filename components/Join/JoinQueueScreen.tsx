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
import * as Location from 'expo-location';
import type { RootStackParamList } from '../../types/navigation';
import styles from './JoinQueueScreen.Styles';
import {
  buildGuestConnectUrl,
  declareNearby,
  joinQueue,
  leaveQueue,
} from '../../lib/backend';
import type { QueueVenue } from '../../lib/backend';
import GuestQueueScreen, { GuestQueueEntry } from '../Guest/GuestQueueScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinQueueScreen'>;

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function computeDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function normalizeQueueEntry(raw: any): GuestQueueEntry | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
    return null;
  }
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    size: typeof raw.size === 'number' ? raw.size : undefined,
    status: raw.status === 'called' ? 'called' : 'waiting',
  };
}

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
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveConfirmVisibleWeb, setLeaveConfirmVisibleWeb] = useState(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const inQueue = Boolean(joinedCode && partyId);
  const isWeb = Platform.OS === 'web';
  const [callWindowSeconds, setCallWindowSeconds] = useState<number | null>(null);
  const [venue, setVenue] = useState<QueueVenue | null>(null);
  const [presenceDeclared, setPresenceDeclared] = useState(false);
  const [declaringPresence, setDeclaringPresence] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [locationMonitoring, setLocationMonitoring] = useState(false);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const [foregroundPermission, requestForegroundPermission] = Location.useForegroundPermissions();
  const [queueEntries, setQueueEntries] = useState<GuestQueueEntry[]>([]);
  const [nowServingEntry, setNowServingEntry] = useState<GuestQueueEntry | null>(null);
  const [callDeadline, setCallDeadline] = useState<number | null>(null);
  const [callTimerSeconds, setCallTimerSeconds] = useState<number | null>(null);
  const [callTimerKey, setCallTimerKey] = useState(0);
  const [position, setPosition] = useState<number | null>(null);
  const [aheadCount, setAheadCount] = useState<number | null>(null);
  const geofenceRadiusMeters = venue?.radiusMeters ?? 100;
  const distanceMeters = useMemo(() => {
    if (!venue || !currentCoords) {
      return null;
    }
    return computeDistanceMeters(
      venue.latitude,
      venue.longitude,
      currentCoords.latitude,
      currentCoords.longitude
    );
  }, [venue, currentCoords]);
  const withinRadius =
    typeof distanceMeters === 'number' ? distanceMeters <= geofenceRadiusMeters : false;
  const callWindowMinutesDisplay = callWindowSeconds
    ? Math.max(1, Math.round(callWindowSeconds / 60))
    : null;
  const combinedQueue = useMemo(() => {
    const entries: GuestQueueEntry[] = [];
    if (nowServingEntry) {
      entries.push(nowServingEntry);
    }
    if (queueEntries.length > 0) {
      entries.push(...queueEntries);
    }
    return entries;
  }, [nowServingEntry, queueEntries]);
  const nowServingId = nowServingEntry?.id ?? null;
  const declareDisabled =
    !withinRadius || declaringPresence || presenceDeclared || !joinedCode || !partyId;

  useEffect(() => {
    if (partyId && nowServingId && nowServingId === partyId && callDeadline) {
      const seconds = Math.max(0, Math.round((callDeadline - Date.now()) / 1000));
      setCallTimerSeconds(seconds);
      setCallTimerKey((key) => key + 1);
    } else {
      setCallTimerSeconds(null);
    }
  }, [partyId, nowServingId, callDeadline]);

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
    setCallWindowSeconds(null);
    setVenue(null);
    setPresenceDeclared(false);
    setDeclaringPresence(false);
    setQueueEntries([]);
    setNowServingEntry(null);
    setCallDeadline(null);
    setCallTimerSeconds(null);
    setPosition(null);
    setAheadCount(null);
    try {
      const joinResult = await joinQueue({
        code: trimmed,
        name,
        size: partySize,
      });
      setResultText(`You're number ${joinResult.position} in line. We'll keep this updated.`);
      setJoinedCode(trimmed);
      setPartyId(joinResult.partyId);
      setCallWindowSeconds(joinResult.callTimeoutSeconds);
      setVenue(joinResult.venue ?? null);
      setPresenceDeclared(false);
      setPosition(joinResult.position);
      setAheadCount(Math.max(0, joinResult.position - 1));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error joining queue';
      Alert.alert('Unable to join queue', message);
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

  const stopLocationUpdates = useCallback(() => {
    if (locationWatchRef.current) {
      try {
        locationWatchRef.current.remove();
      } catch {
        // ignore watcher errors
      }
      locationWatchRef.current = null;
    }
    setLocationMonitoring(false);
    setCurrentCoords(null);
  }, []);

  const startLocationUpdates = useCallback(async () => {
    if (locationWatchRef.current || !venue) {
      return;
    }
    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 4000,
          distanceInterval: 5,
        },
        (position) => {
          setCurrentCoords(position.coords);
        }
      );
      locationWatchRef.current = subscription;
      setLocationMonitoring(true);
    } catch (error) {
      console.warn('Failed to start location updates', error);
      Alert.alert('Location unavailable', 'Unable to monitor your location right now.');
    }
  }, [venue]);

  const enableLocation = useCallback(async () => {
    if (!venue) {
      Alert.alert('Location unavailable', 'Join a queue first to share your location.');
      return;
    }
    if (foregroundPermission?.granted) {
      await startLocationUpdates();
      return;
    }
    const permission = await requestForegroundPermission();
    if (permission?.granted) {
      await startLocationUpdates();
    } else {
      Alert.alert(
        'Location needed',
        'Turn on location permissions to prove you are near the restaurant.'
      );
    }
  }, [foregroundPermission?.granted, requestForegroundPermission, startLocationUpdates, venue]);

  const handleDeclarePresence = useCallback(async () => {
    if (!joinedCode || !partyId) {
      return;
    }
    const radius = venue?.radiusMeters ?? 100;
    const distance =
      currentCoords && venue
        ? computeDistanceMeters(
            venue.latitude,
            venue.longitude,
            currentCoords.latitude,
            currentCoords.longitude
          )
        : null;
    if (distance === null || distance > radius) {
      Alert.alert('Move closer', 'Get a little closer to the restaurant before checking in.');
      return;
    }
    setDeclaringPresence(true);
    try {
      await declareNearby({ code: joinedCode, partyId });
      setPresenceDeclared(true);
      setResultText('Thanks! The host knows you are nearby.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to declare presence';
      Alert.alert('Unable to declare presence', message);
    } finally {
      setDeclaringPresence(false);
    }
  }, [joinedCode, partyId, venue, currentCoords, setResultText]);

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
      setConnectionState('idle');
      setCallWindowSeconds(null);
      setVenue(null);
      setPresenceDeclared(false);
      setDeclaringPresence(false);
      setQueueEntries([]);
      setNowServingEntry(null);
      setCallDeadline(null);
      setCallTimerSeconds(null);
      setCallTimerKey((key) => key + 1);
      stopLocationUpdates();
      if (message !== undefined) {
        setResultText(message);
      }
    },
    [clearReconnect, closeActiveSocket, stopLocationUpdates]
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
                setPosition(position);
                setAheadCount(Number.isNaN(aheadCount) ? null : Math.max(0, aheadCount));
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
            case 'queue_snapshot': {
              const queueList = Array.isArray(data.queue)
                ? (data.queue as unknown[]).map((entry) => normalizeQueueEntry(entry)).filter(
                    (entry): entry is QueueEntry => Boolean(entry)
                  )
                : [];
              setQueueEntries(queueList);
              const nowServingData =
                data.nowServing && typeof data.nowServing === 'object'
                  ? normalizeQueueEntry(data.nowServing)
                  : null;
              setNowServingEntry(nowServingData && nowServingData.status === 'called' ? nowServingData : null);
              const deadline =
                typeof data.callDeadline === 'number' && Number.isFinite(data.callDeadline)
                  ? data.callDeadline
                  : null;
              setCallDeadline(deadline);
              if (typeof data.callTimeoutSeconds === 'number') {
                setCallWindowSeconds(data.callTimeoutSeconds);
              }
              break;
            }
            case 'called': {
              setResultText("You're being served now! Please head to the host.");
              const expiresAt =
                typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt)
                  ? data.expiresAt
                  : null;
              setCallDeadline(expiresAt);
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

  useEffect(() => {
    return () => {
      clearReconnect();
      closeActiveSocket();
      stopLocationUpdates();
    };
  }, [clearReconnect, closeActiveSocket, stopLocationUpdates]);

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

          {!inQueue ? (
            <View style={styles.card}>
              <Text style={styles.label}>Enter Key</Text>
              <TextInput
                placeholder="Value"
                value={key}
                onChangeText={setKey}
                style={styles.input}
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
                style={styles.input}
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

              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.button, loading ? styles.buttonDisabled : undefined]}
                  onPress={onSubmit}
                  disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Join Queue</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <GuestQueueScreen
              partyId={partyId as string}
              resultText={resultText}
              connectionLabel={connectionLabel}
              position={position}
              aheadCount={aheadCount}
              combinedQueue={combinedQueue}
              callTimerSeconds={callTimerSeconds}
              callTimerKey={callTimerKey}
              callWindowMinutes={callWindowMinutesDisplay}
              venue={venue}
              distanceMeters={distanceMeters}
              geofenceRadiusMeters={geofenceRadiusMeters}
              locationMonitoring={locationMonitoring}
              presenceDeclared={presenceDeclared}
              declaringPresence={declaringPresence}
              declareDisabled={declareDisabled}
              onLeavePress={confirmLeave}
              leaveLoading={leaveLoading}
              onEnableLocationPress={enableLocation}
              onDeclarePresence={handleDeclarePresence}
            />
          )}

          {!inQueue && resultText ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultText}>{resultText}</Text>
              <Text style={styles.resultHint}>{connectionLabel}</Text>
            </View>
          ) : null}
              <Text style={styles.queueTitle}>Queue Overview</Text>
              {combinedQueue.map((party, index) => {
                const isSelf = partyId === party.id;
                const isServing = party.status === 'called';
                const displayName = party.name?.trim().length ? party.name?.trim() : 'Guest';
                return (
                  <View
                    key={`${party.id}-${index}`}
                    style={[
                      styles.queueRow,
                      isSelf ? styles.queueRowSelf : undefined,
                      isServing ? styles.queueRowCalled : undefined,
                    ]}>
                    <Text style={styles.queuePosition}>{index + 1}</Text>
                    <View style={styles.queueRowInfo}>
                      <Text style={styles.queueRowName}>
                        {displayName}
                        {isSelf ? ' (You)' : ''}
                      </Text>
                      <Text style={styles.queueRowMeta}>
                        {isServing ? 'With host' : 'Waiting'}
                        {party.size ? ` · Party of ${party.size}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
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
