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
import type { RootStackParamList } from '../../types/navigation';
import styles from './JoinQueueScreen.Styles';
import { buildGuestConnectUrl, joinQueue, leaveQueue } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinQueueScreen'>;

const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 10;
const DEFAULT_QUEUE_SIZE = 1;

export default function JoinQueueScreen({ navigation }: Props) {
  const [key, setKey] = useState('');
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
    try {
      const joinResult = await joinQueue({
        code: trimmed,
        name,
        size: partySize,
      });
      setResultText(`You're number ${joinResult.position} in line. We'll keep this updated.`);
      setJoinedCode(trimmed);
      setPartyId(joinResult.partyId);
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
              const message =
                reason === 'served'
                  ? 'All set! You have been marked as served.'
                  : reason === 'no_show'
                    ? "We couldn't reach you, so you were removed from the queue."
                    : reason === 'kicked'
                      ? 'The host removed you from the queue.'
                      : reason === 'closed'
                        ? 'Queue closed. Thanks for your patience!'
                        : 'You have left the queue.';
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
    };
  }, [clearReconnect, closeActiveSocket]);

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
                  style={[styles.button, loading ? styles.buttonDisabled : undefined]}
                  onPress={onSubmit}
                  disabled={loading || inQueue}>
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
