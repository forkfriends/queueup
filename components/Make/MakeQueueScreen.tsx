import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './MakeQueueScreen.Styles';

type Props = NativeStackScreenProps<RootStackParamList, 'MakeQueueScreen'>;

export default function MakeQueueScreen({ navigation }: Props) {
  const [location, setLocation] = useState('');
  const [maxSize, setMaxSize] = useState('');
  const [hours, setHours] = useState('');
  const [contact, setContact] = useState('');

  const onSubmit = () => {
    // TODO: replace with your actual submit logic when we are passed the prototype phase
    console.log({ location, maxSize, hours, contact });
    navigation.goBack();
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
            <Pressable style={styles.button} onPress={onSubmit}>
              <Text style={styles.buttonText}>Submit</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}
