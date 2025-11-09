import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const ACTIVE_QUEUES_KEY = 'queueup-active-queues';
const JOINED_QUEUES_KEY = 'queueup-joined-queues';
const HOST_AUTH_PREFIX = 'queueup-host-auth:';
const TRUST_SURVEY_PREFIX = 'queueup-trust-survey:';

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

export type StoredJoinedQueue = {
  code: string;
  sessionId: string;
  partyId: string;
  eventName?: string;
  joinedAt: number;
};

export type TrustSurveyResponse = {
  answer: 'yes' | 'no';
  submittedAt: number;
};

export const storage = {
  async setActiveQueue(queue: StoredQueue): Promise<void> {
    const queues = await this.getActiveQueues();
    const updatedQueues = [...queues.filter(q => q.code !== queue.code), { ...queue, createdAt: Date.now() }];
    const value = JSON.stringify(updatedQueues);
    
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(ACTIVE_QUEUES_KEY, value);
      } catch {
        // Fallback to AsyncStorage on web if localStorage fails
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
        value = window.localStorage.getItem(ACTIVE_QUEUES_KEY);
      } catch {
        // Fallback to AsyncStorage on web if localStorage fails
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
        window.localStorage.setItem(ACTIVE_QUEUES_KEY, value);
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
        window.localStorage.setItem(key, token);
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
        return window.localStorage.getItem(key);
      } catch {
        return AsyncStorage.getItem(key);
      }
    }
    return AsyncStorage.getItem(key);
  }
  ,

  async removeHostAuth(sessionId: string): Promise<void> {
    const key = `${HOST_AUTH_PREFIX}${sessionId}`;
    if (Platform.OS === 'web') {
      try {
        window.sessionStorage.removeItem(key);
        return;
      } catch {
        // Fallback to AsyncStorage on web if sessionStorage fails
      }
    }
    await AsyncStorage.removeItem(key);
  },

  async setJoinedQueue(queue: StoredJoinedQueue): Promise<void> {
    // Get current queues first
    let queues = await this.getJoinedQueues();
    
    // Safety check: if we got an empty array but there should be data, retry once
    if (queues.length === 0 && window.localStorage.getItem(JOINED_QUEUES_KEY)) {
      console.warn('Detected potential storage read issue, retrying...');
      await new Promise(resolve => setTimeout(resolve, 100));
      const retryQueues = await this.getJoinedQueues();
      if (retryQueues.length > 0) {
        console.log('Successfully recovered queues on retry');
        queues = retryQueues;
      }
    }
    
    // Update queues, keeping existing ones and adding/updating the new one
    const updatedQueues = [...queues.filter((q: StoredJoinedQueue) => q.code !== queue.code), queue];
    const value = JSON.stringify(updatedQueues);
    
    // Double check we're not about to write an empty array when we shouldn't
    if (updatedQueues.length === 0 && queues.length > 0) {
      console.error('Prevented writing empty array when data exists');
      return;
    }
    
    if (Platform.OS === 'web') {
      try {
        // Write to localStorage first
        window.localStorage.setItem(JOINED_QUEUES_KEY, value);
        // Verify the write was successful
        const verification = window.localStorage.getItem(JOINED_QUEUES_KEY);
        if (!verification) {
          throw new Error('Storage write verification failed');
        }
      } catch (error) {
        console.warn('localStorage operation failed, falling back to AsyncStorage', error);
        await AsyncStorage.setItem(JOINED_QUEUES_KEY, value);
      }
    } else {
      await AsyncStorage.setItem(JOINED_QUEUES_KEY, value);
    }
  },

  async getJoinedQueues(): Promise<StoredJoinedQueue[]> {
    let value: string | null = null;
    
    if (Platform.OS === 'web') {
      try {
        value = window.localStorage.getItem(JOINED_QUEUES_KEY);
        if (!value) {
          // If localStorage is empty, check AsyncStorage as fallback
          value = await AsyncStorage.getItem(JOINED_QUEUES_KEY);
        }
      } catch {
        value = await AsyncStorage.getItem(JOINED_QUEUES_KEY);
      }
    } else {
      value = await AsyncStorage.getItem(JOINED_QUEUES_KEY);
    }

    try {
      return value ? JSON.parse(value) : [];
    } catch (error) {
      console.error('Error parsing joined queues:', error);
      return [];
    }
  },

  async removeJoinedQueue(code: string): Promise<void> {
    // Get current queues first
    let queues = await this.getJoinedQueues();
    
    // Safety check: if we got an empty array but there should be data, retry once
    if (queues.length === 0 && window.localStorage.getItem(JOINED_QUEUES_KEY)) {
      console.warn('Detected potential storage read issue, retrying...');
      await new Promise(resolve => setTimeout(resolve, 100));
      const retryQueues = await this.getJoinedQueues();
      if (retryQueues.length > 0) {
        console.log('Successfully recovered queues on retry');
        queues = retryQueues;
      }
    }
    
    const updatedQueues = queues.filter((q: StoredJoinedQueue) => q.code !== code);
    const value = JSON.stringify(updatedQueues);
    
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(JOINED_QUEUES_KEY, value);
      } catch {
        await AsyncStorage.setItem(JOINED_QUEUES_KEY, value);
      }
    } else {
      await AsyncStorage.setItem(JOINED_QUEUES_KEY, value);
    }
  },

  async setTrustSurveyResponse(code: string, partyId: string, response: TrustSurveyResponse): Promise<void> {
    const key = `${TRUST_SURVEY_PREFIX}${code}:${partyId}`;
    const value = JSON.stringify(response);
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        await AsyncStorage.setItem(key, value);
        return;
      }
    }
    await AsyncStorage.setItem(key, value);
  },

  async getTrustSurveyResponse(code: string, partyId: string): Promise<TrustSurveyResponse | null> {
    const key = `${TRUST_SURVEY_PREFIX}${code}:${partyId}`;
    let value: string | null = null;
    if (Platform.OS === 'web') {
      try {
        value = window.localStorage.getItem(key);
        if (!value) {
          value = await AsyncStorage.getItem(key);
        }
      } catch {
        value = await AsyncStorage.getItem(key);
      }
    } else {
      value = await AsyncStorage.getItem(key);
    }
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as TrustSurveyResponse;
    } catch (error) {
      console.warn('Failed to parse trust survey response', error);
      return null;
    }
  },

  async removeTrustSurveyResponse(code: string, partyId: string): Promise<void> {
    const key = `${TRUST_SURVEY_PREFIX}${code}:${partyId}`;
    if (Platform.OS === 'web') {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch {
        await AsyncStorage.removeItem(key);
        return;
      }
    }
    await AsyncStorage.removeItem(key);
  },
};
