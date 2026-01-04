import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
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

export default function GoalsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [goals, setGoals] = useState(['', '', '']);
  const [existingGoals, setExistingGoals] = useState<string[] | null>(null);
  const [advice, setAdvice] = useState('');
  const [showAdvice, setShowAdvice] = useState(false);

  const today = new Date();
  const isSunday = today.getDay() === 0;

  useEffect(() => {
    fetchCurrentGoals();
  }, []);

  const fetchCurrentGoals = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) return;

      const response = await axios.get(`${API_URL}/api/goals/${deviceId}`);
      if (response.data.goals) {
        setExistingGoals(response.data.goals);
        setGoals(response.data.goals);
      }
    } catch (error) {
      console.error('Error fetching goals:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdvice = async () => {
    setLoadingAdvice(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const response = await axios.post(`${API_URL}/api/advice`, {
        device_id: deviceId,
      });
      setAdvice(response.data.advice);
      setShowAdvice(true);
    } catch (error) {
      console.error('Error fetching advice:', error);
      Alert.alert('Fehler', 'Tipps konnten nicht geladen werden');
    } finally {
      setLoadingAdvice(false);
    }
  };

  const saveGoals = async () => {
    const trimmedGoals = goals.map(g => g.trim());
    if (trimmedGoals.some(g => g === '')) {
      Alert.alert('Hinweis', 'Bitte fuelle alle 3 Ziele aus');
      return;
    }

    setSaving(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      await axios.post(`${API_URL}/api/goals`, {
        device_id: deviceId,
        goals: trimmedGoals,
      });

      Alert.alert(
        'Gespeichert!',
        'Deine Wochenziele wurden gespeichert. Viel Erfolg!',
        [{ text: 'Super!', onPress: () => router.push('/') }]
      );
    } catch (error: any) {
      Alert.alert('Fehler', error.response?.data?.detail || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const updateGoal = (index: number, text: string) => {
    const newGoals = [...goals];
    newGoals[index] = text;
    setGoals(newGoals);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <Text style={styles.title}>Wochenziele</Text>
            <Text style={styles.subtitle}>
              {isSunday ? 'Perfekter Tag fuer neue Ziele!' : 'Setze oder bearbeite deine Ziele'}
            </Text>
          </View>

          {isSunday && (
            <TouchableOpacity 
              style={styles.adviceBanner} 
              onPress={fetchAdvice}
              disabled={loadingAdvice}
            >
              <View style={styles.adviceBannerContent}>
                <Ionicons name="bulb" size={28} color="#FFF" />
                <View style={styles.adviceBannerText}>
                  <Text style={styles.adviceBannerTitle}>Tipps fuer Tiny Habits</Text>
                  <Text style={styles.adviceBannerSubtitle}>
                    {loadingAdvice ? 'Wird geladen...' : 'Tippe fuer hilfreiche Ratschlaege'}
                  </Text>
                </View>
                {loadingAdvice && <ActivityIndicator color="#FFF" />}
              </View>
            </TouchableOpacity>
          )}

          {showAdvice && (
            <View style={styles.adviceCard}>
              <View style={styles.adviceHeader}>
                <Ionicons name="sparkles" size={24} color={COLORS.accent} />
                <Text style={styles.adviceTitle}>Tipps vom Coach</Text>
                <TouchableOpacity onPress={() => setShowAdvice(false)}>
                  <Ionicons name="close-circle" size={24} color={COLORS.textLight} />
                </TouchableOpacity>
              </View>
              <Text style={styles.adviceText}>{advice}</Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Deine 3 kleinen Gewohnheiten</Text>
            <Text style={styles.sectionHint}>
              Waehle Gewohnheiten, die so klein sind, dass du sie nicht ablehnen kannst!
            </Text>

            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.goalInputContainer}>
                <View style={[
                  styles.goalNumber,
                  { backgroundColor: [COLORS.primary, COLORS.secondary, COLORS.purple][index] }
                ]}>
                  <Text style={styles.goalNumberText}>{index + 1}</Text>
                </View>
                <TextInput
                  style={styles.goalInput}
                  placeholder={[
                    'z.B. Nach dem Aufstehen ein Glas Wasser trinken',
                    'z.B. Nach dem Zaehneputzen 2 Kniebeugen machen',
                    'z.B. Vor dem Schlafengehen 3 Dinge aufschreiben',
                  ][index]}
                  placeholderTextColor="#AAA"
                  value={goals[index]}
                  onChangeText={(text) => updateGoal(index, text)}
                  multiline
                  maxLength={100}
                />
              </View>
            ))}
          </View>

          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Tipps fuer effektive Tiny Habits</Text>
            <View style={styles.tipItem}>
              <Ionicons name="time-outline" size={20} color={COLORS.secondary} />
              <Text style={styles.tipText}>Dauert weniger als 30 Sekunden</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="link-outline" size={20} color={COLORS.secondary} />
              <Text style={styles.tipText}>Verknuepfe mit bestehender Routine</Text>
            </View>
            <View style={styles.tipItem}>
              <Ionicons name="heart-outline" size={20} color={COLORS.secondary} />
              <Text style={styles.tipText}>Fuehlt sich gut an nach dem Erledigen</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={saveGoals}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="save" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>
                  {existingGoals ? 'Ziele aktualisieren' : 'Ziele speichern'}
                </Text>
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
  adviceBanner: {
    marginHorizontal: 20,
    marginBottom: 15,
    backgroundColor: COLORS.purple,
    borderRadius: 16,
    padding: 16,
  },
  adviceBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adviceBannerText: {
    marginLeft: 12,
    flex: 1,
  },
  adviceBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
  },
  adviceBannerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  adviceCard: {
    backgroundColor: '#FFFBEB',
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  adviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  adviceTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginLeft: 10,
    flex: 1,
  },
  adviceText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 22,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 20,
  },
  goalInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  goalNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 10,
  },
  goalNumberText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  goalInput: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 50,
  },
  tipsCard: {
    backgroundColor: '#E8F5E9',
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 16,
    padding: 16,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    color: COLORS.text,
    marginLeft: 10,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    marginHorizontal: 20,
    padding: 18,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  bottomSpacer: {
    height: 30,
  },
});
