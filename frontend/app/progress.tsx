import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
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
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { COLOR_PALETTES } from '../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Message {
  role: 'user' | 'coach';
  content: string;
}

const RadarChart = ({ data, labels, size = 250, colors }: { data: number[], labels: string[], size?: number, colors: any }) => {
  const center = size / 2;
  const radius = size / 2 - 40;
  const angleStep = (2 * Math.PI) / labels.length;
  
  const getPoint = (value: number, index: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const r = (value / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const polygonPoints = data.map((value, index) => {
    const point = getPoint(value, index);
    return `${point.x},${point.y}`;
  }).join(' ');

  const gridLevels = [20, 40, 60, 80, 100];
  
  return (
    <Svg width={size} height={size}>
      {gridLevels.map((level, levelIndex) => {
        const gridPoints = labels.map((_, index) => {
          const angle = index * angleStep - Math.PI / 2;
          const r = (level / 100) * radius;
          return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(' ');
        
        return (
          <Polygon
            key={levelIndex}
            points={gridPoints}
            fill="none"
            stroke="#E0E0E0"
            strokeWidth="1"
          />
        );
      })}
      
      {labels.map((_, index) => {
        const angle = index * angleStep - Math.PI / 2;
        return (
          <Line
            key={index}
            x1={center}
            y1={center}
            x2={center + radius * Math.cos(angle)}
            y2={center + radius * Math.sin(angle)}
            stroke="#E0E0E0"
            strokeWidth="1"
          />
        );
      })}
      
      <Polygon
        points={polygonPoints}
        fill={`${colors.primary}40`}
        stroke={colors.primary}
        strokeWidth="2"
      />
      
      {data.map((value, index) => {
        const point = getPoint(value, index);
        return (
          <Circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="6"
            fill={colors.primary}
          />
        );
      })}
      
      {labels.map((label, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const labelRadius = radius + 25;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        
        return (
          <SvgText
            key={index}
            x={x}
            y={y}
            fontSize="12"
            fontWeight="600"
            fill={colors.text}
            textAnchor="middle"
            alignmentBaseline="middle"
          >
            {label}
          </SvgText>
        );
      })}
    </Svg>
  );
};

export default function ProgressScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [weeklyReview, setWeeklyReview] = useState<any>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [userName, setUserName] = useState<string>('');
  
  const [showCoachingModal, setShowCoachingModal] = useState(false);
  const [coachingMessages, setCoachingMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [coachingContext, setCoachingContext] = useState<any>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingCoaching, setLoadingCoaching] = useState(false);

  const WEEKDAYS_SHORT = isEn 
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  const fetchData = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const storedName = await AsyncStorage.getItem('userName');
      if (storedName) setUserName(storedName);
      if (!deviceId) return;

      const [summaryRes, settingsRes] = await Promise.all([
        axios.get(`${API_URL}/api/summary/${deviceId}`),
        axios.get(`${API_URL}/api/settings/${deviceId}`),
      ]);
      
      setSummary(summaryRes.data);
      setSettings(settingsRes.data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchWeeklyReview = async () => {
    setLoadingReview(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const response = await axios.post(`${API_URL}/api/weekly-review`, {
        device_id: deviceId,
        language: i18n.language,
      });
      setWeeklyReview(response.data);
    } catch (error) {
      console.error('Error fetching review:', error);
    } finally {
      setLoadingReview(false);
    }
  };

  const startCoachingSession = async () => {
    setShowCoachingModal(true);
    setLoadingCoaching(true);
    setCoachingMessages([]);
    
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const response = await axios.post(`${API_URL}/api/coaching/start`, {
        device_id: deviceId,
        language: i18n.language,
      });
      
      setCoachingContext(response.data.context);
      setCoachingMessages([{
        role: 'coach',
        content: response.data.opening_message,
      }]);
    } catch (error) {
      console.error('Error starting coaching:', error);
      setCoachingMessages([{
        role: 'coach',
        content: isEn 
          ? 'Hello! 💜 Let\'s look at your week together. How are you feeling right now?'
          : 'Hallo! 💜 Lass uns gemeinsam auf deine Woche schauen. Wie fühlst du dich gerade?',
      }]);
    } finally {
      setLoadingCoaching(false);
    }
  };

  const sendCoachingMessage = async () => {
    if (!userInput.trim() || sendingMessage) return;
    
    const userMessage = userInput.trim();
    setUserInput('');
    setSendingMessage(true);
    
    const updatedMessages: Message[] = [...coachingMessages, { role: 'user', content: userMessage }];
    setCoachingMessages(updatedMessages);
    
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const response = await axios.post(`${API_URL}/api/coaching/message`, {
        device_id: deviceId,
        user_message: userMessage,
        conversation_history: updatedMessages.map(m => ({ role: m.role, content: m.content })),
        context: coachingContext,
        language: i18n.language,
      });
      
      setCoachingMessages([...updatedMessages, {
        role: 'coach',
        content: response.data.coach_message,
      }]);
    } catch (error) {
      console.error('Error sending message:', error);
      setCoachingMessages([...updatedMessages, {
        role: 'coach',
        content: isEn 
          ? 'I understand. What do you think could help you with that? 💜'
          : 'Das verstehe ich. Was denkst du, könnte dir dabei helfen? 💜',
      }]);
    } finally {
      setSendingMessage(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (summary?.total_days_tracked > 0 && !weeklyReview) {
      fetchWeeklyReview();
    }
  }, [summary]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setWeeklyReview(null);
    fetchData();
  }, []);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const goals = summary?.goals || [];
  const successRates = summary?.success_rates || [0, 0, 0];
  const overallSuccess = summary?.overall_success || 0;
  const avgMood = summary?.average_mood || 0;
  const daysTracked = summary?.total_days_tracked || 0;
  const isWeekComplete = summary?.is_week_complete || false;
  const checkins = summary?.checkins || [];

  const radarLabels = goals.length > 0 
    ? goals.map((_g: string, i: number) => isEn ? `Goal ${i + 1}` : `Ziel ${i + 1}`)
    : isEn ? ['Goal 1', 'Goal 2', 'Goal 3'] : ['Ziel 1', 'Ziel 2', 'Ziel 3'];

  const moodData = checkins.map((c: any) => c.mood_scale || 5);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            {userName 
              ? (isEn ? `${userName}'s Week` : `${userName}s Woche`) 
              : (isEn ? 'Your Week' : 'Deine Woche')} 📊
          </Text>
          <Text style={[styles.subtitle, { color: colors.textLight }]}>
            {isEn ? `${daysTracked} of 7 days tracked` : `${daysTracked} von 7 Tagen erfasst`}
          </Text>
        </View>

        {daysTracked === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="analytics-outline" size={80} color={colors.textLight} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {isEn ? 'No data yet' : 'Noch keine Daten'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.textLight }]}>
              {isEn 
                ? 'Start with the daily check-in to see your progress.'
                : 'Starte mit dem täglichen Check-in, um deinen Fortschritt zu sehen.'}
            </Text>
            <TouchableOpacity 
              style={[styles.startButton, { backgroundColor: colors.primary }]} 
              onPress={() => router.push('/checkin')}
            >
              <Text style={styles.startButtonText}>{isEn ? 'Start now' : 'Jetzt starten'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Spiderweb Chart */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {isEn ? 'Success rate per habit' : 'Erfolgsrate pro Gewohnheit'}
              </Text>
              <View style={styles.chartContainer}>
                <RadarChart
                  data={successRates}
                  labels={radarLabels}
                  size={Math.min(SCREEN_WIDTH - 80, 280)}
                  colors={colors}
                />
              </View>
              <View style={styles.legendContainer}>
                {goals.map((goal: string, index: number) => (
                  <View key={index} style={styles.legendItem}>
                    <View style={[
                      styles.legendDot,
                      { backgroundColor: [colors.primary, colors.secondary, colors.accent][index] }
                    ]} />
                    <Text style={[styles.legendText, { color: colors.text }]} numberOfLines={1}>
                      {goal}
                    </Text>
                    <Text style={[styles.legendPercent, { color: colors.primary }]}>
                      {Math.round(successRates[index])}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Stats Row */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.secondary + '30' }]}>
                <Ionicons name="trophy" size={32} color={colors.secondary} />
                <Text style={[styles.statValue, { color: colors.text }]}>{Math.round(overallSuccess)}%</Text>
                <Text style={[styles.statLabel, { color: colors.textLight }]}>
                  {isEn ? 'Overall success' : 'Gesamterfolg'}
                </Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.accent + '40' }]}>
                <Text style={styles.moodEmoji}>😊</Text>
                <Text style={[styles.statValue, { color: colors.text }]}>{avgMood.toFixed(1)}</Text>
                <Text style={[styles.statLabel, { color: colors.textLight }]}>
                  {isEn ? 'Ø Mood' : 'Ø Stimmung'}
                </Text>
              </View>
            </View>

            {/* AI Weekly Review */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.reviewHeader}>
                <Ionicons name="sparkles" size={24} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 0, marginLeft: 10 }]}>
                  {isEn ? 'Your Weekly Review' : 'Deine Wochen-Auswertung'}
                </Text>
              </View>
              
              {loadingReview ? (
                <View style={styles.reviewLoading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.reviewLoadingText, { color: colors.textLight }]}>
                    {isEn ? 'Creating your personal review...' : 'Erstelle deine persönliche Auswertung...'}
                  </Text>
                </View>
              ) : weeklyReview ? (
                <>
                  <Text style={[styles.reviewText, { color: colors.text }]}>
                    {weeklyReview.review_text}
                  </Text>
                  
                  <View style={[styles.recommendationBox, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="bulb" size={20} color={colors.primary} />
                    <Text style={[styles.recommendationText, { color: colors.text }]}>
                      {weeklyReview.recommendation_text}
                    </Text>
                  </View>
                </>
              ) : (
                <TouchableOpacity 
                  style={[styles.loadReviewButton, { backgroundColor: colors.primary }]}
                  onPress={fetchWeeklyReview}
                >
                  <Text style={styles.loadReviewButtonText}>
                    {isEn ? 'Load review' : 'Auswertung laden'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Coaching Reflection Button */}
            <TouchableOpacity 
              style={[styles.coachingBanner, { backgroundColor: colors.secondary }]}
              onPress={startCoachingSession}
            >
              <View style={styles.coachingBannerContent}>
                <View style={styles.coachingIconContainer}>
                  <Ionicons name="chatbubbles" size={28} color="#FFF" />
                </View>
                <View style={styles.coachingTextContainer}>
                  <Text style={styles.coachingBannerTitle}>
                    {isEn ? 'Reflection Coaching 💜' : 'Reflexions-Coaching 💜'}
                  </Text>
                  <Text style={styles.coachingBannerSubtitle}>
                    {isEn 
                      ? 'Find out what worked and what didn\'t'
                      : 'Finde heraus, was funktioniert hat und was nicht'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#FFF" />
              </View>
            </TouchableOpacity>

            {/* Days Overview */}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {isEn ? 'Daily Overview' : 'Tagesübersicht'}
              </Text>
              <View style={styles.daysGrid}>
                {WEEKDAYS_SHORT.map((day, index) => {
                  const checkin = checkins[index];
                  const habits = checkin?.habits_completed || '';
                  const completed = habits.split('').filter((c: string) => c === 'y').length;
                  
                  return (
                    <View key={index} style={styles.dayItem}>
                      <Text style={[styles.dayLabel, { color: colors.textLight }]}>{day}</Text>
                      {checkin ? (
                        <>
                          <View style={[
                            styles.dayCircle,
                            { backgroundColor: colors.textLight },
                            completed === 3 && { backgroundColor: colors.secondary },
                            completed === 2 && { backgroundColor: colors.accent },
                            completed === 1 && { backgroundColor: colors.primary + '80' },
                            completed === 0 && { backgroundColor: colors.primary },
                          ]}>
                            <Text style={styles.dayScore}>{completed}/3</Text>
                          </View>
                          <Text style={styles.dayMood}>{checkin.mood_emoji}</Text>
                        </>
                      ) : (
                        <View style={[styles.dayCircleEmpty, { backgroundColor: colors.background }]}>
                          <Ionicons name="remove" size={20} color={colors.textLight} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Mood Trend */}
            {moodData.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {isEn ? 'Mood Trend' : 'Stimmungsverlauf'}
                </Text>
                <View style={styles.moodTrend}>
                  {moodData.map((mood: number, index: number) => (
                    <View key={index} style={styles.moodBar}>
                      <View style={[
                        styles.moodBarFill,
                        { height: `${mood * 10}%`, backgroundColor: colors.accent }
                      ]} />
                      <Text style={[styles.moodBarLabel, { color: colors.textLight }]}>
                        {WEEKDAYS_SHORT[index]}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Week Complete Card */}
            {isWeekComplete && (
              <View style={[
                styles.card,
                { 
                  backgroundColor: overallSuccess >= 70 ? colors.secondary + '20' : colors.accent + '30',
                  borderWidth: 1,
                  borderColor: overallSuccess >= 70 ? colors.secondary : colors.accent,
                }
              ]}>
                <View style={styles.weekCompleteContent}>
                  <Ionicons 
                    name={overallSuccess >= 70 ? 'trophy' : 'refresh'} 
                    size={48} 
                    color={overallSuccess >= 70 ? colors.secondary : colors.accent} 
                  />
                  <Text style={[styles.weekCompleteTitle, { color: colors.text }]}>
                    {overallSuccess >= 70 
                      ? (isEn ? 'Fantastic week! 🎉' : 'Fantastische Woche! 🎉') 
                      : (isEn ? 'Week completed' : 'Woche beendet')}
                  </Text>
                  <Text style={[styles.weekCompleteText, { color: colors.textLight }]}>
                    {overallSuccess >= 70 
                      ? (isEn ? 'You achieved your goals brilliantly! Keep it up!' : 'Du hast deine Ziele großartig erreicht! Weiter so!')
                      : (isEn ? 'Every week is a new beginning. What do you want to do differently next week?' : 'Jede Woche ist ein neuer Anfang. Was möchtest du nächste Woche anders machen?')
                    }
                  </Text>
                  <TouchableOpacity 
                    style={[styles.newWeekButton, { backgroundColor: colors.primary }]} 
                    onPress={() => router.push('/goals')}
                  >
                    <Text style={styles.newWeekButtonText}>
                      {isEn ? 'Set new weekly goals' : 'Neue Wochenziele setzen'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Coaching Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showCoachingModal}
        onRequestClose={() => setShowCoachingModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={[styles.coachingModal, { backgroundColor: colors.card }]}>
            <View style={[styles.coachingHeader, { borderBottomColor: colors.background }]}>
              <View style={styles.coachingHeaderLeft}>
                <Ionicons name="chatbubbles" size={24} color={colors.primary} />
                <Text style={[styles.coachingHeaderTitle, { color: colors.text }]}>
                  {isEn ? 'Reflection Coaching' : 'Reflexions-Coaching'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowCoachingModal(false)}>
                <Ionicons name="close-circle" size={28} color={colors.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
            >
              {loadingCoaching ? (
                <View style={styles.coachingLoading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.coachingLoadingText, { color: colors.textLight }]}>
                    {isEn ? 'Coach is preparing...' : 'Coach bereitet sich vor...'}
                  </Text>
                </View>
              ) : (
                coachingMessages.map((message, index) => (
                  <View 
                    key={index} 
                    style={[
                      styles.messageBubble,
                      message.role === 'coach' 
                        ? [styles.coachBubble, { backgroundColor: colors.primary + '15' }]
                        : [styles.userBubble, { backgroundColor: colors.secondary }]
                    ]}
                  >
                    {message.role === 'coach' && (
                      <View style={styles.coachAvatar}>
                        <Text style={styles.coachAvatarEmoji}>💜</Text>
                      </View>
                    )}
                    <Text style={[
                      styles.messageText,
                      { color: message.role === 'coach' ? colors.text : '#FFF' }
                    ]}>
                      {message.content}
                    </Text>
                  </View>
                ))
              )}
              {sendingMessage && (
                <View style={[styles.messageBubble, styles.coachBubble, { backgroundColor: colors.primary + '15' }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              )}
            </ScrollView>

            <View style={[styles.inputContainer, { borderTopColor: colors.background }]}>
              <TextInput
                style={[styles.messageInput, { backgroundColor: colors.background, color: colors.text }]}
                placeholder={isEn ? 'Your answer...' : 'Deine Antwort...'}
                placeholderTextColor={colors.textLight}
                value={userInput}
                onChangeText={setUserInput}
                multiline
                maxLength={500}
              />
              <TouchableOpacity 
                style={[
                  styles.sendButton, 
                  { backgroundColor: colors.primary },
                  (!userInput.trim() || sendingMessage) && styles.sendButtonDisabled
                ]}
                onPress={sendCoachingMessage}
                disabled={!userInput.trim() || sendingMessage}
              >
                <Ionicons name="send" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, paddingTop: 10 },
  title: { fontSize: 28, fontWeight: 'bold' },
  subtitle: { fontSize: 16, marginTop: 4 },
  card: { marginHorizontal: 20, marginBottom: 15, borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 15 },
  chartContainer: { alignItems: 'center', marginVertical: 10 },
  legendContainer: { marginTop: 15 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  legendText: { flex: 1, fontSize: 14 },
  legendPercent: { fontSize: 14, fontWeight: '600' },
  statsRow: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 15, gap: 15 },
  statCard: { flex: 1, borderRadius: 16, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: 'bold', marginTop: 8 },
  statLabel: { fontSize: 13, marginTop: 4 },
  moodEmoji: { fontSize: 32 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  reviewLoading: { alignItems: 'center', padding: 20 },
  reviewLoadingText: { marginTop: 10, fontSize: 14 },
  reviewText: { fontSize: 15, lineHeight: 24 },
  recommendationBox: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 15, padding: 15, borderRadius: 12, gap: 10 },
  recommendationText: { flex: 1, fontSize: 14, lineHeight: 20 },
  loadReviewButton: { padding: 14, borderRadius: 12, alignItems: 'center' },
  loadReviewButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  coachingBanner: { marginHorizontal: 20, marginBottom: 15, borderRadius: 16, padding: 16 },
  coachingBannerContent: { flexDirection: 'row', alignItems: 'center' },
  coachingIconContainer: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  coachingTextContainer: { flex: 1, marginLeft: 12 },
  coachingBannerTitle: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  coachingBannerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  daysGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  dayItem: { alignItems: 'center', flex: 1 },
  dayLabel: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  dayCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  dayCircleEmpty: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  dayScore: { fontSize: 10, fontWeight: 'bold', color: '#FFF' },
  dayMood: { fontSize: 16, marginTop: 4 },
  moodTrend: { flexDirection: 'row', justifyContent: 'space-between', height: 120, alignItems: 'flex-end' },
  moodBar: { flex: 1, alignItems: 'center', marginHorizontal: 4 },
  moodBarFill: { width: 20, borderRadius: 10, minHeight: 10 },
  moodBarLabel: { fontSize: 10, marginTop: 4 },
  weekCompleteContent: { alignItems: 'center' },
  weekCompleteTitle: { fontSize: 22, fontWeight: 'bold', marginTop: 12 },
  weekCompleteText: { fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  newWeekButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
  newWeekButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, marginTop: 50 },
  emptyTitle: { fontSize: 22, fontWeight: 'bold', marginTop: 20 },
  emptyText: { fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 22 },
  startButton: { marginTop: 24, paddingHorizontal: 30, paddingVertical: 14, borderRadius: 12 },
  startButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  bottomSpacer: { height: 30 },
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  coachingModal: { flex: 1, marginTop: 60, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  coachingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1 },
  coachingHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coachingHeaderTitle: { fontSize: 18, fontWeight: '700' },
  messagesContainer: { flex: 1 },
  messagesContent: { padding: 16 },
  coachingLoading: { alignItems: 'center', padding: 40 },
  coachingLoadingText: { marginTop: 10, fontSize: 14 },
  messageBubble: { maxWidth: '85%', padding: 14, borderRadius: 18, marginBottom: 12 },
  coachBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  coachAvatar: { marginBottom: 6 },
  coachAvatarEmoji: { fontSize: 20 },
  messageText: { fontSize: 15, lineHeight: 22 },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, borderTopWidth: 1, gap: 10 },
  messageInput: { flex: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { opacity: 0.5 },
});
