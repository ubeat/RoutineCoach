import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
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
  success: '#00B894',
  warning: '#FDCB6E',
};

export default function CheckinScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);
  const [weekId, setWeekId] = useState('');
  const [habitsCompleted, setHabitsCompleted] = useState<boolean[]>([false, false, false]);
  const [selectedMoodEmoji, setSelectedMoodEmoji] = useState<string>('');
  const [moodScale, setMoodScale] = useState(5);
  const [aiResponse, setAiResponse] = useState('');
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false);

  // Mood emojis with translations
  const getMoodEmojis = () => [
    { emoji: String.fromCodePoint(0x1F62D), label: t('moods.very_sad', 'Sehr traurig') },
    { emoji: String.fromCodePoint(0x1F614), label: t('moods.sad', 'Traurig') },
    { emoji: String.fromCodePoint(0x1F641), label: t('moods.not_good', 'Nicht gut') },
    { emoji: String.fromCodePoint(0x1F615), label: t('moods.confused', 'Verwirrt') },
    { emoji: String.fromCodePoint(0x1F610), label: t('moods.neutral', 'Neutral') },
    { emoji: String.fromCodePoint(0x1F642), label: t('moods.okay', 'Okay') },
    { emoji: String.fromCodePoint(0x1F60A), label: t('moods.good', 'Gut') },
    { emoji: String.fromCodePoint(0x1F604), label: t('moods.very_good', 'Sehr gut') },
    { emoji: String.fromCodePoint(0x1F929), label: t('moods.fantastic', 'Fantastisch') },
    { emoji: String.fromCodePoint(0x1F970), label: t('moods.in_love', 'Verliebt') },
  ];

  useEffect(() => {
    fetchGoals();
  }, []);

  const fetchGoals = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) {
        Alert.alert('Fehler', 'Bitte starte die App neu');
        return;
      }

      const todayRes = await axios.get(`${API_URL}/api/today/${deviceId}`);
      if (todayRes.data.completed_today) {
        setAlreadyCheckedIn(true);
        setAiResponse(todayRes.data.checkin?.ai_response || '');
      }

      const goalsRes = await axios.get(`${API_URL}/api/goals/${deviceId}`);
      if (goalsRes.data.goals) {
        setGoals(goalsRes.data.goals);
        setWeekId(goalsRes.data.id);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleHabit = (index: number) => {
    const newHabits = [...habitsCompleted];
    newHabits[index] = !newHabits[index];
    setHabitsCompleted(newHabits);
  };

  const submitCheckin = async () => {
    if (!selectedMoodEmoji) {
      Alert.alert(t('common.error'), t('checkin.select_mood', 'Bitte wähle deine Stimmung aus'));
      return;
    }

    setSubmitting(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const habitsStr = habitsCompleted.map(h => h ? 'y' : 'n').join('');

      const response = await axios.post(`${API_URL}/api/checkin`, {
        device_id: deviceId,
        week_id: weekId,
        habits_completed: habitsStr,
        mood_emoji: selectedMoodEmoji,
        mood_scale: moodScale,
        language: i18n.language || 'de',
      });

      setAiResponse(response.data.ai_response);
      setAlreadyCheckedIn(true);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.response?.data?.detail || t('errors.save_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (goals.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Ionicons name="flag-outline" size={80} color={COLORS.textLight} />
          <Text style={styles.emptyTitle}>{t('checkin.no_goals')}</Text>
          <Text style={styles.emptyText}>{t('home.set_goals_first')}</Text>
          <TouchableOpacity style={styles.goToGoalsButton} onPress={() => router.push('/goals')}>
            <Text style={styles.goToGoalsText}>{t('home.set_habits')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (alreadyCheckedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('common.done')}!</Text>
            <Text style={styles.subtitle}>{t('checkin.already_done')}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
            </View>
            <Text style={styles.successText}>{t('checkin.well_done')}</Text>
          </View>

          {aiResponse && (
            <View style={[styles.card, styles.coachCard]}>
              <View style={styles.cardHeader}>
                <Ionicons name="chatbubble-ellipses" size={24} color={COLORS.pink} />
                <Text style={styles.cardTitle}>{t('home.coach_says')}</Text>
              </View>
              <Text style={styles.coachMessage}>{aiResponse}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.backButton} onPress={() => router.push('/')}>
            <Text style={styles.backButtonText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const MOOD_EMOJIS = getMoodEmojis();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('checkin.title')}</Text>
            <Text style={styles.subtitle}>{t('checkin.subtitle')}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('checkin.how_did_it_go')}</Text>
            <Text style={styles.sectionHint}>{t('checkin.tap_to_mark', 'Tippe auf die Gewohnheit zum Markieren')}</Text>
            
            {goals.map((goal, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.habitItem,
                  habitsCompleted[index] && styles.habitItemCompleted,
                ]}
                onPress={() => toggleHabit(index)}
              >
                <View style={[
                  styles.checkbox,
                  habitsCompleted[index] && styles.checkboxChecked,
                ]}>
                  {habitsCompleted[index] && (
                    <Ionicons name="checkmark" size={18} color="#FFF" />
                  )}
                </View>
                <Text style={[
                  styles.habitText,
                  habitsCompleted[index] && styles.habitTextCompleted,
                ]}>
                  {goal}
                </Text>
              </TouchableOpacity>
            ))}

            <View style={styles.summaryContainer}>
              <Text style={styles.summaryText}>
                {t('checkin.result', 'Ergebnis')}: {habitsCompleted.map(h => h ? 'y' : 'n').join('')}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('checkin.mood_question')}</Text>
            
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiScroll}>
              {MOOD_EMOJIS.map((mood, index) => (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.emojiButton,
                    selectedMoodEmoji === mood.emoji && styles.emojiButtonSelected,
                  ]}
                  onPress={() => setSelectedMoodEmoji(mood.emoji)}
                >
                  <Text style={styles.emojiText}>{mood.emoji}</Text>
                  <Text style={styles.emojiLabel}>{mood.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('checkin.mood_scale', 'Mood on a scale from 1-10')}</Text>
            <Text style={styles.scaleValue}>{moodScale}</Text>
            <View style={styles.scaleContainer}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <TouchableOpacity
                  key={num}
                  style={[
                    styles.scaleButton,
                    moodScale === num && styles.scaleButtonSelected,
                  ]}
                  onPress={() => setMoodScale(num)}
                >
                  <Text style={[
                    styles.scaleButtonText,
                    moodScale === num && styles.scaleButtonTextSelected,
                  ]}>
                    {num}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={submitCheckin}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="send" size={20} color="#FFF" />
                <Text style={styles.submitButtonText}>Check-In abschicken</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  header: {
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 4,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 15,
  },
  habitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    marginBottom: 10,
  },
  habitItemCompleted: {
    backgroundColor: '#E8F5E9',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: COLORS.textLight,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  habitText: {
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },
  habitTextCompleted: {
    textDecorationLine: 'line-through',
    color: COLORS.textLight,
  },
  summaryContainer: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emojiScroll: {
    marginTop: 10,
  },
  emojiButton: {
    alignItems: 'center',
    padding: 12,
    marginRight: 8,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
    minWidth: 70,
  },
  emojiButtonSelected: {
    backgroundColor: COLORS.accent,
  },
  emojiText: {
    fontSize: 32,
  },
  emojiLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    marginTop: 4,
  },
  scaleValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.primary,
    textAlign: 'center',
    marginVertical: 10,
  },
  scaleContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  scaleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scaleButtonSelected: {
    backgroundColor: COLORS.primary,
  },
  scaleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  scaleButtonTextSelected: {
    color: '#FFF',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    marginHorizontal: 20,
    padding: 18,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 20,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 10,
  },
  goToGoalsButton: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 12,
  },
  goToGoalsText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  successIcon: {
    alignItems: 'center',
    marginVertical: 20,
  },
  successText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.success,
    textAlign: 'center',
  },
  coachMessage: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },
  backButton: {
    marginHorizontal: 20,
    marginTop: 10,
    padding: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 30,
  },
});
