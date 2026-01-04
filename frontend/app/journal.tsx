import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { COLOR_PALETTES } from '../contexts/SettingsContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface JournalEntry {
  id: string;
  date: string;
  note?: string;
  reflection_question?: string;
  reflection_answer?: string;
  gratitudes: string[];
  mood_note?: string;
}

export default function JournalScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [todayEntry, setTodayEntry] = useState<JournalEntry | null>(null);
  const [reflectionQuestion, setReflectionQuestion] = useState('');
  const [pastEntries, setPastEntries] = useState<JournalEntry[]>([]);
  const [showPastEntries, setShowPastEntries] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  
  // Form state
  const [note, setNote] = useState('');
  const [reflectionAnswer, setReflectionAnswer] = useState('');
  const [gratitudes, setGratitudes] = useState(['', '', '']);
  const [moodNote, setMoodNote] = useState('');

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  const fetchData = useCallback(async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) return;

      const [todayRes, entriesRes, settingsRes] = await Promise.all([
        axios.get(`${API_URL}/api/journal/${deviceId}/today`),
        axios.get(`${API_URL}/api/journal/${deviceId}?limit=30`),
        axios.get(`${API_URL}/api/settings/${deviceId}`),
      ]);

      setReflectionQuestion(todayRes.data.reflection_question);
      setSettings(settingsRes.data);
      
      if (todayRes.data.entry) {
        const entry = todayRes.data.entry;
        setTodayEntry(entry);
        setNote(entry.note || '');
        setReflectionAnswer(entry.reflection_answer || '');
        setGratitudes(entry.gratitudes?.length >= 3 ? entry.gratitudes : ['', '', '']);
        setMoodNote(entry.mood_note || '');
      }
      
      // Filter out today's entry from past entries
      const today = new Date().toDateString();
      const past = entriesRes.data.entries.filter((e: JournalEntry) => 
        new Date(e.date).toDateString() !== today
      );
      setPastEntries(past);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const saveEntry = async () => {
    setSaving(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      
      await axios.post(`${API_URL}/api/journal`, {
        device_id: deviceId,
        note: note.trim() || null,
        reflection_answer: reflectionAnswer.trim() || null,
        gratitudes: gratitudes.filter(g => g.trim()),
        mood_note: moodNote.trim() || null,
      });

      Alert.alert('Gespeichert!', 'Dein Tagebuch-Eintrag wurde gespeichert.');
      fetchData();
    } catch (error) {
      Alert.alert('Fehler', 'Eintrag konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const updateGratitude = (index: number, text: string) => {
    const newGratitudes = [...gratitudes];
    newGratitudes[index] = text;
    setGratitudes(newGratitudes);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={styles.scrollView}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Tagebuch</Text>
            <Text style={[styles.dateText, { color: colors.textLight }]}>
              {formatDate(new Date().toISOString())}
            </Text>
          </View>

          {/* Reflection Question */}
          <View style={[styles.card, { backgroundColor: colors.accent + '30', borderColor: colors.accent, borderWidth: 1 }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="bulb" size={24} color={colors.accent} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Reflexionsfrage</Text>
            </View>
            <Text style={[styles.questionText, { color: colors.text }]}>{reflectionQuestion}</Text>
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.accent }]}
              value={reflectionAnswer}
              onChangeText={setReflectionAnswer}
              placeholder="Deine Antwort..."
              placeholderTextColor={colors.textLight}
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Gratitude Section */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="heart" size={24} color="#EC4899" />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Dankbarkeit</Text>
            </View>
            <Text style={[styles.sectionHint, { color: colors.textLight }]}>
              Wofuer bist du heute dankbar?
            </Text>
            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.gratitudeRow}>
                <View style={[styles.gratitudeNumber, { backgroundColor: '#EC4899' }]}>
                  <Ionicons name="heart" size={14} color="#FFF" />
                </View>
                <TextInput
                  style={[styles.gratitudeInput, { backgroundColor: colors.background, color: colors.text }]}
                  value={gratitudes[index]}
                  onChangeText={(text) => updateGratitude(index, text)}
                  placeholder={`Dankbarkeit ${index + 1}...`}
                  placeholderTextColor={colors.textLight}
                />
              </View>
            ))}
          </View>

          {/* Daily Note */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="document-text" size={24} color={colors.secondary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Tagesnotiz</Text>
            </View>
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.background, color: colors.text }]}
              value={note}
              onChangeText={setNote}
              placeholder="Was ist heute passiert? Was hat dich beschaeftigt?"
              placeholderTextColor={colors.textLight}
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Mood Note */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="happy" size={24} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Stimmungs-Notiz</Text>
            </View>
            <TextInput
              style={[styles.textArea, { backgroundColor: colors.background, color: colors.text }]}
              value={moodNote}
              onChangeText={setMoodNote}
              placeholder="Wie fuehlt sich heute an? Warum?"
              placeholderTextColor={colors.textLight}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.primary }]}
            onPress={saveEntry}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="save" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>Eintrag speichern</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Past Entries Toggle */}
          <TouchableOpacity
            style={[styles.pastEntriesToggle, { borderColor: colors.primary }]}
            onPress={() => setShowPastEntries(!showPastEntries)}
          >
            <Ionicons 
              name={showPastEntries ? "chevron-up" : "chevron-down"} 
              size={20} 
              color={colors.primary} 
            />
            <Text style={[styles.pastEntriesText, { color: colors.primary }]}>
              Fruehere Eintraege ({pastEntries.length})
            </Text>
          </TouchableOpacity>

          {/* Past Entries */}
          {showPastEntries && (
            <View style={styles.pastEntriesContainer}>
              {pastEntries.length === 0 ? (
                <Text style={[styles.noEntriesText, { color: colors.textLight }]}>
                  Noch keine frueheren Eintraege
                </Text>
              ) : (
                pastEntries.map((entry) => (
                  <View key={entry.id} style={[styles.pastEntryCard, { backgroundColor: colors.card }]}>
                    <Text style={[styles.pastEntryDate, { color: colors.primary }]}>
                      {formatDate(entry.date)}
                    </Text>
                    
                    {entry.note && (
                      <View style={styles.pastEntrySection}>
                        <Ionicons name="document-text" size={16} color={colors.secondary} />
                        <Text style={[styles.pastEntryText, { color: colors.text }]}>{entry.note}</Text>
                      </View>
                    )}
                    
                    {entry.gratitudes && entry.gratitudes.length > 0 && (
                      <View style={styles.pastEntrySection}>
                        <Ionicons name="heart" size={16} color="#EC4899" />
                        <View style={styles.pastGratitudes}>
                          {entry.gratitudes.map((g, i) => (
                            <Text key={i} style={[styles.pastGratitudeText, { color: colors.textLight }]}>
                              {g}
                            </Text>
                          ))}
                        </View>
                      </View>
                    )}
                    
                    {entry.reflection_answer && (
                      <View style={styles.pastEntrySection}>
                        <Ionicons name="bulb" size={16} color={colors.accent} />
                        <Text style={[styles.pastEntryText, { color: colors.text }]}>
                          {entry.reflection_answer}
                        </Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  dateText: {
    fontSize: 16,
    marginTop: 4,
  },
  card: {
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
  },
  questionText: {
    fontSize: 16,
    fontStyle: 'italic',
    marginBottom: 15,
    lineHeight: 24,
  },
  sectionHint: {
    fontSize: 14,
    marginBottom: 15,
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 15,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  gratitudeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  gratitudeNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  gratitudeInput: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
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
  pastEntriesToggle: {
    marginHorizontal: 20,
    marginTop: 15,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pastEntriesText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pastEntriesContainer: {
    marginTop: 15,
    marginHorizontal: 20,
  },
  noEntriesText: {
    textAlign: 'center',
    padding: 20,
  },
  pastEntryCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  pastEntryDate: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  pastEntrySection: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 8,
  },
  pastEntryText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  pastGratitudes: {
    flex: 1,
  },
  pastGratitudeText: {
    fontSize: 13,
    marginBottom: 2,
  },
  bottomSpacer: {
    height: 30,
  },
});
