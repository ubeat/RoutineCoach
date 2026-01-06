import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';

const LANGUAGE_KEY = 'user_language';

export const languages = {
  de: { name: 'Deutsch', flag: '🇩🇪', nativeName: 'Deutsch' },
  en: { name: 'English', flag: '🇬🇧', nativeName: 'English' },
  es: { name: 'Español', flag: '🇪🇸', nativeName: 'Español' },
  fr: { name: 'Français', flag: '🇫🇷', nativeName: 'Français' },
};

export type LanguageCode = keyof typeof languages;

const resources = {
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
};

// Get initial language
const getInitialLanguage = (): string => {
  try {
    const locale = Localization.locale;
    if (locale) {
      const deviceLang = locale.split('-')[0];
      if (deviceLang in languages) {
        return deviceLang;
      }
    }
  } catch (error) {
    console.log('Could not get device language, defaulting to German');
  }
  return 'de'; // Default to German
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

// Load saved language preference
export const loadSavedLanguage = async () => {
  try {
    const savedLang = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (savedLang && savedLang in languages) {
      i18n.changeLanguage(savedLang);
    }
  } catch (error) {
    console.error('Error loading saved language:', error);
  }
};

// Save language preference
export const setLanguage = async (lang: LanguageCode) => {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    i18n.changeLanguage(lang);
  } catch (error) {
    console.error('Error saving language:', error);
  }
};

export const getCurrentLanguage = (): LanguageCode => {
  return i18n.language as LanguageCode;
};

export default i18n;
