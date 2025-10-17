import React, { useCallback, useState } from 'react';
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
import Slider from '@react-native-community/slider';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './MakeQueueScreen.Styles';
import { createQueue } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'MakeQueueScreen'>;

const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 100;
const DEFAULT_QUEUE_SIZE = 20;

type TimeField = 'open' | 'close';

function createTime(hours: number, minutes = 0): Date {
  const base = new Date();
  base.setHours(hours, minutes, 0, 0);
  return base;
}

function normalizeTime(date: Date): Date {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  return normalized;
}

function formatTime(date: Date): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minuteString = minutes.toString().padStart(2, '0');
  return `${hours12}:${minuteString} ${period}`;
}

export default function MakeQueueScreen({ navigation }: Props) {
  const [location, setLocation] = useState('');
  const [maxSize, setMaxSize] = useState<number>(DEFAULT_QUEUE_SIZE);
  const [activePicker, setActivePicker] = useState<TimeField | null>(null);
  const [openTime, setOpenTime] = useState(() => createTime(9));
  const [closeTime, setCloseTime] = useState(() => createTime(17));
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);

  const applyTimeChange = useCallback(
    (field: TimeField, selected: Date) => {
      const normalized = normalizeTime(selected);
      if (field === 'open') {
        setOpenTime(normalized);
        setCloseTime((previousClose) => {
          if (normalized >= previousClose) {
            const adjusted = new Date(normalized);
            adjusted.setHours(adjusted.getHours() + 1);
            return adjusted;
          }
          return previousClose;
        });
      } else {
        setCloseTime(() => {
          if (normalized <= openTime) {
            const adjusted = new Date(openTime);
            adjusted.setHours(openTime.getHours() + 1);
            return adjusted;
          }
          return normalized;
        });
      }
    },
    [openTime]
  );

  const handleTimePress = useCallback(
    (field: TimeField) => {
      if (Platform.OS === 'android') {
        DateTimePickerAndroid.open({
          mode: 'time',
          is24Hour: false,
          value: field === 'open' ? openTime : closeTime,
          onChange: (event, selectedDate) => {
            if (event.type === 'set' && selectedDate) {
              applyTimeChange(field, selectedDate);
            }
          },
        });
        return;
      }
      setActivePicker(field);
    },
    [applyTimeChange, closeTime, openTime]
  );

  const handleIosTimeChange = useCallback(
    (_event: DateTimePickerEvent, selectedDate?: Date) => {
      if (!activePicker || !selectedDate) {
        return;
      }
      applyTimeChange(activePicker, selectedDate);
    },
    [activePicker, applyTimeChange]
  );

  const handleDismissPicker = useCallback(() => {
    setActivePicker(null);
  }, []);

  const onSubmit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const created = await createQueue();
      navigation.navigate('HostQueueScreen', {
        code: created.code,
        sessionId: created.sessionId,
        wsUrl: created.wsUrl,
        joinUrl: created.joinUrl,
        hostAuthToken: created.hostAuthToken,
      });
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
            <View style={styles.sliderRow}>
              <Text style={styles.sliderHint}>Allow up to</Text>
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

            {/* Open Hours */}
            <Text style={styles.label}>Open Hours</Text>
            <View style={styles.timeRow}>
              <Pressable
                style={[styles.timeInput, styles.timeInputLeft]}
                onPress={() => handleTimePress('open')}
                accessibilityRole="button">
                <Text style={styles.timeLabel}>Opens</Text>
                <Text style={styles.timeValue}>{formatTime(openTime)}</Text>
              </Pressable>
              <Pressable
                style={[styles.timeInput, styles.timeInputRight]}
                onPress={() => handleTimePress('close')}
                accessibilityRole="button">
                <Text style={styles.timeLabel}>Closes</Text>
                <Text style={styles.timeValue}>{formatTime(closeTime)}</Text>
              </Pressable>
            </View>

            {Platform.OS === 'ios' && activePicker ? (
              <View style={styles.timePickerContainer}>
                <View style={styles.timePickerHeader}>
                  <Text style={styles.timePickerTitle}>
                    {activePicker === 'open' ? 'Opening time' : 'Closing time'}
                  </Text>
                  <Pressable onPress={handleDismissPicker} accessibilityRole="button">
                    <Text style={styles.timePickerDone}>Done</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={activePicker === 'open' ? openTime : closeTime}
                  mode="time"
                  display="spinner"
                  onChange={handleIosTimeChange}
                />
              </View>
            ) : null}

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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}
