import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

interface CachedMessages {
  habit_all: string;
  habit_0: string;
  habit_1: string;
  habit_2: string;
  checkin: string;
}

let cachedMessages: CachedMessages | null = null;

// Request notification permissions
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') {
    // Web notifications require different handling
    return true;
  }
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  return finalStatus === 'granted';
}

// Request location permissions
export async function requestLocationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false; // Geolocation works differently on web
  }
  
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  
  if (foregroundStatus !== 'granted') {
    return false;
  }
  
  // Request background location for geofencing on mobile
  if (Platform.OS !== 'web') {
    try {
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      return backgroundStatus === 'granted';
    } catch (e) {
      console.log('Background location not available');
      return true; // Still allow foreground
    }
  }
  
  return true;
}

// Pre-generate notification messages for the day
export async function pregenerateNotifications(): Promise<CachedMessages | null> {
  try {
    const deviceId = await AsyncStorage.getItem('deviceId');
    if (!deviceId) return null;
    
    const response = await axios.post(`${API_URL}/api/pregenerate-notifications/${deviceId}`);
    cachedMessages = response.data.messages;
    
    // Store locally for offline access
    await AsyncStorage.setItem('cached_notifications', JSON.stringify(cachedMessages));
    await AsyncStorage.setItem('cached_notifications_date', new Date().toDateString());
    
    return cachedMessages;
  } catch (error) {
    console.error('Error pregenerating notifications:', error);
    
    // Try to load from local cache
    const cached = await AsyncStorage.getItem('cached_notifications');
    if (cached) {
      cachedMessages = JSON.parse(cached);
      return cachedMessages;
    }
    return null;
  }
}

// Get cached message with fallback
export async function getCachedMessage(type: 'habit_all' | 'habit_0' | 'habit_1' | 'habit_2' | 'checkin'): Promise<string> {
  // Check if we need to regenerate (new day)
  const cachedDate = await AsyncStorage.getItem('cached_notifications_date');
  const today = new Date().toDateString();
  
  if (cachedDate !== today || !cachedMessages) {
    await pregenerateNotifications();
  }
  
  if (cachedMessages && cachedMessages[type]) {
    return cachedMessages[type];
  }
  
  // Fallback messages
  const fallbacks = {
    habit_all: "Zeit fuer deine Tiny Habits! Du schaffst das!",
    habit_0: "Denk an deine erste Gewohnheit!",
    habit_1: "Zeit fuer Gewohnheit Nr. 2!",
    habit_2: "Vergiss nicht deine dritte Gewohnheit!",
    checkin: "Zeit fuer deinen Check-In!"
  };
  
  return fallbacks[type];
}

// Schedule a local notification
export async function scheduleNotification(
  title: string,
  body: string,
  trigger: Notifications.NotificationTriggerInput,
  identifier?: string
): Promise<string> {
  if (Platform.OS === 'web') {
    console.log('Scheduled notification (web):', { title, body });
    return 'web-' + Date.now();
  }
  
  return await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
    },
    trigger,
    identifier,
  });
}

// Schedule daily habit reminder
export async function scheduleHabitReminder(
  time: string, // "HH:MM" format
  days: number[], // 0=Monday, 1=Tuesday, etc.
  goalIndex?: number // undefined = all goals, 0-2 = specific goal
): Promise<string[]> {
  if (Platform.OS === 'web') {
    console.log('Habit reminder scheduled (web):', { time, days, goalIndex });
    return [];
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  const identifiers: string[] = [];
  
  const messageType = goalIndex !== undefined ? `habit_${goalIndex}` as const : 'habit_all';
  const message = await getCachedMessage(messageType);
  
  for (const day of days) {
    // Convert our day format (0=Monday) to JS format (1=Sunday, 2=Monday, etc.)
    const expoDay = day === 6 ? 1 : day + 2; // Convert: 0(Mon)->2, 6(Sun)->1
    
    const trigger: Notifications.WeeklyTriggerInput = {
      weekday: expoDay,
      hour: hours,
      minute: minutes,
      repeats: true,
    };
    
    const goalText = goalIndex !== undefined ? ` (Ziel ${goalIndex + 1})` : '';
    const id = await scheduleNotification(
      `Tiny Habits Erinnerung${goalText}`,
      message,
      trigger,
      `habit_${goalIndex ?? 'all'}_day_${day}`
    );
    identifiers.push(id);
  }
  
  return identifiers;
}

// Schedule daily check-in reminder
export async function scheduleCheckinReminder(
  time: string,
  days: number[]
): Promise<string[]> {
  if (Platform.OS === 'web') {
    console.log('Check-in reminder scheduled (web):', { time, days });
    return [];
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  const identifiers: string[] = [];
  
  const message = await getCachedMessage('checkin');
  
  for (const day of days) {
    const expoDay = day === 6 ? 1 : day + 2;
    
    const trigger: Notifications.WeeklyTriggerInput = {
      weekday: expoDay,
      hour: hours,
      minute: minutes,
      repeats: true,
    };
    
    const id = await scheduleNotification(
      "Check-In Erinnerung",
      message,
      trigger,
      `checkin_day_${day}`
    );
    identifiers.push(id);
  }
  
  return identifiers;
}

// Cancel all scheduled notifications
export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// Cancel specific notification
export async function cancelNotification(identifier: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// Setup geofencing for a location (simplified - stores in AsyncStorage)
export async function setupGeofence(
  goalIndex: number,
  latitude: number,
  longitude: number,
  radius: number = 100
): Promise<void> {
  // Store geofence data in AsyncStorage
  // On mobile devices with Expo Go, full geofencing requires a custom dev build
  // This stores the configuration for later use
  const geofences = JSON.parse(await AsyncStorage.getItem('geofences') || '{}');
  geofences[`goal_${goalIndex}`] = {
    latitude,
    longitude,
    radius,
    enabled: true,
  };
  await AsyncStorage.setItem('geofences', JSON.stringify(geofences));
  console.log(`Geofence set for goal ${goalIndex}:`, { latitude, longitude, radius });
}

// Remove geofence for a goal
export async function removeGeofence(goalIndex: number): Promise<void> {
  const geofences = JSON.parse(await AsyncStorage.getItem('geofences') || '{}');
  delete geofences[`goal_${goalIndex}`];
  await AsyncStorage.setItem('geofences', JSON.stringify(geofences));
}

// Get current location
export async function getCurrentLocation(): Promise<Location.LocationObject | null> {
  if (Platform.OS === 'web') {
    // Use browser geolocation API
    return new Promise((resolve) => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              coords: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                altitude: position.coords.altitude,
                accuracy: position.coords.accuracy,
                altitudeAccuracy: position.coords.altitudeAccuracy,
                heading: position.coords.heading,
                speed: position.coords.speed,
              },
              timestamp: position.timestamp,
            } as Location.LocationObject);
          },
          () => resolve(null)
        );
      } else {
        resolve(null);
      }
    });
  }
  
  const hasPermission = await requestLocationPermissions();
  if (!hasPermission) return null;
  
  return await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
}

// Reverse geocode to get address
export async function getAddressFromCoordinates(
  latitude: number,
  longitude: number
): Promise<string> {
  if (Platform.OS === 'web') {
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  }
  
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (results.length > 0) {
      const addr = results[0];
      return `${addr.street || ''} ${addr.streetNumber || ''}, ${addr.city || addr.region || ''}`.trim();
    }
  } catch (error) {
    console.error('Reverse geocode error:', error);
  }
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

// Initialize notification system
export async function initializeNotifications(): Promise<void> {
  // Request permissions
  await requestNotificationPermissions();
  
  // Pre-generate messages for the day
  await pregenerateNotifications();
  
  // Setup notification channel for Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B6B',
    });
  }
}
