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
  const initialLoadDoneRef = useRef(false);
  const [activeQueues, setActiveQueues] = React.useState<Array<{
    code: string;
    sessionId: string;
    wsUrl: string;
    hostAuthToken: string;
    joinUrl?: string;
    eventName?: string;
    maxGuests?: number;
    location?: string | null;
    contactInfo?: string | null;
    createdAt: number;
  }>>([]);

  const [joinedQueues, setJoinedQueues] = React.useState<Array<{
    code: string;
    sessionId: string;
    partyId: string;
    eventName?: string;
    joinedAt: number;
  }>>([]);

  // Check for active queue on mount and when returning to screen
  const checkForQueues = React.useCallback(async () => {
    try {
      const [storedQueues, storedJoinedQueues] = await Promise.all([
        storage.getActiveQueues(),
        storage.getJoinedQueues()
      ]);
      
      console.log(
        'Checking for stored queues:',
        storedQueues.length ? `Found ${storedQueues.length} hosted` : 'No hosted queues',
        storedJoinedQueues.length ? `, ${storedJoinedQueues.length} joined` : ', no joined queues'
      );
      
      // Sort queues by creation time, newest first
      setActiveQueues(storedQueues.sort((a, b) => b.createdAt - a.createdAt));
      setJoinedQueues(storedJoinedQueues.sort((a, b) => b.joinedAt - a.joinedAt));
    } catch (error) {
      console.error('Error checking for queues:', error);
      setActiveQueues([]);
      setJoinedQueues([]);
    }
  }, []);

  // Load queues only once on mount
  React.useEffect(() => {
    if (!initialLoadDoneRef.current) {
      void checkForQueues();
      initialLoadDoneRef.current = true;
    }
  }, [checkForQueues]);

  // Only reload queues when returning from GuestQueueScreen if storage has changed
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Check if the stored queues have changed
      const checkStoredQueues = async () => {
        try {
          const storedJoinedQueues = await storage.getJoinedQueues();
          const currentCodes = new Set(joinedQueues.map(q => q.code));
          const storedCodes = new Set(storedJoinedQueues.map(q => q.code));
          
          // Only reload if the stored queues are different from our current state
          if (storedCodes.size !== currentCodes.size || 
              storedJoinedQueues.some(q => !currentCodes.has(q.code)) ||
              joinedQueues.some(q => !storedCodes.has(q.code))) {
            void checkForQueues();
          }
        } catch (error) {
          console.warn('Error checking stored queues:', error);
        }
      };
      
      void checkStoredQueues();
    });

    return unsubscribe;
  }, [navigation, checkForQueues, joinedQueues]);

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

        {joinedQueues.map((queue, index) => (
          <Pressable
            key={`joined-${queue.code}`}
            style={[
              styles.button,
              styles.joinedButton,
              index > 0 && styles.buttonSpacing
            ]}
            onPress={() => {
              navigation.navigate('GuestQueueScreen', {
                code: queue.code,
                sessionId: queue.sessionId,
                partyId: queue.partyId
              });
            }}>
            <Text style={styles.joinedButtonText}>
              Joined {queue.eventName ? `(${queue.eventName})` : queue.code}
            </Text>
          </Pressable>
        ))}

        {activeQueues.map((queue, index) => (
          <Pressable
            key={`host-${queue.code}`}
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
                location: queue.location,
                contactInfo: queue.contactInfo,
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
