import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  FlatList,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { languages, setLanguage, getCurrentLanguage, LanguageCode } from '../i18n';
import {
  initializeNotifications,
  scheduleHabitReminder,
  scheduleCheckinReminder,
  cancelAllNotifications,
  requestLocationPermissions,
  getCurrentLocation,
  getAddressFromCoordinates,
  setupGeofence,
  removeGeofence,
  searchLocation,
  getStoredGeofences,
  NOTIFICATION_SOUNDS,
} from '../services/NotificationService';
import { COLOR_PALETTES } from '../contexts/SettingsContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const WEEKDAYS = [
  { short: 'Mo', full: 'Montag', index: 0 },
  { short: 'Di', full: 'Dienstag', index: 1 },
  { short: 'Mi', full: 'Mittwoch', index: 2 },
  { short: 'Do', full: 'Donnerstag', index: 3 },
  { short: 'Fr', full: 'Freitag', index: 4 },
  { short: 'Sa', full: 'Samstag', index: 5 },
  { short: 'So', full: 'Sonntag', index: 6 },
];

// Generate hours and minutes arrays
const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
const ITEM_HEIGHT = 50;

interface LocationSetting {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  locationName: string | null;
  radius: number;
}

interface Settings {
  habit_reminders: {
    enabled: boolean;
    use_same_time: boolean;
    time: string;
    individual_times: string[];
    days: number[];
    locations: LocationSetting[];
  };
  checkin_reminder: {
    enabled: boolean;
    time: string;
    days: number[];
  };
  appearance: {
    color_palette: string;
    notification_sound: string;
  };
}

const defaultSettings: Settings = {
  habit_reminders: {
    enabled: true,
    use_same_time: true,
    time: "08:00",
    individual_times: ["08:00", "12:00", "18:00"],
    days: [0, 1, 2, 3, 4, 5, 6],
    locations: [
      { enabled: false, latitude: null, longitude: null, address: null, locationName: null, radius: 100 },
      { enabled: false, latitude: null, longitude: null, address: null, locationName: null, radius: 100 },
      { enabled: false, latitude: null, longitude: null, address: null, locationName: null, radius: 100 },
    ],
  },
  checkin_reminder: {
    enabled: true,
    time: "20:00",
    days: [0, 1, 2, 3, 4, 5, 6],
  },
  appearance: {
    color_palette: "sonnenuntergang",
    notification_sound: "default",
  },
};

// Custom Time Picker Wheel Component
const TimePickerWheel = ({ 
  selectedHour, 
  selectedMinute, 
  onHourChange, 
  onMinuteChange,
  colors 
}: {
  selectedHour: string;
  selectedMinute: string;
  onHourChange: (hour: string) => void;
  onMinuteChange: (minute: string) => void;
  colors: any;
}) => {
  const hourListRef = useRef<FlatList>(null);
  const minuteListRef = useRef<FlatList>(null);

  useEffect(() => {
    const hourIndex = HOURS.indexOf(selectedHour);
    const minuteIndex = MINUTES.indexOf(selectedMinute);
    
    setTimeout(() => {
      hourListRef.current?.scrollToIndex({ index: hourIndex, animated: false });
      minuteListRef.current?.scrollToIndex({ index: minuteIndex, animated: false });
    }, 100);
  }, []);

  const renderHourItem = ({ item, index }: { item: string; index: number }) => {
    const isSelected = item === selectedHour;
    return (
      <TouchableOpacity
        style={[styles.wheelItem, isSelected && { backgroundColor: colors.primary + '20' }]}
        onPress={() => onHourChange(item)}
      >
        <Text style={[
          styles.wheelItemText,
          { color: isSelected ? colors.primary : colors.textLight },
          isSelected && styles.wheelItemTextSelected
        ]}>
          {item}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderMinuteItem = ({ item, index }: { item: string; index: number }) => {
    const isSelected = item === selectedMinute;
    return (
      <TouchableOpacity
        style={[styles.wheelItem, isSelected && { backgroundColor: colors.primary + '20' }]}
        onPress={() => onMinuteChange(item)}
      >
        <Text style={[
          styles.wheelItemText,
          { color: isSelected ? colors.primary : colors.textLight },
          isSelected && styles.wheelItemTextSelected
        ]}>
          {item}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wheelContainer}>
      <View style={styles.wheelColumn}>
        <Text style={[styles.wheelLabel, { color: colors.textLight }]}>Stunde</Text>
        <View style={[styles.wheelWrapper, { borderColor: colors.primary }]}>
          <FlatList
            ref={hourListRef}
            data={HOURS}
            renderItem={renderHourItem}
            keyExtractor={(item) => `hour-${item}`}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              length: ITEM_HEIGHT,
              offset: ITEM_HEIGHT * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
              if (HOURS[index]) onHourChange(HOURS[index]);
            }}
            style={styles.wheelList}
          />
        </View>
      </View>
      
      <Text style={[styles.wheelSeparator, { color: colors.text }]}>:</Text>
      
      <View style={styles.wheelColumn}>
        <Text style={[styles.wheelLabel, { color: colors.textLight }]}>Minute</Text>
        <View style={[styles.wheelWrapper, { borderColor: colors.primary }]}>
          <FlatList
            ref={minuteListRef}
            data={MINUTES}
            renderItem={renderMinuteItem}
            keyExtractor={(item) => `minute-${item}`}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            getItemLayout={(_, index) => ({
              length: ITEM_HEIGHT,
              offset: ITEM_HEIGHT * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
              if (MINUTES[index]) onMinuteChange(MINUTES[index]);
            }}
            style={styles.wheelList}
          />
        </View>
      </View>
    </View>
  );
};

// Quick time preset buttons
const TimePresets = ({ onSelect, colors }: { onSelect: (time: string) => void; colors: any }) => {
  const presets = [
    { label: '06:00', icon: 'sunny-outline' },
    { label: '07:00', icon: 'sunny-outline' },
    { label: '08:00', icon: 'sunny' },
    { label: '09:00', icon: 'partly-sunny' },
    { label: '12:00', icon: 'sunny' },
    { label: '18:00', icon: 'partly-sunny-outline' },
    { label: '19:00', icon: 'moon-outline' },
    { label: '20:00', icon: 'moon' },
    { label: '21:00', icon: 'moon' },
    { label: '22:00', icon: 'cloudy-night' },
  ];

  return (
    <View style={styles.presetsContainer}>
      <Text style={[styles.presetsTitle, { color: colors.textLight }]}>Schnellauswahl:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {presets.map((preset) => (
          <TouchableOpacity
            key={preset.label}
            style={[styles.presetButton, { backgroundColor: colors.background }]}
            onPress={() => onSelect(preset.label)}
          >
            <Ionicons name={preset.icon as any} size={16} color={colors.primary} />
            <Text style={[styles.presetText, { color: colors.text }]}>{preset.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

export default function SettingsScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ scrollTo?: string }>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [goals, setGoals] = useState<string[]>([]);
  const [userName, setUserName] = useState<string>('');
  const [showTimePicker, setShowTimePicker] = useState<{
    visible: boolean;
    type: 'habit' | 'checkin' | 'individual';
    index?: number;
  }>({ visible: false, type: 'habit' });
  const [tempTime, setTempTime] = useState({ hour: '08', minute: '00' });
  
  // ScrollView ref for auto-scrolling to language section
  const scrollViewRef = useRef<ScrollView>(null);
  const languageSectionY = useRef(0);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [settingLocation, setSettingLocation] = useState<number | null>(null);
  
  // Location Modal State
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locationGoalIndex, setLocationGoalIndex] = useState<number>(0);
  const [mapRegion, setMapRegion] = useState({
    latitude: 47.3769, // Zürich default
    longitude: 8.5417,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
    address: string;
  } | null>(null);
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    latitude: number;
    longitude: number;
    name: string;
  }>>([]);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const mapRef = useRef<MapView>(null);
  
  // Sound Modal State
  const [showSoundPicker, setShowSoundPicker] = useState(false);

  const colors = COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang;

  useEffect(() => {
    loadSettings();
    loadUserName();
  }, []);

  // Scroll to language section if requested via route param
  useEffect(() => {
    if (searchParams.scrollTo === 'language' && !loading) {
      // Wait for content to be rendered, then scroll
      setTimeout(() => {
        if (languageSectionY.current > 0) {
          scrollViewRef.current?.scrollTo({ y: languageSectionY.current - 50, animated: true });
        }
      }, 500);
    }
  }, [searchParams.scrollTo, loading]);

  // Load stored geofences on mount
  useEffect(() => {
    loadStoredGeofences();
  }, []);

  const loadStoredGeofences = async () => {
    try {
      const geofences = await getStoredGeofences();
      // Update settings with stored geofence data
      const updatedLocations = [...(settings.location_reminders || [])];
      
      for (let i = 0; i < 3; i++) {
        const geofence = geofences[`goal_${i}`];
        if (geofence) {
          updatedLocations[i] = {
            enabled: geofence.enabled,
            latitude: geofence.latitude,
            longitude: geofence.longitude,
            address: null,
            locationName: geofence.locationName,
            radius: geofence.radius,
          };
        }
      }
      
      if (JSON.stringify(updatedLocations) !== JSON.stringify(settings.location_reminders)) {
        setSettings(prev => ({
          ...prev,
          location_reminders: updatedLocations,
        }));
      }
    } catch (error) {
      console.log('Error loading geofences:', error);
    }
  };

  const loadUserName = async () => {
    const storedName = await AsyncStorage.getItem('userName');
    if (storedName) {
      setUserName(storedName);
    }
  };

  const saveUserName = async (name: string) => {
    await AsyncStorage.setItem('userName', name);
    setUserName(name);
  };

  const loadSettings = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) return;

      const [settingsRes, goalsRes] = await Promise.all([
        axios.get(`${API_URL}/api/settings/${deviceId}`),
        axios.get(`${API_URL}/api/goals/${deviceId}`),
      ]);

      if (settingsRes.data) {
        setSettings({
          ...defaultSettings,
          ...settingsRes.data,
          habit_reminders: {
            ...defaultSettings.habit_reminders,
            ...settingsRes.data.habit_reminders,
          },
          checkin_reminder: {
            ...defaultSettings.checkin_reminder,
            ...settingsRes.data.checkin_reminder,
          },
          appearance: {
            ...defaultSettings.appearance,
            ...settingsRes.data.appearance,
          },
        });
      }

      if (goalsRes.data.goals) {
        setGoals(goalsRes.data.goals);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      
      await axios.post(`${API_URL}/api/settings/${deviceId}`, {
        habit_reminders: settings.habit_reminders,
        checkin_reminder: settings.checkin_reminder,
        appearance: settings.appearance,
      });

      // Reschedule notifications
      await cancelAllNotifications();
      await initializeNotifications();

      if (settings.habit_reminders.enabled) {
        if (settings.habit_reminders.use_same_time) {
          await scheduleHabitReminder(
            settings.habit_reminders.time,
            settings.habit_reminders.days
          );
        } else {
          for (let i = 0; i < 3; i++) {
            await scheduleHabitReminder(
              settings.habit_reminders.individual_times[i],
              settings.habit_reminders.days,
              i
            );
          }
        }
      }

      if (settings.checkin_reminder.enabled) {
        await scheduleCheckinReminder(
          settings.checkin_reminder.time,
          settings.checkin_reminder.days
        );
      }

      // Setup geofences
      for (let i = 0; i < 3; i++) {
        const loc = settings.habit_reminders.locations[i];
        if (loc.enabled && loc.latitude && loc.longitude) {
          await setupGeofence(i, loc.latitude, loc.longitude, loc.radius);
        } else {
          await removeGeofence(i);
        }
      }

      Alert.alert('Gespeichert!', 'Deine Einstellungen wurden gespeichert.');
    } catch (error) {
      console.error('Error saving settings:', error);
      Alert.alert('Fehler', 'Einstellungen konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const openTimePicker = (type: 'habit' | 'checkin' | 'individual', index?: number) => {
    let currentTime = '08:00';
    if (type === 'habit') {
      currentTime = settings.habit_reminders.time;
    } else if (type === 'checkin') {
      currentTime = settings.checkin_reminder.time;
    } else if (type === 'individual' && index !== undefined) {
      currentTime = settings.habit_reminders.individual_times[index];
    }
    
    const [hour, minute] = currentTime.split(':');
    setTempTime({ hour, minute });
    setShowTimePicker({ visible: true, type, index });
  };

  const confirmTime = () => {
    const timeString = `${tempTime.hour}:${tempTime.minute}`;
    
    if (showTimePicker.type === 'habit') {
      setSettings({
        ...settings,
        habit_reminders: { ...settings.habit_reminders, time: timeString },
      });
    } else if (showTimePicker.type === 'checkin') {
      setSettings({
        ...settings,
        checkin_reminder: { ...settings.checkin_reminder, time: timeString },
      });
    } else if (showTimePicker.type === 'individual' && showTimePicker.index !== undefined) {
      const newTimes = [...settings.habit_reminders.individual_times];
      newTimes[showTimePicker.index] = timeString;
      setSettings({
        ...settings,
        habit_reminders: { ...settings.habit_reminders, individual_times: newTimes },
      });
    }
    
    setShowTimePicker({ ...showTimePicker, visible: false });
  };

  const selectPresetTime = (time: string) => {
    const [hour, minute] = time.split(':');
    setTempTime({ hour, minute });
  };

  const toggleDay = (dayIndex: number, type: 'habit' | 'checkin') => {
    if (type === 'habit') {
      const days = settings.habit_reminders.days.includes(dayIndex)
        ? settings.habit_reminders.days.filter(d => d !== dayIndex)
        : [...settings.habit_reminders.days, dayIndex];
      setSettings({
        ...settings,
        habit_reminders: { ...settings.habit_reminders, days },
      });
    } else {
      const days = settings.checkin_reminder.days.includes(dayIndex)
        ? settings.checkin_reminder.days.filter(d => d !== dayIndex)
        : [...settings.checkin_reminder.days, dayIndex];
      setSettings({
        ...settings,
        checkin_reminder: { ...settings.checkin_reminder, days },
      });
    }
  };

  const setCurrentLocation = async (goalIndex: number) => {
    setLocationGoalIndex(goalIndex);
    setLoadingLocation(true);
    setShowLocationModal(true);
    setSelectedLocation(null);
    setLocationSearchQuery('');
    setLocationSearchResults([]);
    
    try {
      const permissions = await requestLocationPermissions();
      if (!permissions.foreground) {
        Alert.alert(
          'Standort-Berechtigung',
          'Bitte erlaube den Standortzugriff in den Einstellungen.'
        );
        setShowLocationModal(false);
        return;
      }

      const location = await getCurrentLocation();
      if (location) {
        const address = await getAddressFromCoordinates(
          location.coords.latitude,
          location.coords.longitude
        );

        setMapRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
        
        setSelectedLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          address: address,
        });
      }
    } catch (error) {
      console.error('Error getting location:', error);
    } finally {
      setLoadingLocation(false);
    }
  };

  const openLocationPicker = (goalIndex: number) => {
    setLocationGoalIndex(goalIndex);
    setShowLocationModal(true);
    setSelectedLocation(null);
    setLocationSearchQuery('');
    setLocationSearchResults([]);
    
    // Check if there's already a saved location for this goal
    const existingLoc = settings.habit_reminders.locations[goalIndex];
    if (existingLoc?.latitude && existingLoc?.longitude) {
      setMapRegion({
        latitude: existingLoc.latitude,
        longitude: existingLoc.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      setSelectedLocation({
        latitude: existingLoc.latitude,
        longitude: existingLoc.longitude,
        address: existingLoc.address || '',
      });
    }
  };

  const handleLocationSearch = async () => {
    if (!locationSearchQuery.trim()) return;
    
    setLoadingLocation(true);
    try {
      const results = await searchLocation(locationSearchQuery);
      setLocationSearchResults(results);
      
      // If results found, zoom to first one
      if (results.length > 0) {
        setMapRegion({
          latitude: results[0].latitude,
          longitude: results[0].longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoadingLocation(false);
    }
  };

  const selectSearchResult = (result: { latitude: number; longitude: number; name: string }) => {
    setSelectedLocation({
      latitude: result.latitude,
      longitude: result.longitude,
      address: result.name,
    });
    setMapRegion({
      latitude: result.latitude,
      longitude: result.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
    setLocationSearchResults([]);
  };

  const handleMapPress = async (event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setLoadingLocation(true);
    
    try {
      const address = await getAddressFromCoordinates(latitude, longitude);
      setSelectedLocation({
        latitude,
        longitude,
        address,
      });
    } catch (error) {
      setSelectedLocation({
        latitude,
        longitude,
        address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      });
    } finally {
      setLoadingLocation(false);
    }
  };

  const confirmLocationSelection = async () => {
    if (!selectedLocation) return;
    
    const goalName = goals[locationGoalIndex] || `Ziel ${locationGoalIndex + 1}`;
    
    // Save to settings state
    const newLocations = [...settings.habit_reminders.locations];
    newLocations[locationGoalIndex] = {
      enabled: true,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
      address: selectedLocation.address,
      locationName: selectedLocation.address,
      radius: 100,
    };
    setSettings({
      ...settings,
      habit_reminders: { ...settings.habit_reminders, locations: newLocations },
    });
    
    // Setup geofence
    const success = await setupGeofence(
      locationGoalIndex,
      selectedLocation.latitude,
      selectedLocation.longitude,
      selectedLocation.address,
      goalName,
      100
    );
    
    if (!success && Platform.OS !== 'web') {
      Alert.alert(
        'Hinweis',
        'Orts-Erinnerungen funktionieren nur mit Hintergrund-Standort-Berechtigung. Bitte erlaube diese in den System-Einstellungen.'
      );
    }
    
    setShowLocationModal(false);
    setSelectedLocation(null);
  };

  const disableLocationReminder = async (goalIndex: number) => {
    const newLocations = [...settings.habit_reminders.locations];
    newLocations[goalIndex] = {
      enabled: false,
      latitude: null,
      longitude: null,
      address: null,
      locationName: null,
      radius: 100,
    };
    setSettings({
      ...settings,
      habit_reminders: { ...settings.habit_reminders, locations: newLocations },
    });
    
    await removeGeofence(goalIndex);
  };

  const selectNotificationSound = async (soundId: string) => {
    // Play preview sound
    await playPreviewSound(soundId);
    
    setSettings({
      ...settings,
      appearance: { ...settings.appearance, notification_sound: soundId },
    });
  };

  const playPreviewSound = async (soundId: string) => {
    try {
      // Generate different tones based on soundId using Web Audio API or Expo Audio
      if (Platform.OS === 'web') {
        // Use Web Audio API for web
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Different frequencies for different sounds
        const soundConfigs: Record<string, { freq: number; type: OscillatorType; duration: number }> = {
          'default': { freq: 800, type: 'sine', duration: 0.15 },
          'gentle': { freq: 400, type: 'sine', duration: 0.3 },
          'cheerful': { freq: 1000, type: 'triangle', duration: 0.1 },
          'energetic': { freq: 1200, type: 'square', duration: 0.08 },
          'calm': { freq: 300, type: 'sine', duration: 0.4 },
          'bell': { freq: 600, type: 'triangle', duration: 0.2 },
        };
        
        const config = soundConfigs[soundId] || soundConfigs['default'];
        
        oscillator.type = config.type;
        oscillator.frequency.setValueAtTime(config.freq, audioContext.currentTime);
        
        // Fade in and out for smoother sound
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + config.duration);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + config.duration);
        
        // For bell, add a second harmonic
        if (soundId === 'bell') {
          const osc2 = audioContext.createOscillator();
          const gain2 = audioContext.createGain();
          osc2.connect(gain2);
          gain2.connect(audioContext.destination);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(1200, audioContext.currentTime);
          gain2.gain.setValueAtTime(0, audioContext.currentTime);
          gain2.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.01);
          gain2.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);
          osc2.start(audioContext.currentTime);
          osc2.stop(audioContext.currentTime + 0.3);
        }
        
        // For cheerful, play a quick melody
        if (soundId === 'cheerful') {
          setTimeout(() => {
            const osc2 = audioContext.createOscillator();
            const gain2 = audioContext.createGain();
            osc2.connect(gain2);
            gain2.connect(audioContext.destination);
            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(1200, audioContext.currentTime);
            gain2.gain.setValueAtTime(0.2, audioContext.currentTime);
            gain2.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
            osc2.start(audioContext.currentTime);
            osc2.stop(audioContext.currentTime + 0.1);
          }, 100);
        }
      } else {
        // For native, use Expo Notifications to play a preview
        // This triggers a local notification sound
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
        });
        
        // Since we don't have actual sound files, we'll just show feedback
        // In production, you'd load actual sound files here
        console.log(`Playing preview for sound: ${soundId}`);
      }
    } catch (error) {
      console.log('Could not play preview sound:', error);
    }
  };

  const closeSoundPicker = () => {
    setShowSoundPicker(false);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView ref={scrollViewRef} style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
        </View>

        {/* Premium & Admin Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <TouchableOpacity 
            style={styles.premiumButton}
            onPress={() => router.push('/premium')}
          >
            <View style={[styles.premiumIconBg, { backgroundColor: '#FFD700' }]}>
              <Ionicons name="diamond" size={24} color="#FFF" />
            </View>
            <View style={styles.premiumButtonContent}>
              <Text style={[styles.premiumButtonTitle, { color: colors.text }]}>{t('settings.premium')}</Text>
              <Text style={[styles.premiumButtonSubtitle, { color: colors.textLight }]}>
                {t('settings.premium_subtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
          </TouchableOpacity>
          
          <View style={[styles.settingDivider, { backgroundColor: colors.background }]} />
          
          <TouchableOpacity 
            style={styles.adminButton}
            onPress={() => router.push('/admin')}
          >
            <View style={[styles.adminIconBg, { backgroundColor: colors.primary + '20' }]}>
              <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.adminButtonText, { color: colors.textLight }]}>{t('settings.admin')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>
        </View>

        {/* Profile Section - Name */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-circle" size={24} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('settings.your_profile')}</Text>
          </View>
          
          <View style={styles.profileNameContainer}>
            <Text style={[styles.profileNameLabel, { color: colors.textLight }]}>
              {t('settings.name_question')}
            </Text>
            <View style={styles.profileNameInputRow}>
              <TextInput
                style={[styles.profileNameInput, { backgroundColor: colors.background, color: colors.text }]}
                value={userName}
                onChangeText={saveUserName}
                placeholder={t('settings.your_name')}
                placeholderTextColor={colors.textLight}
                maxLength={20}
              />
              <View style={[styles.profileNameIcon, { backgroundColor: colors.primary + '20' }]}>
                <Text style={styles.profileNameEmoji}>💜</Text>
              </View>
            </View>
            <Text style={[styles.profileNameHint, { color: colors.textLight }]}>
              Mit diesem Namen wirst du auf der Startseite begruesst
            </Text>
          </View>
        </View>

        {/* Habit Reminders Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="notifications" size={24} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('settings.habit_reminders')}</Text>
            <Switch
              value={settings.habit_reminders.enabled}
              onValueChange={(value) =>
                setSettings({
                  ...settings,
                  habit_reminders: { ...settings.habit_reminders, enabled: value },
                })
              }
              trackColor={{ false: '#E0E0E0', true: colors.primary }}
            />
          </View>

          {settings.habit_reminders.enabled && (
            <>
              {/* Same Time Toggle */}
              <View style={styles.settingRow}>
                <Text style={[styles.settingLabel, { color: colors.text }]}>
                  Gleiche Zeit fuer alle
                </Text>
                <Switch
                  value={settings.habit_reminders.use_same_time}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      habit_reminders: { ...settings.habit_reminders, use_same_time: value },
                    })
                  }
                  trackColor={{ false: '#E0E0E0', true: colors.primary }}
                />
              </View>

              {/* Time Settings */}
              {settings.habit_reminders.use_same_time ? (
                <TouchableOpacity
                  style={[styles.timeButton, { backgroundColor: colors.background }]}
                  onPress={() => openTimePicker('habit')}
                >
                  <Ionicons name="alarm" size={24} color={colors.primary} />
                  <View style={styles.timeButtonContent}>
                    <Text style={[styles.timeLabel, { color: colors.textLight }]}>{t('settings.reminder_time')}</Text>
                    <Text style={[styles.timeText, { color: colors.text }]}>
                      {settings.habit_reminders.time} Uhr
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
                </TouchableOpacity>
              ) : (
                <View style={styles.individualTimes}>
                  {goals.map((goal, index) => (
                    <TouchableOpacity
                      key={index}
                      style={[styles.individualTimeRow, { backgroundColor: colors.background }]}
                      onPress={() => openTimePicker('individual', index)}
                    >
                      <View style={[styles.goalBadge, { backgroundColor: [colors.primary, colors.secondary, colors.accent][index % 3] }]}>
                        <Text style={styles.goalBadgeText}>{index + 1}</Text>
                      </View>
                      <View style={styles.individualTimeContent}>
                        <Text style={[styles.goalText, { color: colors.text }]} numberOfLines={1}>
                          {goal || `Ziel ${index + 1}`}
                        </Text>
                        <Text style={[styles.individualTimeText, { color: colors.primary }]}>
                          {settings.habit_reminders.individual_times[index]} Uhr
                        </Text>
                      </View>
                      <Ionicons name="alarm" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Days Selection */}
              <Text style={[styles.subLabel, { color: colors.textLight }]}>
                An diesen Tagen erinnern:
              </Text>
              <View style={styles.daysRow}>
                {WEEKDAYS.map((day) => (
                  <TouchableOpacity
                    key={day.index}
                    style={[
                      styles.dayButton,
                      settings.habit_reminders.days.includes(day.index) && {
                        backgroundColor: colors.primary,
                      },
                    ]}
                    onPress={() => toggleDay(day.index, 'habit')}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: settings.habit_reminders.days.includes(day.index)
                            ? '#FFF'
                            : colors.text,
                        },
                      ]}
                    >
                      {day.short}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Geolocation Settings */}
              <View style={styles.geoSection}>
                <View style={styles.geoHeader}>
                  <Ionicons name="location" size={20} color={colors.secondary} />
                  <Text style={[styles.subLabel, { color: colors.text, marginLeft: 8 }]}>
                    Orts-basierte Erinnerungen
                  </Text>
                </View>
                <Text style={[styles.geoHint, { color: colors.textLight }]}>
                  Werde erinnert, wenn du an einem bestimmten Ort ankommst.
                </Text>

                {goals.map((goal, index) => {
                  const locationData = settings.habit_reminders.locations[index];
                  const hasLocation = locationData?.latitude && locationData?.longitude;
                  
                  return (
                    <View key={index} style={[styles.geoItem, { backgroundColor: colors.background }]}>
                      <View style={styles.geoItemHeader}>
                        <View style={[styles.goalBadge, { backgroundColor: [colors.primary, colors.secondary, colors.accent][index % 3] }]}>
                          <Text style={styles.goalBadgeText}>{index + 1}</Text>
                        </View>
                        <Text style={[styles.geoGoalText, { color: colors.text }]} numberOfLines={1}>
                          {goal || `Ziel ${index + 1}`}
                        </Text>
                      </View>

                      {hasLocation && locationData?.enabled ? (
                        <View style={styles.locationSetContainer}>
                          <View style={styles.locationSetInfo}>
                            <Ionicons name="checkmark-circle" size={16} color={colors.secondary} />
                            <Text style={[styles.locationSetText, { color: colors.text }]} numberOfLines={2}>
                              {locationData.address || locationData.locationName || 'Ort gesetzt'}
                            </Text>
                          </View>
                          <View style={styles.locationButtons}>
                            <TouchableOpacity
                              style={[styles.locationEditButton, { borderColor: colors.secondary }]}
                              onPress={() => openLocationPicker(index)}
                            >
                              <Ionicons name="create-outline" size={16} color={colors.secondary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.locationRemoveButton, { borderColor: colors.primary }]}
                              onPress={() => disableLocationReminder(index)}
                            >
                              <Ionicons name="trash-outline" size={16} color={colors.primary} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.setLocationButton, { borderColor: colors.secondary }]}
                          onPress={() => openLocationPicker(index)}
                        >
                          <Ionicons name="add-circle-outline" size={18} color={colors.secondary} />
                          <Text style={[styles.setLocationText, { color: colors.secondary }]}>
                            Ort auf Karte waehlen
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>

        {/* Check-In Reminder Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={24} color={colors.secondary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('settings.checkin_reminders')}</Text>
            <Switch
              value={settings.checkin_reminder.enabled}
              onValueChange={(value) =>
                setSettings({
                  ...settings,
                  checkin_reminder: { ...settings.checkin_reminder, enabled: value },
                })
              }
              trackColor={{ false: '#E0E0E0', true: colors.secondary }}
            />
          </View>

          {settings.checkin_reminder.enabled && (
            <>
              <TouchableOpacity
                style={[styles.timeButton, { backgroundColor: colors.background }]}
                onPress={() => openTimePicker('checkin')}
              >
                <Ionicons name="alarm" size={24} color={colors.secondary} />
                <View style={styles.timeButtonContent}>
                  <Text style={[styles.timeLabel, { color: colors.textLight }]}>Erinnerungszeit</Text>
                  <Text style={[styles.timeText, { color: colors.text }]}>
                    {settings.checkin_reminder.time} Uhr
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
              </TouchableOpacity>

              <Text style={[styles.subLabel, { color: colors.textLight }]}>
                An diesen Tagen erinnern:
              </Text>
              <View style={styles.daysRow}>
                {WEEKDAYS.map((day) => (
                  <TouchableOpacity
                    key={day.index}
                    style={[
                      styles.dayButton,
                      settings.checkin_reminder.days.includes(day.index) && {
                        backgroundColor: colors.secondary,
                      },
                    ]}
                    onPress={() => toggleDay(day.index, 'checkin')}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: settings.checkin_reminder.days.includes(day.index)
                            ? '#FFF'
                            : colors.text,
                        },
                      ]}
                    >
                      {day.short}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Appearance Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="color-palette" size={24} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Aussehen</Text>
          </View>

          <TouchableOpacity
            style={[styles.colorPickerButton, { backgroundColor: colors.background }]}
            onPress={() => setShowColorPicker(true)}
          >
            <View style={styles.colorPreview}>
              <View style={[styles.colorDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.colorDot, { backgroundColor: colors.secondary }]} />
              <View style={[styles.colorDot, { backgroundColor: colors.accent }]} />
            </View>
            <Text style={[styles.colorName, { color: colors.text }]}>
              {COLOR_PALETTES[settings.appearance.color_palette]?.name || 'Sonnenuntergang'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
          </TouchableOpacity>

          <Text style={[styles.subLabel, { color: colors.textLight, marginTop: 15 }]}>
            Benachrichtigungston:
          </Text>
          <TouchableOpacity
            style={[styles.soundButton, { backgroundColor: colors.background }]}
            onPress={() => setShowSoundPicker(true)}
          >
            <Ionicons name="musical-notes" size={20} color={colors.primary} />
            <Text style={[styles.soundText, { color: colors.text }]}>
              {NOTIFICATION_SOUNDS.find(s => s.id === settings.appearance.notification_sound)?.name || 'Standard'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
          </TouchableOpacity>

          {/* Language Selection */}
          <View 
            onLayout={(event) => {
              languageSectionY.current = event.nativeEvent.layout.y;
            }}
          >
            <Text style={[styles.subLabel, { color: colors.textLight, marginTop: 15 }]}>
              {t('settings.language')}:
            </Text>
            <View style={styles.languageGrid}>
            {(Object.keys(languages) as LanguageCode[]).map((langCode) => {
              const lang = languages[langCode];
              const isSelected = getCurrentLanguage() === langCode;
              const isAvailable = langCode === 'de' || langCode === 'en';
              
              return (
                <TouchableOpacity
                  key={langCode}
                  style={[
                    styles.languageOption,
                    { 
                      backgroundColor: isSelected ? colors.primary : colors.background,
                      borderColor: isSelected ? colors.primary : colors.card,
                      opacity: isAvailable ? 1 : 0.5,
                    }
                  ]}
                  onPress={() => {
                    if (isAvailable) {
                      setLanguage(langCode);
                      // Force re-render
                      setSettings({...settings});
                    } else {
                      Alert.alert(
                        t('settings.coming_soon'),
                        t('settings.language_coming_soon', { language: lang.nativeName })
                      );
                    }
                  }}
                  disabled={!isAvailable}
                >
                  <Text style={styles.languageFlag}>{lang.flag}</Text>
                  <Text style={[
                    styles.languageName, 
                    { color: isSelected ? '#FFF' : colors.text }
                  ]}>
                    {lang.nativeName}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                  )}
                  {!isAvailable && (
                    <Text style={[styles.comingSoon, { color: colors.textLight }]}>Soon</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={saveSettings}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="save" size={20} color="#FFF" />
              <Text style={styles.saveButtonText}>Einstellungen speichern</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Custom Time Picker Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showTimePicker.visible}
        onRequestClose={() => setShowTimePicker({ ...showTimePicker, visible: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.timeModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.timeModalHeader}>
              <TouchableOpacity onPress={() => setShowTimePicker({ ...showTimePicker, visible: false })}>
                <Text style={[styles.modalCancelText, { color: colors.textLight }]}>Abbrechen</Text>
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Zeit waehlen</Text>
              <TouchableOpacity onPress={confirmTime}>
                <Text style={[styles.modalConfirmText, { color: colors.primary }]}>Fertig</Text>
              </TouchableOpacity>
            </View>

            {/* Large Time Display */}
            <View style={[styles.timeDisplay, { backgroundColor: colors.background }]}>
              <Text style={[styles.timeDisplayText, { color: colors.primary }]}>
                {tempTime.hour}:{tempTime.minute}
              </Text>
              <Text style={[styles.timeDisplayLabel, { color: colors.textLight }]}>Uhr</Text>
            </View>

            {/* Time Picker Wheels */}
            <TimePickerWheel
              selectedHour={tempTime.hour}
              selectedMinute={tempTime.minute}
              onHourChange={(hour) => setTempTime({ ...tempTime, hour })}
              onMinuteChange={(minute) => setTempTime({ ...tempTime, minute })}
              colors={colors}
            />

            {/* Presets */}
            <TimePresets onSelect={selectPresetTime} colors={colors} />
          </View>
        </View>
      </Modal>

      {/* Color Picker Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showColorPicker}
        onRequestClose={() => setShowColorPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.colorModalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Farbpalette waehlen</Text>
            <ScrollView style={styles.colorList}>
              {Object.entries(COLOR_PALETTES).map(([key, palette]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.colorOption,
                    { backgroundColor: palette.background },
                    settings.appearance.color_palette === key && {
                      borderColor: palette.primary,
                      borderWidth: 3,
                    },
                  ]}
                  onPress={() => {
                    setSettings({
                      ...settings,
                      appearance: { ...settings.appearance, color_palette: key },
                    });
                  }}
                >
                  <View style={styles.colorOptionDots}>
                    <View style={[styles.colorOptionDot, { backgroundColor: palette.primary }]} />
                    <View style={[styles.colorOptionDot, { backgroundColor: palette.secondary }]} />
                    <View style={[styles.colorOptionDot, { backgroundColor: palette.accent }]} />
                  </View>
                  <Text style={[styles.colorOptionName, { color: palette.text }]}>
                    {palette.name}
                  </Text>
                  {settings.appearance.color_palette === key && (
                    <Ionicons name="checkmark-circle" size={24} color={palette.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowColorPicker(false)}
            >
              <Text style={styles.modalButtonText}>Fertig</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Location Picker Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showLocationModal}
        onRequestClose={() => setShowLocationModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.locationModalContainer}
        >
          <View style={[styles.locationModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.locationModalHeader}>
              <TouchableOpacity onPress={() => setShowLocationModal(false)}>
                <Ionicons name="close" size={28} color={colors.textLight} />
              </TouchableOpacity>
              <Text style={[styles.locationModalTitle, { color: colors.text }]}>
                Ort waehlen
              </Text>
              <TouchableOpacity 
                onPress={confirmLocationSelection}
                disabled={!selectedLocation}
              >
                <Text style={[
                  styles.locationModalConfirm, 
                  { color: selectedLocation ? colors.primary : colors.textLight }
                ]}>
                  Fertig
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.locationModalHint, { color: colors.textLight }]}>
              Waehle deinen aktuellen Standort oder suche nach einer Adresse.
              Du wirst erinnert, wenn du dort ankommst.
            </Text>

            {/* Current Location Button */}
            <TouchableOpacity
              style={[styles.currentLocationButton, { backgroundColor: colors.secondary }]}
              onPress={() => setCurrentLocation(locationGoalIndex)}
              disabled={loadingLocation}
            >
              {loadingLocation ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="navigate" size={20} color="#FFF" />
                  <Text style={styles.currentLocationText}>Meinen aktuellen Standort verwenden</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.locationDivider}>
              <View style={[styles.dividerLine, { backgroundColor: colors.textLight }]} />
              <Text style={[styles.dividerText, { color: colors.textLight }]}>oder</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.textLight }]} />
            </View>

            {/* Search Bar */}
            <View style={[styles.searchContainer, { backgroundColor: colors.background }]}>
              <Ionicons name="search" size={20} color={colors.textLight} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Adresse suchen (z.B. Bahnhofstr. 1, Zuerich)"
                placeholderTextColor={colors.textLight}
                value={locationSearchQuery}
                onChangeText={setLocationSearchQuery}
                onSubmitEditing={handleLocationSearch}
                returnKeyType="search"
              />
              <TouchableOpacity onPress={handleLocationSearch}>
                <Ionicons name="arrow-forward-circle" size={28} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {/* Search Results */}
            {locationSearchResults.length > 0 && (
              <ScrollView style={[styles.searchResults, { backgroundColor: colors.background }]}>
                {locationSearchResults.map((result, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.searchResultItem, { borderBottomColor: colors.card }]}
                    onPress={() => selectSearchResult(result)}
                  >
                    <Ionicons name="location" size={18} color={colors.secondary} />
                    <Text style={[styles.searchResultText, { color: colors.text }]} numberOfLines={2}>
                      {result.name}
                    </Text>
                    <Ionicons name="add-circle" size={22} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Selected Location Info */}
            {selectedLocation && (
              <View style={[styles.selectedLocationBox, { backgroundColor: colors.secondary + '20', borderColor: colors.secondary }]}>
                <Ionicons name="checkmark-circle" size={24} color={colors.secondary} />
                <View style={styles.selectedLocationInfo}>
                  <Text style={[styles.selectedLocationLabel, { color: colors.textLight }]}>Ausgewaehlter Ort:</Text>
                  <Text style={[styles.selectedLocationText, { color: colors.text }]} numberOfLines={2}>
                    {selectedLocation.address}
                  </Text>
                </View>
              </View>
            )}

            {/* Info Text */}
            <View style={[styles.locationInfoBox, { backgroundColor: colors.background }]}>
              <Ionicons name="information-circle" size={20} color={colors.textLight} />
              <Text style={[styles.locationInfoText, { color: colors.textLight }]}>
                {Platform.OS === 'web' 
                  ? 'Hinweis: Orts-Erinnerungen funktionieren nur in der mobilen App.'
                  : 'Du wirst eine Erinnerung erhalten, wenn du in der Naehe dieses Ortes bist.'
                }
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sound Picker Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showSoundPicker}
        onRequestClose={() => setShowSoundPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.soundModalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.soundModalTitle, { color: colors.text }]}>
              Benachrichtigungston waehlen
            </Text>
            
            {NOTIFICATION_SOUNDS.map((sound) => (
              <TouchableOpacity
                key={sound.id}
                style={[
                  styles.soundOption,
                  { backgroundColor: colors.background },
                  settings.appearance.notification_sound === sound.id && {
                    borderColor: colors.primary,
                    borderWidth: 2,
                  }
                ]}
                onPress={() => selectNotificationSound(sound.id)}
              >
                <Ionicons 
                  name={sound.icon as any} 
                  size={24} 
                  color={settings.appearance.notification_sound === sound.id ? colors.primary : colors.textLight} 
                />
                <Text style={[
                  styles.soundOptionText,
                  { color: settings.appearance.notification_sound === sound.id ? colors.primary : colors.text }
                ]}>
                  {sound.name}
                </Text>
                {settings.appearance.notification_sound === sound.id && (
                  <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
            
            <TouchableOpacity
              style={[styles.soundModalClose, { backgroundColor: colors.primary }]}
              onPress={closeSoundPicker}
            >
              <Text style={styles.soundModalCloseText}>Fertig</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
    flex: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  settingLabel: {
    fontSize: 15,
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 15,
  },
  timeButtonContent: {
    flex: 1,
    marginLeft: 12,
  },
  timeLabel: {
    fontSize: 12,
  },
  timeText: {
    fontSize: 20,
    fontWeight: '700',
  },
  individualTimes: {
    marginBottom: 15,
  },
  individualTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  individualTimeContent: {
    flex: 1,
    marginLeft: 10,
  },
  individualTimeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  goalBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalBadgeText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  goalText: {
    fontSize: 14,
  },
  subLabel: {
    fontSize: 13,
    marginBottom: 10,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayText: {
    fontSize: 12,
    fontWeight: '600',
  },
  geoSection: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  geoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  geoHint: {
    fontSize: 12,
    marginBottom: 15,
    fontStyle: 'italic',
  },
  geoItem: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  geoItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  geoGoalText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
  },
  setLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  setLocationText: {
    marginLeft: 8,
    fontSize: 13,
  },
  colorPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
  },
  colorPreview: {
    flexDirection: 'row',
    marginRight: 12,
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 4,
  },
  colorName: {
    flex: 1,
    fontSize: 15,
  },
  soundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
  },
  soundText: {
    flex: 1,
    fontSize: 15,
    marginLeft: 10,
  },
  saveButton: {
    marginHorizontal: 20,
    padding: 18,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 30,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  timeModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  timeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalCancelText: {
    fontSize: 16,
  },
  modalConfirmText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  timeDisplay: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
  },
  timeDisplayText: {
    fontSize: 56,
    fontWeight: 'bold',
  },
  timeDisplayLabel: {
    fontSize: 14,
    marginTop: 4,
  },
  wheelContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  wheelColumn: {
    alignItems: 'center',
  },
  wheelLabel: {
    fontSize: 12,
    marginBottom: 8,
  },
  wheelWrapper: {
    height: 150,
    width: 80,
    borderRadius: 12,
    borderWidth: 2,
    overflow: 'hidden',
  },
  wheelList: {
    height: 150,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelItemText: {
    fontSize: 24,
  },
  wheelItemTextSelected: {
    fontWeight: 'bold',
    fontSize: 28,
  },
  wheelSeparator: {
    fontSize: 40,
    fontWeight: 'bold',
    marginHorizontal: 15,
  },
  presetsContainer: {
    marginTop: 10,
  },
  presetsTitle: {
    fontSize: 13,
    marginBottom: 10,
  },
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
  },
  presetText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
  },
  colorModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalButton: {
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 10,
    alignSelf: 'center',
  },
  modalButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  colorList: {
    maxHeight: 400,
  },
  colorOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  colorOptionDots: {
    flexDirection: 'row',
    marginRight: 15,
  },
  colorOptionDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  colorOptionName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  // Profile Name Styles
  profileNameContainer: {
    paddingTop: 5,
  },
  profileNameLabel: {
    fontSize: 14,
    marginBottom: 10,
  },
  profileNameInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileNameInput: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    fontWeight: '600',
  },
  profileNameIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileNameEmoji: {
    fontSize: 24,
  },
  profileNameHint: {
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  // Location styles
  locationSetContainer: {
    marginTop: 10,
  },
  locationSetInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  locationSetText: {
    flex: 1,
    fontSize: 13,
  },
  locationButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  locationEditButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  locationRemoveButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  // Location Modal
  locationModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  locationModalContent: {
    flex: 1,
    marginTop: 60,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  locationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  locationModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  locationModalConfirm: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  searchResults: {
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 10,
    maxHeight: 150,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
  },
  searchResultText: {
    flex: 1,
    fontSize: 14,
  },
  mapContainer: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
  },
  map: {
    width: '100%',
    height: '100%',
    minHeight: 250,
  },
  currentLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginBottom: 10,
  },
  currentLocationText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  selectedLocationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 12,
    gap: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  selectedLocationInfo: {
    flex: 1,
  },
  selectedLocationLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  selectedLocationText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  locationModalHint: {
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    lineHeight: 20,
  },
  locationDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 15,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    opacity: 0.3,
  },
  dividerText: {
    marginHorizontal: 15,
    fontSize: 14,
  },
  locationInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  locationInfoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  // Sound Modal
  soundModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  soundModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  soundOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    gap: 12,
  },
  soundOptionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  soundModalClose: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  soundModalCloseText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Premium & Admin Buttons
  premiumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  premiumIconBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  premiumButtonContent: {
    flex: 1,
    marginLeft: 14,
  },
  premiumButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  premiumButtonSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  settingDivider: {
    height: 1,
    marginHorizontal: 16,
  },
  adminButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 16,
  },
  adminIconBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adminButtonText: {
    flex: 1,
    fontSize: 14,
    marginLeft: 12,
  },
  // Language Selection Styles
  languageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    gap: 8,
  },
  languageFlag: {
    fontSize: 20,
  },
  languageName: {
    fontSize: 14,
    fontWeight: '600',
  },
  comingSoon: {
    fontSize: 10,
    fontStyle: 'italic',
  },
});
