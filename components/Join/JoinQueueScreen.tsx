import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { buildGuestConnectUrl, joinQueue } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinQueueScreen'>;

const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 10;
const DEFAULT_QUEUE_SIZE = 1;

export default function JoinQueueScreen({ navigation }: Props) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState('1');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'open' | 'closed'>(
    'idle'
  );
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [maxSize, setMaxSize] = useState<number>(DEFAULT_QUEUE_SIZE);

  const onCancel = () => navigation.goBack();

  const onSubmit = async () => {
    if (loading) return;
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
        size: Number.parseInt(size, 10) || undefined,
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

  const clearReconnect = () => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  };

  useEffect(() => {
    if (!joinedCode || !partyId) {
      return;
    }

    shouldReconnectRef.current = true;
    const wsUrl = buildGuestConnectUrl(joinedCode, partyId);
    let socket: WebSocket | null = null;

    const connect = () => {
      clearReconnect();
      setConnectionState('connecting');

      socket = new WebSocket(wsUrl);
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
              shouldReconnectRef.current = false;
              const reason = data.reason;
              if (reason === 'served') {
                setResultText('All set! You have been marked as served.');
              } else if (reason === 'no_show') {
                setResultText("We couldn't reach you, so you were removed from the queue.");
              } else if (reason === 'kicked') {
                setResultText('The host removed you from the queue.');
              } else if (reason === 'closed') {
                setResultText('Queue closed. Thanks for your patience!');
              } else {
                setResultText('You have left the queue.');
              }
              break;
            }
            case 'closed': {
              shouldReconnectRef.current = false;
              setResultText('Queue closed by the host. Thanks for waiting with us!');
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
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    };
  }, [joinedCode, partyId]);

  useEffect(() => {
    return () => clearReconnect();
  }, []);

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
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
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
              returnKeyType="next"
            />

            <Text style={styles.label}>Party Size</Text>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderValue}>{maxSize}</Text>
              <Text style={styles.sliderHint}>guests</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={MIN_QUEUE_SIZE}
              maximumValue={MAX_QUEUE_SIZE}
              step={1}
              value={maxSize}
              minimumTrackTintColor="#1f6feb"
              maximumTrackTintColor="#d0d7de"
              thumbTintColor="#1f6feb"
              onValueChange={(value) => setMaxSize(Math.round(value))}
            />

            <View style={styles.actionsRow}>
              <Pressable style={styles.cancelBox} onPress={onCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>

              <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Join Queue</Text>
                )}
              </Pressable>
            </View>
          </View>

          {resultText ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultText}>{resultText}</Text>
              <Text style={styles.resultHint}>{connectionLabel}</Text>
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
    </SafeAreaProvider>
  );
}
