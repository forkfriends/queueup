import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './MakeQueueScreen.Styles';
import { createQueue, CreateQueueResult } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'MakeQueueScreen'>;

export default function MakeQueueScreen({ navigation }: Props) {
  const [location, setLocation] = useState('');
  const [maxSize, setMaxSize] = useState('');
  const [hours, setHours] = useState('');
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateQueueResult | null>(null);

  const openHostControls = () => {
    if (!result) return;
    navigation.navigate('HostQueueScreen', {
      code: result.code,
      sessionId: result.sessionId,
      wsUrl: result.wsUrl,
      hostAuthToken: result.hostAuthToken,
    });
  };

  const onSubmit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const created = await createQueue();
      setResult(created);
      Alert.alert('Queue Created', `Share this code with guests: ${created.code}`, [
        { text: 'OK' },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error creating queue';
      Alert.alert('Unable to create queue', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaProvider style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Make Queue</Text>

          <View style={styles.card}>
            {/* Location */}
            <Text style={styles.label}>Location</Text>
            <TextInput
              placeholder="Value"
              value={location}
              onChangeText={setLocation}
              style={styles.input}
              returnKeyType="next"
            />

            {/* Max Queue Size */}
            <Text style={styles.label}>Max Queue Size</Text>
            <TextInput
              placeholder="Value"
              value={maxSize}
              onChangeText={setMaxSize}
              style={styles.input}
              keyboardType="number-pad"
              returnKeyType="next"
            />

            {/* Open Hours */}
            <Text style={styles.label}>Open Hours</Text>
            <TextInput
              placeholder="Value"
              value={hours}
              onChangeText={setHours}
              style={styles.input}
              returnKeyType="next"
            />

            {/* Contact Info */}
            <Text style={styles.label}>Contact Info</Text>
            <TextInput
              placeholder="Value"
              value={contact}
              onChangeText={setContact}
              style={[styles.input, styles.textArea]}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* Submit */}
            <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Create Queue</Text>
              )}
            </Pressable>
          </View>

          {result ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultHeading}>Queue Ready</Text>
              <Text style={styles.resultLine}>
                Code: <Text style={styles.resultCode}>{result.code}</Text>
              </Text>
              <Text style={styles.resultLine}>Share join link: {result.joinUrl}</Text>
              <Text style={styles.resultLine}>Session ID: {result.sessionId}</Text>
              {result.hostAuthToken ? (
                <Text style={styles.resultHint}>
                  Host credentials stored on this device. Open the host console to advance parties.
                </Text>
              ) : null}
              <Pressable style={styles.hostButton} onPress={openHostControls}>
                <Text style={styles.hostButtonText}>Open Host Console</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}
