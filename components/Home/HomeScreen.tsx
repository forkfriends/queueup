import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import styles from './HomeScreen.Styles';

type Props = NativeStackScreenProps<RootStackParamList, 'HomeScreen'>;

export default function HomeScreen({ navigation }: Props) {
  return (
    <SafeAreaProvider style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to{'\n'}ForkFriends!</Text>

        <Image
          source={require('@assets/ff_logo.png')} 
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.buttonRow}>
          <Pressable style={styles.button} onPress={() => navigation.navigate('MakeQueueScreen', { id: 'new' })}>
            <Text style={styles.buttonText}>Make Queue</Text>
          </Pressable>

          <Pressable style={styles.button} onPress={() => navigation.navigate('JoinQueueScreen', { id: 'new' })}>
            <Text style={styles.buttonText}>Join Queue</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaProvider>
  );
}
