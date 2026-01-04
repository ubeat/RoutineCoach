import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Color Palettes
export const COLOR_PALETTES: Record<string, ColorPalette> = {
  sonnenuntergang: {
    name: "Sonnenuntergang",
    primary: "#FF6B6B",
    secondary: "#4ECDC4",
    accent: "#FFE66D",
    background: "#FFF9F0",
    card: "#FFFFFF",
    text: "#2D3436",
    textLight: "#636E72"
  },
  ozean: {
    name: "Ozean",
    primary: "#0077B6",
    secondary: "#00B4D8",
    accent: "#90E0EF",
    background: "#CAF0F8",
    card: "#FFFFFF",
    text: "#03045E",
    textLight: "#023E8A"
  },
  wald: {
    name: "Wald",
    primary: "#2D6A4F",
    secondary: "#40916C",
    accent: "#95D5B2",
    background: "#D8F3DC",
    card: "#FFFFFF",
    text: "#1B4332",
    textLight: "#2D6A4F"
  },
  nacht: {
    name: "Nacht",
    primary: "#7B2CBF",
    secondary: "#9D4EDD",
    accent: "#C77DFF",
    background: "#10002B",
    card: "#240046",
    text: "#E0AAFF",
    textLight: "#C77DFF"
  },
  lavendel: {
    name: "Lavendel",
    primary: "#7251B5",
    secondary: "#9B7ED9",
    accent: "#D4C1EC",
    background: "#F5F0FF",
    card: "#FFFFFF",
    text: "#4A3072",
    textLight: "#7251B5"
  },
  koralle: {
    name: "Koralle",
    primary: "#FF7F50",
    secondary: "#FF6B6B",
    accent: "#FFB4A2",
    background: "#FFF5F3",
    card: "#FFFFFF",
    text: "#8B4513",
    textLight: "#A0522D"
  },
  minze: {
    name: "Minze",
    primary: "#00A896",
    secondary: "#02C39A",
    accent: "#80ED99",
    background: "#E8FFF5",
    card: "#FFFFFF",
    text: "#004E45",
    textLight: "#00A896"
  },
  monochrom_grau: {
    name: "Elegantes Grau",
    primary: "#4A4A4A",
    secondary: "#6B6B6B",
    accent: "#9E9E9E",
    background: "#F5F5F5",
    card: "#FFFFFF",
    text: "#2C2C2C",
    textLight: "#6B6B6B"
  },
  monochrom_blau: {
    name: "Tiefes Blau",
    primary: "#1A365D",
    secondary: "#2C5282",
    accent: "#4299E1",
    background: "#EBF8FF",
    card: "#FFFFFF",
    text: "#1A202C",
    textLight: "#2C5282"
  },
  regenbogen: {
    name: "Regenbogen",
    primary: "#FF6B6B",
    secondary: "#4ECDC4",
    accent: "#FFE66D",
    background: "#FFF0F5",
    card: "#FFFFFF",
    text: "#2D3436",
    textLight: "#636E72"
  },
  fruehling: {
    name: "Fruehling",
    primary: "#F472B6",
    secondary: "#A78BFA",
    accent: "#FBBF24",
    background: "#FDF2F8",
    card: "#FFFFFF",
    text: "#831843",
    textLight: "#9D174D"
  }
};

export interface ColorPalette {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  card: string;
  text: string;
  textLight: string;
}

export interface LocationSettings {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  radius: number;
}

export interface HabitReminderSettings {
  enabled: boolean;
  use_same_time: boolean;
  time: string;
  individual_times: string[];
  days: number[];
  locations: LocationSettings[];
}

export interface CheckinReminderSettings {
  enabled: boolean;
  time: string;
  days: number[];
}

export interface AppearanceSettings {
  color_palette: string;
  notification_sound: string;
}

export interface UserSettings {
  device_id: string;
  habit_reminders: HabitReminderSettings;
  checkin_reminder: CheckinReminderSettings;
  appearance: AppearanceSettings;
}

interface SettingsContextType {
  settings: UserSettings | null;
  colors: ColorPalette;
  loading: boolean;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const defaultSettings: UserSettings = {
  device_id: '',
  habit_reminders: {
    enabled: true,
    use_same_time: true,
    time: "08:00",
    individual_times: ["08:00", "12:00", "18:00"],
    days: [0, 1, 2, 3, 4, 5, 6],
    locations: [
      { enabled: false, latitude: null, longitude: null, address: null, radius: 100 },
      { enabled: false, latitude: null, longitude: null, address: null, radius: 100 },
      { enabled: false, latitude: null, longitude: null, address: null, radius: 100 }
    ]
  },
  checkin_reminder: {
    enabled: true,
    time: "20:00",
    days: [0, 1, 2, 3, 4, 5, 6]
  },
  appearance: {
    color_palette: "sonnenuntergang",
    notification_sound: "default"
  }
};

const SettingsContext = createContext<SettingsContextType>({
  settings: null,
  colors: COLOR_PALETTES.sonnenuntergang,
  loading: true,
  updateSettings: async () => {},
  refreshSettings: async () => {}
});

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const getDeviceId = async (): Promise<string> => {
    let id = await AsyncStorage.getItem('deviceId');
    if (!id) {
      id = 'device_' + Math.random().toString(36).substring(7);
      await AsyncStorage.setItem('deviceId', id);
    }
    return id;
  };

  const refreshSettings = async () => {
    try {
      const deviceId = await getDeviceId();
      const response = await axios.get(`${API_URL}/api/settings/${deviceId}`);
      const fetchedSettings = {
        ...defaultSettings,
        ...response.data,
        device_id: deviceId
      };
      setSettings(fetchedSettings);
    } catch (error) {
      console.error('Error fetching settings:', error);
      const deviceId = await getDeviceId();
      setSettings({ ...defaultSettings, device_id: deviceId });
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = async (updates: Partial<UserSettings>) => {
    if (!settings) return;
    
    try {
      const deviceId = await getDeviceId();
      await axios.post(`${API_URL}/api/settings/${deviceId}`, updates);
      setSettings({ ...settings, ...updates });
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  };

  useEffect(() => {
    refreshSettings();
  }, []);

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  return (
    <SettingsContext.Provider value={{ settings, colors, loading, updateSettings, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
