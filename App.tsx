import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { enableScreens } from 'react-native-screens';
import './global.css';

import HomeScreen from './components/Home/HomeScreen';
import MakeQueueScreen from './components/Make/MakeQueueScreen';
import JoinQueueScreen from './components/Join/JoinQueueScreen';
import HostQueueScreen from './components/Host/HostQueueScreen';
import type { RootStackParamList } from './types/navigation';

enableScreens(true);

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator initialRouteName="HomeScreen">
        <Stack.Screen name="HomeScreen" component={HomeScreen} options={{ title: '' }} />
        <Stack.Screen
          name="MakeQueueScreen"
          component={MakeQueueScreen}
          options={{ title: '' }}
        />
        <Stack.Screen name="JoinQueueScreen" component={JoinQueueScreen} options={{ title: '' }} />
        <Stack.Screen
          name="HostQueueScreen"
          component={HostQueueScreen}
          options={{ title: '' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
