import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Linking, StyleSheet, Platform } from 'react-native';
import { Github, ArrowLeft } from 'lucide-react-native';
import './global.css';

import HomeScreen from './components/Home/HomeScreen';
import MakeQueueScreen from './components/Make/MakeQueueScreen';
import JoinQueueScreen from './components/Join/JoinQueueScreen';
import HostQueueScreen from './components/Host/HostQueueScreen';
import GuestQueueScreen from './components/Guest/GuestQueueScreen';
import PrivacyPolicyScreen from './components/PrivacyPolicy/PrivacyPolicyScreen';
import type { RootStackParamList } from './types/navigation';
import { ModalProvider } from './contexts/ModalContext';

const Stack = createNativeStackNavigator<RootStackParamList>();
const GITHUB_URL = 'https://github.com/forkfriends/queueup';

const headerStyles = StyleSheet.create({
  iconButton: {
    padding: 10,
    marginRight: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cfd1d4',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1.5,
  },
  backButton: {
    padding: 8,
    marginLeft: 8,
  },
});

const getScreenTitle = (screenName: string): string => {
  const screenTitles: Record<string, string> = {
    HomeScreen: 'Home',
    MakeQueueScreen: 'Make Queue',
    JoinQueueScreen: 'Join Queue',
    HostQueueScreen: 'Host Queue',
    GuestQueueScreen: 'Guest Queue',
    PrivacyPolicyScreen: 'Privacy Policy',
  };
  return screenTitles[screenName] || screenName;
};

export default function App() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  const updateTitle = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    const currentRoute = navigationRef.getCurrentRoute();
    if (currentRoute) {
      const screenTitle = getScreenTitle(currentRoute.name);
      document.title = `QueueUp - ${screenTitle}`;
    }
  };

  const handleStateChange = () => {
    updateTitle();
  };

  const handleReady = () => {
    updateTitle();
  };

  return (
    <ModalProvider>
      <NavigationContainer ref={navigationRef} onStateChange={handleStateChange} onReady={handleReady}>
        <StatusBar style="auto" />
        <Stack.Navigator
          initialRouteName="HomeScreen"
          screenOptions={({ navigation, route }) => ({
            headerRight: () => (
              <Pressable
                style={headerStyles.iconButton}
                accessibilityRole="link"
                accessibilityLabel="View ForkFriends on GitHub"
                hitSlop={12}
                onPress={() => {
                  void Linking.openURL(GITHUB_URL);
                }}>
                <Github size={22} color="#111" strokeWidth={2} />
              </Pressable>
            ),
            headerBackTitleVisible: false,
            headerLeft: () => {
              if (route.name === 'HomeScreen') {
                return null;
              }
              if (!navigation.canGoBack()) {
                return null;
              }
              return (
                <Pressable
                  style={headerStyles.backButton}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  hitSlop={12}
                  onPress={() => navigation.goBack()}>
                  <ArrowLeft size={22} color="#111" strokeWidth={2.5} />
                </Pressable>
              );
            },
          })}>
          <Stack.Screen name="HomeScreen" component={HomeScreen} options={{ title: '' }} />
          <Stack.Screen
            name="MakeQueueScreen"
            component={MakeQueueScreen}
            options={{ title: '' }}
          />
          <Stack.Screen name="JoinQueueScreen" component={JoinQueueScreen} options={{ title: '' }} />
          <Stack.Screen
            name="GuestQueueScreen"
            component={GuestQueueScreen}
            options={{ title: '' }}
          />
          <Stack.Screen
            name="HostQueueScreen"
            component={HostQueueScreen}
            options={{ title: '' }}
          />
          <Stack.Screen
            name="PrivacyPolicyScreen"
            component={PrivacyPolicyScreen}
            options={{ title: '' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </ModalProvider>
  );
}
