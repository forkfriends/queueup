import React, { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../../utils/storage';
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
import { Turnstile } from '@marsidev/react-turnstile';
import * as Location from 'expo-location';
import type { RootStackParamList } from '../../types/navigation';
import styles from './MakeQueueScreen.Styles';
import { createQueue } from '../../lib/backend';

type Props = NativeStackScreenProps<RootStackParamList, 'MakeQueueScreen'>;

const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 100;
const DEFAULT_QUEUE_SIZE = 20;
const MAPBOX_GEOCODING_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const MAPBOX_SEARCH_DEBOUNCE_MS = 400;
const MIN_LOCATION_QUERY_LENGTH = 3;
const MAPBOX_TOKEN =
  (typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN : undefined) ?? '';

type TimeField = 'open' | 'close';
type LocationSuggestion = {
  id: string;
  primaryText: string;
  secondaryText?: string;
  fullText: string;
};

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

function formatTimeInputValue(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function MakeQueueScreen({ navigation }: Props) {
  const [eventName, setEventName] = useState('');
  const [location, setLocation] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState<string | null>(null);
  const [locationInputFocused, setLocationInputFocused] = useState(false);
  const [deviceCoords, setDeviceCoords] = useState<Location.LocationObjectCoords | null>(null);
  const [locationPermissionStatus, setLocationPermissionStatus] =
    useState<Location.PermissionStatus | null>(null);
  const [maxSize, setMaxSize] = useState<number>(DEFAULT_QUEUE_SIZE);
  const [activePicker, setActivePicker] = useState<TimeField | null>(null);
  const [openTime, setOpenTime] = useState(() => createTime(9));
  const [closeTime, setCloseTime] = useState(() => createTime(17));
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<any>(null);
  const locationSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationSearchAbortRef = useRef<AbortController | null>(null);
  const isSelectingLocationRef = useRef<boolean>(false);
  const isMapboxEnabled = Boolean(MAPBOX_TOKEN);
  const isWeb = Platform.OS === 'web';
  const hasMinimumLocationQuery = location.trim().length >= MIN_LOCATION_QUERY_LENGTH;
  const shouldShowLocationSuggestions =
    isMapboxEnabled &&
    hasMinimumLocationQuery &&
    (locationInputFocused || Platform.OS === 'web') &&
    (locationSuggestions.length > 0 || isSearchingLocations);
  const resolvedLocationHelperText =
    locationSearchError ??
    (isSearchingLocations
      ? 'Searching nearby places…'
      : !location
        ? 'Start typing to search for a venue near you.'
        : hasMinimumLocationQuery && shouldShowLocationSuggestions
          ? 'Tap a result below to autofill the location.'
          : hasMinimumLocationQuery
            ? ''
            : `Enter at least ${MIN_LOCATION_QUERY_LENGTH} characters to search nearby places.`);
  const showLocationPermissionHint = locationPermissionStatus === 'denied';

  const ensureDeviceCoords =
    useCallback(async (): Promise<Location.LocationObjectCoords | null> => {
      if (deviceCoords) {
        return deviceCoords;
      }
      if (!isMapboxEnabled) {
        return null;
      }
      if (locationPermissionStatus === 'denied') {
        return null;
      }
      try {
        const permissionResponse = await Location.requestForegroundPermissionsAsync();
        setLocationPermissionStatus(permissionResponse.status);
        if (permissionResponse.status !== 'granted') {
          return null;
        }

        const lastKnown = await Location.getLastKnownPositionAsync({});
        if (lastKnown?.coords) {
          setDeviceCoords(lastKnown.coords);
          return lastKnown.coords;
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setDeviceCoords(current.coords);
        return current.coords;
      } catch (error) {
        console.warn('[QueueUp][Location] Unable to determine host position', error);
        return null;
      }
    }, [deviceCoords, isMapboxEnabled, locationPermissionStatus]);

  const handleLocationFocus = useCallback(() => {
    if (locationBlurTimeoutRef.current) {
      clearTimeout(locationBlurTimeoutRef.current);
      locationBlurTimeoutRef.current = null;
    }
    setLocationInputFocused(true);
  }, []);

  const handleLocationBlur = useCallback(() => {
    locationBlurTimeoutRef.current = setTimeout(() => {
      setLocationInputFocused(false);
    }, 150);
  }, []);

  const handleLocationSuggestionPress = useCallback((suggestion: LocationSuggestion) => {
    isSelectingLocationRef.current = true;
    setLocation(suggestion.fullText);
    setLocationSuggestions([]);
    setLocationSearchError(null);
    setLocationInputFocused(false);
    // Reset the flag after a brief delay to allow state updates to complete
    setTimeout(() => {
      isSelectingLocationRef.current = false;
    }, 100);
  }, []);

  useEffect(() => {
    return () => {
      if (locationSearchTimeoutRef.current) {
        clearTimeout(locationSearchTimeoutRef.current);
        locationSearchTimeoutRef.current = null;
      }
      if (locationBlurTimeoutRef.current) {
        clearTimeout(locationBlurTimeoutRef.current);
        locationBlurTimeoutRef.current = null;
      }
      if (locationSearchAbortRef.current) {
        locationSearchAbortRef.current.abort();
        locationSearchAbortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isMapboxEnabled) {
      setLocationSuggestions([]);
      setIsSearchingLocations(false);
      return;
    }

    // Skip search if location was set programmatically (from selection)
    if (isSelectingLocationRef.current) {
      return;
    }

    const trimmedQuery = location.trim();
    if (trimmedQuery.length < MIN_LOCATION_QUERY_LENGTH) {
      setLocationSuggestions([]);
      setLocationSearchError(null);
      setIsSearchingLocations(false);
      if (locationSearchTimeoutRef.current) {
        clearTimeout(locationSearchTimeoutRef.current);
        locationSearchTimeoutRef.current = null;
      }
      if (locationSearchAbortRef.current) {
        locationSearchAbortRef.current.abort();
        locationSearchAbortRef.current = null;
      }
      return;
    }

    if (locationSearchTimeoutRef.current) {
      clearTimeout(locationSearchTimeoutRef.current);
    }

    const controller = new AbortController();
    if (locationSearchAbortRef.current) {
      locationSearchAbortRef.current.abort();
    }
    locationSearchAbortRef.current = controller;

    const timeoutId = setTimeout(async () => {
      setIsSearchingLocations(true);
      setLocationSearchError(null);
      try {
        let proximityParam = '';
        const coords = await ensureDeviceCoords();
        if (coords) {
          proximityParam = `&proximity=${coords.longitude},${coords.latitude}`;
        }
        const response = await fetch(
          `${MAPBOX_GEOCODING_URL}/${encodeURIComponent(trimmedQuery)}.json?autocomplete=true&language=en&limit=6${proximityParam}&access_token=${MAPBOX_TOKEN}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`Mapbox search failed (${response.status})`);
        }
        const data = await response.json();
        const features = Array.isArray(data?.features) ? data.features : [];
        const mapped: LocationSuggestion[] = features.map((feature: any) => {
          const primary = feature?.text ?? feature?.place_name ?? trimmedQuery;
          const fullText = feature?.place_name ?? primary;
          let secondary: string | undefined;
          if (fullText && primary && fullText.startsWith(primary)) {
            secondary = fullText.slice(primary.length).replace(/^,\s*/, '');
          } else if (fullText && fullText !== primary) {
            secondary = fullText;
          }
          return {
            id: feature?.id ?? fullText ?? primary,
            primaryText: primary,
            secondaryText: secondary,
            fullText,
          };
        });
        setLocationSuggestions(mapped);
        if (!mapped.length) {
          setLocationSearchError('No matching places found nearby.');
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.warn('[QueueUp][Location] Search failed', error);
        setLocationSearchError('Unable to search locations right now.');
        setLocationSuggestions([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingLocations(false);
        }
      }
    }, MAPBOX_SEARCH_DEBOUNCE_MS);
    locationSearchTimeoutRef.current = timeoutId;

    return () => {
      controller.abort();
      if (locationSearchAbortRef.current === controller) {
        locationSearchAbortRef.current = null;
      }
      if (locationSearchTimeoutRef.current === timeoutId) {
        clearTimeout(timeoutId);
        locationSearchTimeoutRef.current = null;
      }
    };
  }, [ensureDeviceCoords, isMapboxEnabled, location]);

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

  const adjustTimeByMinutes = useCallback(
    (field: TimeField, deltaMinutes: number) => {
      const source = field === 'open' ? openTime : closeTime;
      const currentMinutes = source.getHours() * 60 + source.getMinutes();
      const nextMinutes = Math.min(Math.max(currentMinutes + deltaMinutes, 0), 23 * 60 + 45);
      if (nextMinutes === currentMinutes) {
        return;
      }
      const adjusted = new Date(source);
      adjusted.setHours(Math.floor(nextMinutes / 60), nextMinutes % 60, 0, 0);
      applyTimeChange(field, adjusted);
    },
    [applyTimeChange, closeTime, openTime]
  );

  const renderWebTimeInput = (field: TimeField, label: string) => {
    const value = field === 'open' ? openTime : closeTime;
    const totalMinutes = value.getHours() * 60 + value.getMinutes();
    const canDecrease = totalMinutes > 0;
    const canIncrease = totalMinutes < 23 * 60 + 45;

    return (
      <View
        style={[styles.timeInput, field === 'open' ? styles.timeInputLeft : styles.timeInputRight]}>
        <Text style={styles.timeLabel}>{label}</Text>
        <View style={styles.timeStepperRow}>
          <Text style={styles.timeValue}>{formatTimeInputValue(value)}</Text>
          <View style={styles.timeStepperButtons}>
            <Pressable
              style={[
                styles.timeStepperButton,
                styles.timeStepperButtonTop,
                !canIncrease ? styles.timeStepperButtonDisabled : undefined,
              ]}
              onPress={() => adjustTimeByMinutes(field, 15)}
              disabled={!canIncrease}
              accessibilityRole="button"
              accessibilityLabel={`Increase ${label.toLowerCase()} time`}>
              <Text style={styles.timeStepperIcon}>▲</Text>
            </Pressable>
            <Pressable
              style={[
                styles.timeStepperButton,
                !canDecrease ? styles.timeStepperButtonDisabled : undefined,
              ]}
              onPress={() => adjustTimeByMinutes(field, -15)}
              disabled={!canDecrease}
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${label.toLowerCase()} time`}>
              <Text style={styles.timeStepperIcon}>▼</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const onSubmit = async () => {
    if (loading) return;
    const trimmedEventName = eventName.trim();
    if (!trimmedEventName) {
      Alert.alert('Add event name', 'Please provide a name for this event.');
      return;
    }
    const normalizedMaxGuests = Math.min(MAX_QUEUE_SIZE, Math.max(MIN_QUEUE_SIZE, maxSize));
    setLoading(true);

    console.log('[QueueUp][create] Turnstile token:', turnstileToken ? 'present' : 'MISSING');

    try {
      const created = await createQueue({
        eventName: trimmedEventName,
        maxGuests: normalizedMaxGuests,
        turnstileToken: turnstileToken ?? undefined,
      });
      if (created.hostAuthToken) {
        try {
          await storage.setHostAuth(created.sessionId, created.hostAuthToken);
          // Store the full queue details right when it's created
          await storage.setActiveQueue({
            code: created.code,
            sessionId: created.sessionId,
            wsUrl: created.wsUrl,
            hostAuthToken: created.hostAuthToken,
            joinUrl: created.joinUrl,
            eventName: created.eventName,
            maxGuests: created.maxGuests,
            createdAt: Date.now(),
          });
        } catch (error) {
          console.warn('Failed to store queue details:', error);
        }
      }

      // Reset Turnstile for next use
      setTurnstileToken(null);
      if (turnstileRef.current?.reset) {
        turnstileRef.current.reset();
      }

      navigation.navigate('HostQueueScreen', {
        code: created.code,
        sessionId: created.sessionId,
        wsUrl: created.wsUrl,
        joinUrl: created.joinUrl,
        hostAuthToken: created.hostAuthToken,
        eventName: created.eventName ?? trimmedEventName,
        maxGuests: created.maxGuests ?? normalizedMaxGuests,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error creating queue';

      // Check if it's a Turnstile verification error
      if (message.includes('Turnstile verification') || message.includes('verification required')) {
        Alert.alert(
          'Verification Required',
          'Please complete the Cloudflare security check below before creating a queue.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Unable to create queue', message);
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

  return (
    <SafeAreaProvider style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Make Queue</Text>

          <View style={styles.card}>
            {/* Event Name */}
            <Text style={styles.label}>Event Name</Text>
            <TextInput
              placeholder="Dinner rush, pop-up, etc."
              value={eventName}
              onChangeText={setEventName}
              style={styles.input}
              returnKeyType="next"
            />

            {/* Location */}
            <Text style={styles.label}>Location</Text>
            <TextInput
              placeholder={
                isMapboxEnabled ? 'Search for a venue or address' : 'Add a short location note'
              }
              value={location}
              onChangeText={(text) => {
                setLocation(text);
                setLocationSearchError(null);
              }}
              style={styles.input}
              returnKeyType="search"
              onFocus={handleLocationFocus}
              onBlur={handleLocationBlur}
              autoCapitalize="words"
            />
            {isMapboxEnabled ? (
              <>
                <View style={styles.locationHelperRow}>
                  {isSearchingLocations ? (
                    <ActivityIndicator
                      size="small"
                      color="#1f6feb"
                      style={styles.locationSearchSpinner}
                    />
                  ) : null}
                  <Text style={styles.locationHelperText} numberOfLines={2}>
                    {resolvedLocationHelperText}
                  </Text>
                </View>
                {shouldShowLocationSuggestions ? (
                  <View style={styles.locationSuggestionList}>
                    {locationSuggestions.map((suggestion, index) => (
                      <Pressable
                        key={suggestion.id}
                        style={[
                          styles.locationSuggestion,
                          index === 0 ? styles.locationSuggestionFirst : undefined,
                        ]}
                        onPress={() => handleLocationSuggestionPress(suggestion)}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${suggestion.fullText}`}>
                        <Text style={styles.locationSuggestionPrimary}>
                          {suggestion.primaryText}
                        </Text>
                        {suggestion.secondaryText ? (
                          <Text style={styles.locationSuggestionSecondary}>
                            {suggestion.secondaryText}
                          </Text>
                        ) : null}
                      </Pressable>
                    ))}
                    {!isSearchingLocations &&
                    !locationSuggestions.length &&
                    hasMinimumLocationQuery &&
                    !locationSearchError ? (
                      <Text style={styles.locationSuggestionEmpty}>No nearby matches yet.</Text>
                    ) : null}
                  </View>
                ) : null}
                {showLocationPermissionHint ? (
                  <Text style={styles.locationPermissionHint}>
                    Enable location permissions in system settings to prioritize nearby matches.
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.locationHelperText}>
                Set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` to enable map-powered search.
              </Text>
            )}

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
            {Platform.OS === 'web' ? (
              <View style={styles.timeRow}>
                {renderWebTimeInput('open', 'Opens')}
                {renderWebTimeInput('close', 'Closes')}
              </View>
            ) : (
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
            )}

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

            {/* Turnstile Widget */}
            {isWeb && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ? (
              <View style={{ marginVertical: 16, alignItems: 'center' }}>
                <Turnstile
                  ref={turnstileRef}
                  siteKey={process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY}
                  onSuccess={(token) => {
                    console.log('[QueueUp][Turnstile] Token received');
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

            {isWeb && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken ? (
              <Text
                style={{ textAlign: 'center', color: '#586069', fontSize: 14, marginBottom: 12 }}>
                Complete the verification above to create queue
              </Text>
            ) : null}

            {/* Submit */}
            <Pressable
              style={[
                styles.button,
                loading || (isWeb && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)
                  ? styles.buttonDisabled
                  : undefined,
              ]}
              onPress={onSubmit}
              disabled={
                loading || (isWeb && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)
              }>
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
