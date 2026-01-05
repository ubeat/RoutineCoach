import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Platform } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Task name for geofencing
const GEOFENCE_TASK = 'geofence-location-task';

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

interface GeofenceData {
  latitude: number;
  longitude: number;
  radius: number;
  enabled: boolean;
  locationName: string;
  goalName: string;
}

// Available notification sounds
export const NOTIFICATION_SOUNDS = [
  { id: 'default', name: 'Standard', icon: 'notifications' },
  { id: 'gentle', name: 'Sanft', icon: 'water' },
  { id: 'cheerful', name: 'Froehlich', icon: 'happy' },
  { id: 'energetic', name: 'Energisch', icon: 'flash' },
  { id: 'calm', name: 'Ruhig', icon: 'leaf' },
  { id: 'bell', name: 'Glocke', icon: 'notifications-circle' },
];

let cachedMessages: CachedMessages | null = null;

// Request notification permissions
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') {
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

// Request location permissions (foreground + background for geofencing)
export async function requestLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  if (Platform.OS === 'web') {
    return { foreground: true, background: false };
  }
  
  // Request foreground first
  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  const foregroundGranted = foregroundStatus === 'granted';
  
  if (!foregroundGranted) {
    return { foreground: false, background: false };
  }
  
  // Request background for geofencing
  let backgroundGranted = false;
  try {
    const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
    backgroundGranted = backgroundStatus === 'granted';
  } catch (e) {
    console.log('Background location not available on this device');
  }
  
  return { foreground: foregroundGranted, background: backgroundGranted };
}

// Pre-generate notification messages for the day
export async function pregenerateNotifications(): Promise<CachedMessages | null> {
  try {
    const deviceId = await AsyncStorage.getItem('deviceId');
    if (!deviceId) return null;
    
    const response = await axios.post(`${API_URL}/api/pregenerate-notifications/${deviceId}`);
    cachedMessages = response.data.messages;
    
    await AsyncStorage.setItem('cached_notifications', JSON.stringify(cachedMessages));
    await AsyncStorage.setItem('cached_notifications_date', new Date().toDateString());
    
    return cachedMessages;
  } catch (error) {
    console.error('Error pregenerating notifications:', error);
    
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
  const cachedDate = await AsyncStorage.getItem('cached_notifications_date');
  const today = new Date().toDateString();
  
  if (cachedDate !== today || !cachedMessages) {
    await pregenerateNotifications();
  }
  
  if (cachedMessages && cachedMessages[type]) {
    return cachedMessages[type];
  }
  
  const fallbacks = {
    habit_all: "Zeit fuer deine Gewohnheiten! Du schaffst das! 💪",
    habit_0: "Denk an deine erste Gewohnheit! 🌟",
    habit_1: "Zeit fuer Gewohnheit Nr. 2! 💜",
    habit_2: "Vergiss nicht deine dritte Gewohnheit! ✨",
    checkin: "Zeit fuer deinen Check-In! Wie war dein Tag? 📊"
  };
  
  return fallbacks[type];
}

// Schedule a local notification with sound
export async function scheduleNotification(
  title: string,
  body: string,
  trigger: Notifications.NotificationTriggerInput,
  identifier?: string,
  soundId?: string
): Promise<string> {
  if (Platform.OS === 'web') {
    console.log('Scheduled notification (web):', { title, body });
    return 'web-' + Date.now();
  }
  
  // Note: Custom sounds require the sound file to be in the app bundle
  // For now we use the default sound, but the soundId is stored for future use
  const content: Notifications.NotificationContentInput = {
    title,
    body,
    sound: true, // Uses default sound
    data: { soundId: soundId || 'default' },
  };
  
  return await Notifications.scheduleNotificationAsync({
    content,
    trigger,
    identifier,
  });
}

// Schedule daily habit reminder
export async function scheduleHabitReminder(
  time: string,
  days: number[],
  goalIndex?: number,
  soundId?: string
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
    const expoDay = day === 6 ? 1 : day + 2;
    
    const trigger: Notifications.WeeklyTriggerInput = {
      weekday: expoDay,
      hour: hours,
      minute: minutes,
      repeats: true,
    };
    
    const goalText = goalIndex !== undefined ? ` (Ziel ${goalIndex + 1})` : '';
    const id = await scheduleNotification(
      `Schritt für Schritt${goalText}`,
      message,
      trigger,
      `habit_${goalIndex ?? 'all'}_day_${day}`,
      soundId
    );
    identifiers.push(id);
  }
  
  return identifiers;
}

// Schedule daily check-in reminder
export async function scheduleCheckinReminder(
  time: string,
  days: number[],
  soundId?: string
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
      "Check-In Erinnerung 📊",
      message,
      trigger,
      `checkin_day_${day}`,
      soundId
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

// ==================== GEOFENCING ====================

// Define the background task for geofencing
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Geofence task error:', error);
    return;
  }
  
  if (data) {
    const { eventType, region } = data as { 
      eventType: Location.GeofencingEventType; 
      region: Location.LocationRegion;
    };
    
    // Only trigger on ENTER
    if (eventType === Location.GeofencingEventType.Enter) {
      // Get stored geofence info
      const geofences = await getStoredGeofences();
      const geofenceData = Object.values(geofences).find(
        (g: any) => g.identifier === region.identifier
      ) as GeofenceData | undefined;
      
      if (geofenceData) {
        // Send notification
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Du bist bei: ${geofenceData.locationName}`,
            body: `Zeit für: ${geofenceData.goalName}! 💪`,
            sound: true,
          },
          trigger: null, // Immediate
        });
      }
    }
  }
});

// Get stored geofences
export async function getStoredGeofences(): Promise<Record<string, GeofenceData>> {
  const stored = await AsyncStorage.getItem('geofences');
  return stored ? JSON.parse(stored) : {};
}

// Setup geofencing for a location
export async function setupGeofence(
  goalIndex: number,
  latitude: number,
  longitude: number,
  locationName: string,
  goalName: string,
  radius: number = 100
): Promise<boolean> {
  const identifier = `goal_${goalIndex}`;
  
  // Store geofence data
  const geofences = await getStoredGeofences();
  geofences[identifier] = {
    latitude,
    longitude,
    radius,
    enabled: true,
    locationName,
    goalName,
  };
  await AsyncStorage.setItem('geofences', JSON.stringify(geofences));
  
  // On web, just store the data (no actual geofencing)
  if (Platform.OS === 'web') {
    console.log(`Geofence stored for goal ${goalIndex}:`, { latitude, longitude, locationName });
    return true;
  }
  
  // Check for background permission
  const permissions = await requestLocationPermissions();
  if (!permissions.background) {
    console.log('Background location not granted - geofencing will not work in background');
    // Still store the data, but warn user
    return false;
  }
  
  try {
    // Start geofencing
    const regions: Location.LocationRegion[] = Object.entries(geofences)
      .filter(([_, data]) => (data as GeofenceData).enabled)
      .map(([id, data]) => ({
        identifier: id,
        latitude: (data as GeofenceData).latitude,
        longitude: (data as GeofenceData).longitude,
        radius: (data as GeofenceData).radius,
        notifyOnEnter: true,
        notifyOnExit: false,
      }));
    
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    console.log('Geofencing started with regions:', regions);
    return true;
  } catch (error) {
    console.error('Error starting geofencing:', error);
    return false;
  }
}

// Remove geofence for a goal
export async function removeGeofence(goalIndex: number): Promise<void> {
  const identifier = `goal_${goalIndex}`;
  const geofences = await getStoredGeofences();
  delete geofences[identifier];
  await AsyncStorage.setItem('geofences', JSON.stringify(geofences));
  
  if (Platform.OS === 'web') return;
  
  try {
    // Restart geofencing with remaining regions
    const remainingRegions: Location.LocationRegion[] = Object.entries(geofences)
      .filter(([_, data]) => (data as GeofenceData).enabled)
      .map(([id, data]) => ({
        identifier: id,
        latitude: (data as GeofenceData).latitude,
        longitude: (data as GeofenceData).longitude,
        radius: (data as GeofenceData).radius,
        notifyOnEnter: true,
        notifyOnExit: false,
      }));
    
    if (remainingRegions.length > 0) {
      await Location.startGeofencingAsync(GEOFENCE_TASK, remainingRegions);
    } else {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch (error) {
    console.error('Error updating geofencing:', error);
  }
}

// Get current location
export async function getCurrentLocation(): Promise<Location.LocationObject | null> {
  if (Platform.OS === 'web') {
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
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        resolve(null);
      }
    });
  }
  
  const permissions = await requestLocationPermissions();
  if (!permissions.foreground) return null;
  
  return await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
}

// Reverse geocode to get address
export async function getAddressFromCoordinates(
  latitude: number,
  longitude: number
): Promise<string> {
  if (Platform.OS === 'web') {
    // Use a free geocoding API for web
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'de' } }
      );
      const data = await response.json();
      if (data.display_name) {
        // Shorten the address
        const parts = data.display_name.split(',').slice(0, 3);
        return parts.join(', ');
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    }
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  }
  
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (results.length > 0) {
      const addr = results[0];
      const street = addr.street ? `${addr.street} ${addr.streetNumber || ''}`.trim() : '';
      const city = addr.city || addr.region || '';
      return street ? `${street}, ${city}` : city || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    }
  } catch (error) {
    console.error('Reverse geocode error:', error);
  }
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

// Search for location by address (for map search)
export async function searchLocation(query: string): Promise<Array<{
  latitude: number;
  longitude: number;
  name: string;
}>> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { 'Accept-Language': 'de' } }
    );
    const data = await response.json();
    return data.map((item: any) => ({
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      name: item.display_name.split(',').slice(0, 3).join(', '),
    }));
  } catch (error) {
    console.error('Location search error:', error);
    return [];
  }
}

// Initialize notification system
export async function initializeNotifications(): Promise<void> {
  await requestNotificationPermissions();
  await pregenerateNotifications();
  
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Schritt für Schritt',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B6B',
      sound: 'default',
    });
  }
  
  // Restore geofences on app start (mobile only)
  if (Platform.OS !== 'web') {
    const geofences = await getStoredGeofences();
    const regions: Location.LocationRegion[] = Object.entries(geofences)
      .filter(([_, data]) => (data as GeofenceData).enabled)
      .map(([id, data]) => ({
        identifier: id,
        latitude: (data as GeofenceData).latitude,
        longitude: (data as GeofenceData).longitude,
        radius: (data as GeofenceData).radius,
        notifyOnEnter: true,
        notifyOnExit: false,
      }));
    
    if (regions.length > 0) {
      try {
        const permissions = await requestLocationPermissions();
        if (permissions.background) {
          await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
          console.log('Geofences restored on app start');
        }
      } catch (error) {
        console.log('Could not restore geofences:', error);
      }
    }
  }
}
