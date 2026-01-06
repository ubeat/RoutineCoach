import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const COLORS = {
  primary: '#FF6B6B',
  secondary: '#4ECDC4',
  accent: '#FFE66D',
  purple: '#A78BFA',
  pink: '#F472B6',
  background: '#FFF9F0',
  card: '#FFFFFF',
  text: '#2D3436',
  textLight: '#636E72',
};

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [goals, setGoals] = useState<string[] | null>(null);
  const [todayCheckin, setTodayCheckin] = useState<any>(null);
  const [weekSummary, setWeekSummary] = useState<any>(null);
  
  // Name modal state
  const [userName, setUserName] = useState<string | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const today = new Date();
  const isSunday = today.getDay() === 0;
  
  // Get localized weekday
  const getLocalizedWeekday = () => {
    const weekdays = [
      t('days.sunday'), t('days.monday'), t('days.tuesday'), 
      t('days.wednesday'), t('days.thursday'), t('days.friday'), t('days.saturday')
    ];
    return weekdays[today.getDay()];
  };

  const getDeviceId = async () => {
    let id = await AsyncStorage.getItem('deviceId');
    if (!id) {
      id = 'device_' + Math.random().toString(36).substring(7);
      await AsyncStorage.setItem('deviceId', id);
    }
    return id;
  };

  const loadUserName = async () => {
    const storedName = await AsyncStorage.getItem('userName');
    if (storedName) {
      setUserName(storedName);
    } else {
      setShowWelcomeModal(true);
    }
  };

  const saveUserName = async () => {
    const trimmedName = nameInput.trim();
    if (trimmedName.length < 1) {
      return;
    }
    await AsyncStorage.setItem('userName', trimmedName);
    setUserName(trimmedName);
    setShowWelcomeModal(false);
  };

  const fetchData = async () => {
    try {
      const id = await getDeviceId();
      setDeviceId(id);

      const goalsRes = await axios.get(`${API_URL}/api/goals/${id}`);
      if (goalsRes.data.goals) {
        setGoals(goalsRes.data.goals);
      }

      const todayRes = await axios.get(`${API_URL}/api/today/${id}`);
      setTodayCheckin(todayRes.data);

      const summaryRes = await axios.get(`${API_URL}/api/summary/${id}`);
      setWeekSummary(summaryRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadUserName();
    fetchData();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  const completedToday = todayCheckin?.completed_today;
  const daysTracked = weekSummary?.total_days_tracked || 0;
  
  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('home.greeting_morning');
    if (hour < 18) return t('home.greeting_afternoon');
    return t('home.greeting_evening');
  };

  // Get current language flag
  const getCurrentFlag = () => {
    const lang = t('_lang', { defaultValue: 'de' });
    const flags: Record<string, string> = { de: '🇩🇪', en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷' };
    return flags[lang] || '🇩🇪';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.appName}>Schritt für Schritt</Text>
            <TouchableOpacity 
              style={styles.languageButton}
              onPress={() => router.push('/settings')}
            >
              <Text style={styles.languageFlag}>{getCurrentFlag()}</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>
          <Text style={styles.greeting}>{getGreeting()}, {userName || t('common.you')}! 💜</Text>
          <Text style={styles.dayText}>{getLocalizedWeekday()} - {t('home.motivational_quote')}</Text>
        </View>

        {isSunday && (
          <TouchableOpacity style={styles.sundayBanner} onPress={() => router.push('/goals')}>
            <View style={styles.sundayContent}>
              <Ionicons name="sparkles" size={28} color="#FFF" />
              <View style={styles.sundayTextContainer}>
                <Text style={styles.sundayTitle}>{t('goals.subtitle_sunday')} 🌟</Text>
                <Text style={styles.sundaySubtitle}>{t('goals.theory_title')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="flag" size={24} color={COLORS.primary} />
            <Text style={styles.cardTitle}>{t('goals.title')}</Text>
          </View>
          {goals ? (
            <View style={styles.goalsContainer}>
              {goals.map((goal, index) => (
                <View key={index} style={styles.goalItem}>
                  <View style={[styles.goalNumber, { backgroundColor: [COLORS.primary, COLORS.secondary, COLORS.purple][index] }]}>
                    <Text style={styles.goalNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.goalText}>{goal}</Text>
                </View>
              ))}
              <TouchableOpacity style={styles.editGoalsLink} onPress={() => router.push('/goals')}>
                <Ionicons name="pencil" size={14} color={COLORS.primary} />
                <Text style={styles.editGoalsText}>{t('common.edit')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.noGoalsButton} onPress={() => router.push('/goals')}>
              <Ionicons name="heart-circle" size={50} color={COLORS.primary} />
              <Text style={styles.noGoalsText}>{t('home.no_habits')}</Text>
              <Text style={styles.noGoalsHint}>{t('home.set_habits')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="today" size={24} color={COLORS.secondary} />
            <Text style={styles.cardTitle}>{t('journal.today')}</Text>
          </View>
          {completedToday ? (
            <View style={styles.completedContainer}>
              <Ionicons name="checkmark-circle" size={60} color={COLORS.secondary} />
              <Text style={styles.completedText}>{t('checkin.success_title')}</Text>
              {todayCheckin?.checkin?.mood_emoji && (
                <Text style={styles.moodDisplay}>
                  {t('checkin.mood_question')}: {todayCheckin.checkin.mood_emoji} ({todayCheckin.checkin.mood_scale}/10)
                </Text>
              )}
            </View>
          ) : goals ? (
            <TouchableOpacity style={styles.checkinButton} onPress={() => router.push('/checkin')}>
              <Ionicons name="hand-right" size={32} color="#FFF" />
              <Text style={styles.checkinButtonText}>{t('checkin.submit')}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.setGoalsFirst}>{t('checkin.no_goals')}</Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="calendar" size={24} color={COLORS.purple} />
            <Text style={styles.cardTitle}>{t('progress.this_week')}</Text>
          </View>
          <View style={styles.weekProgress}>
            <Text style={styles.progressNumber}>{daysTracked}/7</Text>
            <Text style={styles.progressLabel}>{t('progress.days')}</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${(daysTracked / 7) * 100}%` }]} />
          </View>
          {daysTracked >= 7 && (
            <TouchableOpacity style={styles.viewResultsButton} onPress={() => router.push('/progress')}>
              <Text style={styles.viewResultsText}>{t('progress.weekly_overview')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {todayCheckin?.checkin?.ai_response && (
          <View style={[styles.card, styles.coachCard]}>
            <View style={styles.cardHeader}>
              <Ionicons name="chatbubble-ellipses" size={24} color={COLORS.pink} />
              <Text style={styles.cardTitle}>{t('coaching.title')}</Text>
            </View>
            <Text style={styles.coachMessage}>{todayCheckin.checkin.ai_response}</Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Welcome Modal for first-time users */}
      <Modal
        transparent
        animationType="fade"
        visible={showWelcomeModal}
        onRequestClose={() => {}}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.welcomeModalContent}>
            <Text style={styles.welcomeEmoji}>💜</Text>
            <Text style={styles.welcomeTitle}>Willkommen bei</Text>
            <Text style={styles.welcomeAppName}>Schritt für Schritt</Text>
            <Text style={styles.welcomeSubtitle}>Dein Gewohnheits-Tracker mit Herz</Text>
            
            <View style={styles.welcomeDivider} />
            
            <Text style={styles.welcomeQuestion}>Wie darf ich dich nennen?</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="Dein Name"
              placeholderTextColor={COLORS.textLight}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              maxLength={20}
            />
            
            <TouchableOpacity
              style={[
                styles.welcomeButton,
                nameInput.trim().length < 1 && styles.welcomeButtonDisabled
              ]}
              onPress={saveUserName}
              disabled={nameInput.trim().length < 1}
            >
              <Text style={styles.welcomeButtonText}>Los geht's! 🚀</Text>
            </TouchableOpacity>
            
            <Text style={styles.welcomeNote}>
              Du kannst deinen Namen jederzeit in den Einstellungen aendern.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 10,
    color: COLORS.textLight,
    fontSize: 16,
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  appName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
    letterSpacing: 1,
    marginBottom: 4,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  dayText: {
    fontSize: 18,
    color: COLORS.textLight,
    marginTop: 4,
  },
  sundayBanner: {
    marginHorizontal: 20,
    marginBottom: 15,
    backgroundColor: COLORS.purple,
    borderRadius: 16,
    padding: 16,
  },
  sundayContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sundayTextContainer: {
    marginLeft: 12,
  },
  sundayTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
  },
  sundaySubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  card: {
    backgroundColor: COLORS.card,
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
  coachCard: {
    backgroundColor: '#FFF0F5',
    borderWidth: 1,
    borderColor: COLORS.pink,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginLeft: 10,
  },
  goalsContainer: {
    gap: 12,
  },
  goalItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  goalNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  goalNumberText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  goalText: {
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },
  noGoalsButton: {
    alignItems: 'center',
    padding: 20,
  },
  noGoalsText: {
    marginTop: 10,
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '700',
  },
  noGoalsHint: {
    marginTop: 6,
    fontSize: 14,
    color: COLORS.textLight,
  },
  editGoalsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    gap: 6,
  },
  editGoalsText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  completedContainer: {
    alignItems: 'center',
    padding: 10,
  },
  completedText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.secondary,
    marginTop: 10,
  },
  moodDisplay: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
  },
  checkinButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 10,
  },
  checkinButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  setGoalsFirst: {
    textAlign: 'center',
    color: COLORS.textLight,
    fontSize: 15,
  },
  weekProgress: {
    alignItems: 'center',
    marginBottom: 15,
  },
  progressNumber: {
    fontSize: 36,
    fontWeight: 'bold',
    color: COLORS.purple,
  },
  progressLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E8E8E8',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.purple,
    borderRadius: 4,
  },
  viewResultsButton: {
    marginTop: 15,
    alignItems: 'center',
  },
  viewResultsText: {
    color: COLORS.purple,
    fontWeight: '600',
    fontSize: 15,
  },
  coachMessage: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },
  bottomSpacer: {
    height: 20,
  },
  // Welcome Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  welcomeModalContent: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 30,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  welcomeEmoji: {
    fontSize: 50,
    marginBottom: 10,
  },
  welcomeTitle: {
    fontSize: 16,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  welcomeAppName: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 4,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  welcomeDivider: {
    width: 60,
    height: 3,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
    marginVertical: 24,
  },
  welcomeQuestion: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  nameInput: {
    width: '100%',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 18,
    textAlign: 'center',
    color: COLORS.text,
    marginBottom: 16,
  },
  welcomeButton: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  welcomeButtonDisabled: {
    opacity: 0.5,
  },
  welcomeButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  welcomeNote: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 16,
    textAlign: 'center',
  },
});
