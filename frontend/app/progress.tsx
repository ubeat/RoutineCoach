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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const RadarChart = ({ data, labels, size = 250 }: { data: number[], labels: string[], size?: number }) => {
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
        fill={`${COLORS.primary}40`}
        stroke={COLORS.primary}
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
            fill={COLORS.primary}
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
            fill={COLORS.text}
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const fetchSummary = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) return;

      const response = await axios.get(`${API_URL}/api/summary/${deviceId}`);
      setSummary(response.data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSummary();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
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
    ? goals.map((_g: string, i: number) => `Ziel ${i + 1}`)
    : ['Ziel 1', 'Ziel 2', 'Ziel 3'];

  const moodData = checkins.map((c: any) => c.mood_scale || 5);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Wochenfortschritt</Text>
          <Text style={styles.subtitle}>{daysTracked} von 7 Tagen erfasst</Text>
        </View>

        {daysTracked === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="analytics-outline" size={80} color={COLORS.textLight} />
            <Text style={styles.emptyTitle}>Noch keine Daten</Text>
            <Text style={styles.emptyText}>
              Starte mit dem taeglichen Check-In, um deinen Fortschritt zu sehen.
            </Text>
            <TouchableOpacity style={styles.startButton} onPress={() => router.push('/checkin')}>
              <Text style={styles.startButtonText}>Jetzt starten</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Erfolgsrate pro Gewohnheit</Text>
              <View style={styles.chartContainer}>
                <RadarChart
                  data={successRates}
                  labels={radarLabels}
                  size={Math.min(SCREEN_WIDTH - 80, 280)}
                />
              </View>
              <View style={styles.legendContainer}>
                {goals.map((goal: string, index: number) => (
                  <View key={index} style={styles.legendItem}>
                    <View style={[
                      styles.legendDot,
                      { backgroundColor: [COLORS.primary, COLORS.secondary, COLORS.purple][index] }
                    ]} />
                    <Text style={styles.legendText} numberOfLines={1}>
                      {goal}
                    </Text>
                    <Text style={styles.legendPercent}>
                      {Math.round(successRates[index])}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="trophy" size={32} color={COLORS.success} />
                <Text style={styles.statValue}>{Math.round(overallSuccess)}%</Text>
                <Text style={styles.statLabel}>Gesamterfolg</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#FFF3E0' }]}>
                <Text style={styles.moodEmoji}>😊</Text>
                <Text style={styles.statValue}>{avgMood.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Durchschn. Stimmung</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Tagesuebersicht</Text>
              <View style={styles.daysGrid}>
                {WEEKDAYS_SHORT.map((day, index) => {
                  const checkin = checkins[index];
                  const habits = checkin?.habits_completed || '';
                  const completed = habits.split('').filter((c: string) => c === 'y').length;
                  
                  return (
                    <View key={index} style={styles.dayItem}>
                      <Text style={styles.dayLabel}>{day}</Text>
                      {checkin ? (
                        <>
                          <View style={[
                            styles.dayCircle,
                            completed === 3 && styles.dayCircleSuccess,
                            completed === 2 && styles.dayCirclePartial,
                            completed === 1 && styles.dayCircleWeak,
                            completed === 0 && styles.dayCircleFail,
                          ]}>
                            <Text style={styles.dayScore}>{completed}/3</Text>
                          </View>
                          <Text style={styles.dayMood}>{checkin.mood_emoji}</Text>
                        </>
                      ) : (
                        <View style={styles.dayCircleEmpty}>
                          <Ionicons name="remove" size={20} color={COLORS.textLight} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>

            {isWeekComplete && (
              <View style={[
                styles.card,
                overallSuccess >= 70 ? styles.successCard : styles.retryCard
              ]}>
                <Ionicons 
                  name={overallSuccess >= 70 ? 'trophy' : 'refresh'} 
                  size={48} 
                  color={overallSuccess >= 70 ? COLORS.success : COLORS.warning} 
                />
                <Text style={styles.weekCompleteTitle}>
                  {overallSuccess >= 70 ? 'Fantastische Woche!' : 'Woche beendet'}
                </Text>
                <Text style={styles.weekCompleteText}>
                  {overallSuccess >= 70 
                    ? 'Du hast deine Ziele grossartig erreicht! Weiter so!'
                    : 'Kein Problem! Jede Woche ist ein neuer Anfang. Vielleicht waehle naechste Woche noch kleinere Gewohnheiten?'
                  }
                </Text>
                <TouchableOpacity 
                  style={styles.newWeekButton} 
                  onPress={() => router.push('/goals')}
                >
                  <Text style={styles.newWeekButtonText}>Neue Wochenziele setzen</Text>
                </TouchableOpacity>
              </View>
            )}

            {moodData.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Stimmungsverlauf</Text>
                <View style={styles.moodTrend}>
                  {moodData.map((mood: number, index: number) => (
                    <View key={index} style={styles.moodBar}>
                      <View style={[
                        styles.moodBarFill,
                        { height: `${mood * 10}%` }
                      ]} />
                      <Text style={styles.moodBarLabel}>{WEEKDAYS_SHORT[index]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 15,
  },
  chartContainer: {
    alignItems: 'center',
    marginVertical: 10,
  },
  legendContainer: {
    marginTop: 15,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  legendText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  legendPercent: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 15,
    gap: 15,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 4,
  },
  moodEmoji: {
    fontSize: 32,
  },
  daysGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayItem: {
    alignItems: 'center',
    flex: 1,
  },
  dayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 8,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleEmpty: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleSuccess: {
    backgroundColor: COLORS.success,
  },
  dayCirclePartial: {
    backgroundColor: COLORS.secondary,
  },
  dayCircleWeak: {
    backgroundColor: COLORS.warning,
  },
  dayCircleFail: {
    backgroundColor: COLORS.primary,
  },
  dayScore: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFF',
  },
  dayMood: {
    fontSize: 16,
    marginTop: 4,
  },
  successCard: {
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  retryCard: {
    backgroundColor: '#FFF8E1',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.warning,
  },
  weekCompleteTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 12,
  },
  weekCompleteText: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  newWeekButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 16,
  },
  newWeekButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  moodTrend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 120,
    alignItems: 'flex-end',
  },
  moodBar: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  moodBarFill: {
    width: 20,
    backgroundColor: COLORS.purple,
    borderRadius: 10,
    minHeight: 10,
  },
  moodBarLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 50,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    marginTop: 20,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
  },
  startButton: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 12,
  },
  startButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 30,
  },
});
