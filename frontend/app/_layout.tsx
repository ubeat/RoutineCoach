import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initializeNotifications, pregenerateNotifications } from '../services/NotificationService';
import { I18nextProvider } from 'react-i18next';
import i18n, { loadSavedLanguage } from '../i18n';

export default function RootLayout() {
  useEffect(() => {
    // Initialize notifications and language on app start
    const init = async () => {
      await loadSavedLanguage();
      await initializeNotifications();
      await pregenerateNotifications();
    };
    init();
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <SafeAreaProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: styles.tabBar,
            tabBarActiveTintColor: '#FF6B6B',
            tabBarInactiveTintColor: '#888',
            tabBarLabelStyle: styles.tabLabel,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Heute',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="sunny" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="checkin"
            options={{
              title: 'Check-In',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="checkmark-circle" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: 'Profil',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="trophy" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="journal"
            options={{
              title: 'Tagebuch',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="book" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Mehr',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="ellipsis-horizontal" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="goals"
            options={{
              href: null, // Hide from tab bar but still accessible
            }}
          />
          <Tabs.Screen
            name="progress"
            options={{
              href: null, // Hide from tab bar but still accessible
            }}
          />
        </Tabs>
      </SafeAreaProvider>
    </I18nextProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    height: 70,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
});
