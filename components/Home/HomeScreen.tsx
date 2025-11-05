import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Pressable, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './HomeScreen.Styles';

type Props = NativeStackScreenProps<RootStackParamList, 'HomeScreen'>;

export default function HomeScreen({ navigation }: Props) {
  const handledPrefillRef = useRef(false);

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
      </View>
    </SafeAreaProvider>
  );
}
