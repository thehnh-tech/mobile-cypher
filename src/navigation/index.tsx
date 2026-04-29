import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { createNavigationContainerRef } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { ActivityIndicator, View } from 'react-native';
import { PushTapData } from '../pushNotifications';

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import FriendsScreen from '../screens/FriendsScreen';
import RequestsScreen from '../screens/RequestsScreen';
import EncryptionScreen from '../screens/EncryptionScreen';
import LockScreen from '../screens/LockScreen';
import PinSetupScreen from '../screens/PinSetupScreen';

export type AuthStackParams = {
  Login: undefined;
  Signup: undefined;
};

export type MainStackParams = {
  ChatList: undefined;
  Chat: { chatId: string };
  Profile: undefined;
  Friends: undefined;
  Requests: undefined;
  Encryption: undefined;
};

const AuthStack = createStackNavigator<AuthStackParams>();
const MainStack = createStackNavigator<MainStackParams>();

export const navigationRef = createNavigationContainerRef<MainStackParams>();

export function handlePushTap(data: PushTapData) {
  if (!navigationRef.isReady()) return;
  if (data.kind === 'message') {
    navigationRef.navigate('Chat', { chatId: data.conversationId });
  } else if (data.kind === 'request') {
    navigationRef.navigate('Requests');
  }
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: 'transparent' } }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: 'transparent' } }}>
      <MainStack.Screen name="ChatList" component={ChatListScreen} />
      <MainStack.Screen name="Chat" component={ChatScreen} />
      <MainStack.Screen name="Profile" component={ProfileScreen} />
      <MainStack.Screen name="Friends" component={FriendsScreen} />
      <MainStack.Screen name="Requests" component={RequestsScreen} />
      <MainStack.Screen name="Encryption" component={EncryptionScreen} />
    </MainStack.Navigator>
  );
}

export function RootNavigator() {
  const { isLoading, isAuthenticated, isLocked, vault } = useApp();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#05070d' }}>
        <ActivityIndicator color="#22d3ee" size="large" />
      </View>
    );
  }

  if (!isAuthenticated) return <AuthNavigator />;
  // First-run / legacy users without an app lock must set one before
  // continuing — Telegram-style mandatory lock at signup.
  if (vault && !vault.settings.appLock) return <PinSetupScreen />;
  // App lock gates the authenticated experience. Vault is already decrypted
  // in memory at this point — this is just a UX/local-access gate.
  if (isLocked) return <LockScreen />;
  return <MainNavigator />;
}
