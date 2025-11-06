import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const ACTIVE_QUEUES_KEY = 'queueup-active-queues';
const HOST_AUTH_PREFIX = 'queueup-host-auth:';

export type StoredQueue = {
  code: string;
  sessionId: string;
  wsUrl: string;
  hostAuthToken: string;
  joinUrl?: string;
  eventName?: string;
  maxGuests?: number;
  createdAt: number; // timestamp for sorting
};

export const storage = {
  async setActiveQueue(queue: StoredQueue): Promise<void> {
    const queues = await this.getActiveQueues();
    const updatedQueues = [...queues.filter(q => q.code !== queue.code), { ...queue, createdAt: Date.now() }];
    const value = JSON.stringify(updatedQueues);
    
    if (Platform.OS === 'web') {
      try {
        window.sessionStorage.setItem(ACTIVE_QUEUES_KEY, value);
      } catch {
        // Fallback to AsyncStorage on web if sessionStorage fails
        await AsyncStorage.setItem(ACTIVE_QUEUES_KEY, value);
      }
    } else {
      await AsyncStorage.setItem(ACTIVE_QUEUES_KEY, value);
    }
  },

  async getActiveQueues(): Promise<StoredQueue[]> {
    let value: string | null = null;
    
    if (Platform.OS === 'web') {
      try {
        value = window.sessionStorage.getItem(ACTIVE_QUEUES_KEY);
      } catch {
        // Fallback to AsyncStorage on web if sessionStorage fails
        value = await AsyncStorage.getItem(ACTIVE_QUEUES_KEY);
      }
    } else {
      value = await AsyncStorage.getItem(ACTIVE_QUEUES_KEY);
    }

    return value ? JSON.parse(value) : [];
  },

  async removeQueue(code: string): Promise<void> {
    const queues = await this.getActiveQueues();
    const updatedQueues = queues.filter(q => q.code !== code);
    const value = JSON.stringify(updatedQueues);

    if (Platform.OS === 'web') {
      try {
        window.sessionStorage.setItem(ACTIVE_QUEUES_KEY, value);
      } catch {
        await AsyncStorage.setItem(ACTIVE_QUEUES_KEY, value);
      }
    } else {
      await AsyncStorage.setItem(ACTIVE_QUEUES_KEY, value);
    }
  },

  async setHostAuth(sessionId: string, token: string): Promise<void> {
    const key = `${HOST_AUTH_PREFIX}${sessionId}`;
    if (Platform.OS === 'web') {
      try {
        window.sessionStorage.setItem(key, token);
      } catch {
        await AsyncStorage.setItem(key, token);
      }
    } else {
      await AsyncStorage.setItem(key, token);
    }
  },

  async getHostAuth(sessionId: string): Promise<string | null> {
    const key = `${HOST_AUTH_PREFIX}${sessionId}`;
    if (Platform.OS === 'web') {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return AsyncStorage.getItem(key);
      }
    }
    return AsyncStorage.getItem(key);
  }
};