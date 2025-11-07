import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Pressable, Platform } from 'react-native';
import { storage } from '../../utils/storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './HomeScreen.Styles';

type Props = NativeStackScreenProps<RootStackParamList, 'HomeScreen'>;

export default function HomeScreen({ navigation }: Props) {
  const handledPrefillRef = useRef(false);
  const [activeQueues, setActiveQueues] = React.useState<Array<{
    code: string;
    sessionId: string;
    wsUrl: string;
    hostAuthToken: string;
    joinUrl?: string;
    eventName?: string;
    maxGuests?: number;
    createdAt: number;
  }>>([]);

  // Check for active queue on mount and when returning to screen
  const checkForActiveQueues = React.useCallback(async () => {
    try {
      const storedQueues = await storage.getActiveQueues();
      console.log('Checking for stored queues:', storedQueues.length ? `Found ${storedQueues.length}` : 'None found');
      // Sort queues by creation time, newest first
      setActiveQueues(storedQueues.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Error checking for active queues:', error);
      setActiveQueues([]);
    }
  }, []);

  // Check on mount
  React.useEffect(() => {
    void checkForActiveQueues();
  }, [checkForActiveQueues]);

  // Check when screen comes into focus
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void checkForActiveQueues();
    });

    return unsubscribe;
  }, [navigation, checkForActiveQueues]);

  useEffect(() => {
    if (handledPrefillRef.current) {
      return;
    }
    if (Platform.OS !== 'web') {
      return;
    }
    const search = window.location.search;
    if (!search) {
      return;
    }
    const params = new URLSearchParams(search);
    const joinCode = params.get('code');
    if (!joinCode) {
      return;
    }
    const normalized = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      return;
    }
    handledPrefillRef.current = true;
    navigation.navigate('JoinQueueScreen', { id: 'link', code: normalized });
    const cleanedUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanedUrl);
  }, [navigation]);

  return (
    <SafeAreaProvider style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to{'\n'}ForkFriends!</Text>

        <Image source={require('@assets/ff_logo.png')} style={styles.logo} resizeMode="contain" />

        <View style={styles.buttonRow}>
          <Pressable
            style={styles.button}
            onPress={() => navigation.navigate('MakeQueueScreen', { id: 'new' })}>
            <Text style={styles.buttonText}>Make Queue</Text>
          </Pressable>

          <Pressable
            style={styles.button}
            onPress={() => navigation.navigate('JoinQueueScreen', { id: 'new' })}>
            <Text style={styles.buttonText}>Join Queue</Text>
          </Pressable>
        </View>

        {activeQueues.map((queue, index) => (
          <Pressable
            key={queue.code}
            style={[
              styles.button,
              styles.returnButton,
              index > 0 && styles.returnButtonSpacing
            ]}
            onPress={() => {
              navigation.navigate('HostQueueScreen', {
                code: queue.code,
                sessionId: queue.sessionId,
                wsUrl: queue.wsUrl,
                hostAuthToken: queue.hostAuthToken,
                joinUrl: queue.joinUrl,
                eventName: queue.eventName,
                maxGuests: queue.maxGuests,
              });
            }}>
            <Text style={styles.buttonText}>
              View {queue.eventName ? `(${queue.eventName})` : queue.code}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaProvider>
  );
}
