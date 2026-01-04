import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const LOCATION_TASK_NAME = 'background-location-task';
const GEOFENCE_TASK_NAME = 'geofence-task';

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
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  
  if (foregroundStatus !== 'granted') {
    return false;
  }
  
  // Request background location for geofencing
  if (Platform.OS !== 'web') {
    const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
    return backgroundStatus === 'granted';
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
  days: number[], // 0=Sunday, 1=Monday, etc.
  goalIndex?: number // undefined = all goals, 0-2 = specific goal
): Promise<string[]> {
  const [hours, minutes] = time.split(':').map(Number);
  const identifiers: string[] = [];
  
  const messageType = goalIndex !== undefined ? `habit_${goalIndex}` as const : 'habit_all';
  const message = await getCachedMessage(messageType);
  
  for (const day of days) {
    // Convert our day format (0=Monday) to JS format (0=Sunday)
    const jsDay = (day + 1) % 7;
    
    const trigger: Notifications.WeeklyTriggerInput = {
      weekday: jsDay + 1, // 1-7 in Expo
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
  const [hours, minutes] = time.split(':').map(Number);
  const identifiers: string[] = [];
  
  const message = await getCachedMessage('checkin');
  
  for (const day of days) {
    const jsDay = (day + 1) % 7;
    
    const trigger: Notifications.WeeklyTriggerInput = {
      weekday: jsDay + 1,
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
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// Cancel specific notification
export async function cancelNotification(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// Setup geofencing for a location
export async function setupGeofence(
  goalIndex: number,
  latitude: number,
  longitude: number,
  radius: number = 100
): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('Geofencing not available on web');
    return;
  }
  
  const hasPermission = await requestLocationPermissions();
  if (!hasPermission) {
    throw new Error('Location permission required for geofencing');
  }
  
  // Define the geofence region
  const region = {
    identifier: `goal_${goalIndex}`,
    latitude,
    longitude,
    radius,
    notifyOnEnter: true,
    notifyOnExit: false,
  };
  
  // Start geofencing
  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, [region]);
}

// Remove geofence for a goal
export async function removeGeofence(goalIndex: number): Promise<void> {
  if (Platform.OS === 'web') return;
  
  try {
    const regions = await Location.getGeofencingAsync(GEOFENCE_TASK_NAME);
    const updatedRegions = regions.filter(r => r.identifier !== `goal_${goalIndex}`);
    
    if (updatedRegions.length > 0) {
      await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, updatedRegions);
    } else {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
  } catch (error) {
    console.log('No active geofences to remove');
  }
}

// Get current location
export async function getCurrentLocation(): Promise<Location.LocationObject | null> {
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

// Define the geofence task
if (Platform.OS !== 'web') {
  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.error('Geofence task error:', error);
      return;
    }
    
    if (data) {
      const { eventType, region } = data as { eventType: number; region: { identifier: string } };
      
      // eventType 1 = Enter, 2 = Exit
      if (eventType === 1) {
        const goalIndex = parseInt(region.identifier.replace('goal_', ''));
        const message = await getCachedMessage(`habit_${goalIndex}` as const);
        
        // Add human-like delay (1-2 seconds)
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Du bist angekommen!`,
            body: message,
            sound: true,
          },
          trigger: null, // Immediate
        });
      }
    }
  });
}
