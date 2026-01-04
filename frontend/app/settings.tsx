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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
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
} from '../services/NotificationService';
import { COLOR_PALETTES } from '../contexts/SettingsContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
      { enabled: false, latitude: null, longitude: null, address: null, radius: 100 },
      { enabled: false, latitude: null, longitude: null, address: null, radius: 100 },
      { enabled: false, latitude: null, longitude: null, address: null, radius: 100 },
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
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [settingLocation, setSettingLocation] = useState<number | null>(null);

  const colors = COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang;

  useEffect(() => {
    loadSettings();
    loadUserName();
  }, []);

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
    setSettingLocation(goalIndex);
    try {
      const hasPermission = await requestLocationPermissions();
      if (!hasPermission) {
        Alert.alert(
          'Standort-Berechtigung',
          'Bitte erlaube den Standortzugriff in den Einstellungen.'
        );
        return;
      }

      const location = await getCurrentLocation();
      if (location) {
        const address = await getAddressFromCoordinates(
          location.coords.latitude,
          location.coords.longitude
        );

        const newLocations = [...settings.habit_reminders.locations];
        newLocations[goalIndex] = {
          enabled: true,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          address,
          radius: 100,
        };
        setSettings({
          ...settings,
          habit_reminders: { ...settings.habit_reminders, locations: newLocations },
        });
      }
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Fehler', 'Standort konnte nicht ermittelt werden.');
    } finally {
      setSettingLocation(null);
    }
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
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Einstellungen</Text>
        </View>

        {/* Habit Reminders Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="notifications" size={24} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Habit-Erinnerungen</Text>
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
                    <Text style={[styles.timeLabel, { color: colors.textLight }]}>Erinnerungszeit</Text>
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
                  Hinweis: Standort-Tracking verbraucht etwas mehr Akku.
                </Text>

                {goals.map((goal, index) => (
                  <View key={index} style={[styles.geoItem, { backgroundColor: colors.background }]}>
                    <View style={styles.geoItemHeader}>
                      <View style={[styles.goalBadge, { backgroundColor: [colors.primary, colors.secondary, colors.accent][index % 3] }]}>
                        <Text style={styles.goalBadgeText}>{index + 1}</Text>
                      </View>
                      <Text style={[styles.geoGoalText, { color: colors.text }]} numberOfLines={1}>
                        {goal || `Ziel ${index + 1}`}
                      </Text>
                      <Switch
                        value={settings.habit_reminders.locations[index]?.enabled || false}
                        onValueChange={(value) => {
                          const newLocations = [...settings.habit_reminders.locations];
                          newLocations[index] = {
                            ...newLocations[index],
                            enabled: value,
                          };
                          setSettings({
                            ...settings,
                            habit_reminders: { ...settings.habit_reminders, locations: newLocations },
                          });
                        }}
                        trackColor={{ false: '#E0E0E0', true: colors.secondary }}
                      />
                    </View>

                    {settings.habit_reminders.locations[index]?.enabled && (
                      <TouchableOpacity
                        style={[styles.setLocationButton, { borderColor: colors.secondary }]}
                        onPress={() => setCurrentLocation(index)}
                        disabled={settingLocation === index}
                      >
                        {settingLocation === index ? (
                          <ActivityIndicator size="small" color={colors.secondary} />
                        ) : (
                          <>
                            <Ionicons name="navigate" size={16} color={colors.secondary} />
                            <Text style={[styles.setLocationText, { color: colors.secondary }]}>
                              {settings.habit_reminders.locations[index]?.address ||
                                'Aktuellen Standort setzen'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        {/* Check-In Reminder Section */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={24} color={colors.secondary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Check-In Erinnerung</Text>
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
            onPress={() => Alert.alert('Info', 'Ton-Auswahl oeffnet die Systemeinstellungen.')}
          >
            <Ionicons name="musical-notes" size={20} color={colors.primary} />
            <Text style={[styles.soundText, { color: colors.text }]}>
              {settings.appearance.notification_sound === 'default' ? 'Standard' : 'Benutzerdefiniert'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
          </TouchableOpacity>
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
});
