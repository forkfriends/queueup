import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './JoinQueueScreen.Styles';
import { joinQueue } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinQueueScreen'>;

export default function JoinQueueScreen({ navigation }: Props) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState('1');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);

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
    try {
      const joinResult = await joinQueue({
        code: trimmed,
        name,
        size: Number.parseInt(size, 10) || undefined,
      });
      setResultText(`You're number ${joinResult.position} in line.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error joining queue';
      Alert.alert('Unable to join queue', message);
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

            <Text style={styles.label}>Your Name</Text>
            <TextInput
              placeholder="(optional)"
              value={name}
              onChangeText={setName}
              style={styles.input}
              returnKeyType="next"
            />

            <Text style={styles.label}>Party Size</Text>
            <TextInput
              placeholder="1"
              value={size}
              onChangeText={setSize}
              style={styles.input}
              keyboardType="number-pad"
              returnKeyType="done"
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
              <Text style={styles.resultHint}>
                Keep this screen open to see updates when the host advances the queue.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}
