import React, { useState } from 'react';
import {
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  TextInput,
  Pressable,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './JoinQueueScreen.Styles';

type Props = NativeStackScreenProps<RootStackParamList, 'JoinQueueScreen'>;

export default function JoinQueueScreen({ navigation }: Props) {
  const [key, setKey] = useState('');

  const onCancel = () => navigation.goBack();
  const onSubmit = () => {
    // TODO: replace with real join logic after prototype phase
    console.log('Joining with key:', key);
    navigation.goBack();
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

            <View style={styles.actionsRow}>
              <Pressable style={styles.cancelBox} onPress={onCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>

              <Pressable style={styles.button} onPress={onSubmit}>
                <Text style={styles.buttonText}>Submit</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}
