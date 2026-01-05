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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { COLOR_PALETTES } from '../contexts/SettingsContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Gollwitzer Implementation Intentions - Wenn-Dann Vorschläge
const WENN_DANN_VORSCHLAEGE = [
  {
    wenn: 'Nachdem ich morgens aufgestanden bin',
    dann: ['ein Glas Wasser trinken', 'mein Bett machen', '3 tiefe Atemzuege nehmen', 'mich kurz strecken'],
  },
  {
    wenn: 'Nachdem ich mir die Zaehne geputzt habe',
    dann: ['2 Kniebeugen machen', 'mein Gesicht eincremen', 'im Spiegel laecheln', 'eine Affirmation sagen'],
  },
  {
    wenn: 'Bevor ich fruehstuecke',
    dann: ['ein Glas Wasser trinken', 'kurz meditieren', 'meine Tagesziele anschauen'],
  },
  {
    wenn: 'Wenn ich mich an den Schreibtisch setze',
    dann: ['3 tiefe Atemzuege nehmen', 'meine wichtigste Aufgabe notieren', 'Wasser bereitstellen'],
  },
  {
    wenn: 'Nachdem ich Mittag gegessen habe',
    dann: ['5 Minuten spazieren gehen', '10 Schritte gehen', 'mich kurz strecken'],
  },
  {
    wenn: 'Wenn ich nach Hause komme',
    dann: ['Schuhe ordentlich wegstellen', 'tief durchatmen', 'mich kurz hinsetzen'],
  },
  {
    wenn: 'Bevor ich ins Bett gehe',
    dann: ['3 Dinge aufschreiben, fuer die ich dankbar bin', 'Handy weglegen', 'einen Moment innehalten'],
  },
  {
    wenn: 'Wenn ich gestresst bin',
    dann: ['3 tiefe Atemzuege nehmen', 'kurz aus dem Fenster schauen', 'Wasser trinken'],
  },
];

interface Goal {
  wenn: string;
  dann: string;
}

export default function GoalsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  
  // Goal mode: 'simple' or 'wenn-dann'
  const [goalMode, setGoalMode] = useState<'simple' | 'wenn-dann'>('simple');
  
  // For Wenn-Dann goals
  const [wennDannGoals, setWennDannGoals] = useState<Goal[]>([
    { wenn: '', dann: '' },
    { wenn: '', dann: '' },
    { wenn: '', dann: '' },
  ]);
  
  // For simple goals
  const [simpleGoals, setSimpleGoals] = useState<string[]>(['', '', '']);
  
  const [existingGoals, setExistingGoals] = useState<string[] | null>(null);
  const [advice, setAdvice] = useState('');
  const [showAdvice, setShowAdvice] = useState(false);
  const [showTheory, setShowTheory] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [currentGoalIndex, setCurrentGoalIndex] = useState(0);
  const [settings, setSettings] = useState<any>(null);

  const today = new Date();
  const isSunday = today.getDay() === 0;

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) return;

      const [goalsRes, settingsRes] = await Promise.all([
        axios.get(`${API_URL}/api/goals/${deviceId}`),
        axios.get(`${API_URL}/api/settings/${deviceId}`),
      ]);

      setSettings(settingsRes.data);

      if (goalsRes.data.goals) {
        setExistingGoals(goalsRes.data.goals);
        
        // Detect if existing goals are wenn-dann or simple
        const hasWennDann = goalsRes.data.goals.some((goal: string) => 
          goal.toLowerCase().includes('wenn ') && goal.toLowerCase().includes(', dann ')
        );
        
        if (hasWennDann) {
          setGoalMode('wenn-dann');
          const parsedGoals = goalsRes.data.goals.map((goal: string) => {
            const match = goal.match(/Wenn (.+), dann (.+)/i);
            if (match) {
              return { wenn: match[1], dann: match[2] };
            }
            return { wenn: '', dann: goal };
          });
          setWennDannGoals(parsedGoals);
        } else {
          setGoalMode('simple');
          setSimpleGoals(goalsRes.data.goals);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
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
      Alert.alert('Hinweis', 'Tipps konnten nicht geladen werden. Aber keine Sorge, du schaffst das auch so! 💪');
    } finally {
      setLoadingAdvice(false);
    }
  };

  const saveGoals = async () => {
    let formattedGoals: string[];
    
    if (goalMode === 'wenn-dann') {
      // Format wenn-dann goals
      formattedGoals = wennDannGoals.map((goal) => {
        if (goal.wenn && goal.dann) {
          return `Wenn ${goal.wenn}, dann ${goal.dann}`;
        }
        return goal.dann.trim();
      });
    } else {
      // Simple goals
      formattedGoals = simpleGoals.map(g => g.trim());
    }

    if (formattedGoals.some(g => g === '')) {
      Alert.alert(
        'Noch nicht fertig 💭',
        'Bitte fuelle alle 3 Gewohnheiten aus. Denk dran: Sie duerfen winzig klein sein!'
      );
      return;
    }

    setSaving(true);
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      await axios.post(`${API_URL}/api/goals`, {
        device_id: deviceId,
        goals: formattedGoals,
      });

      Alert.alert(
        'Wunderbar! 🌟',
        'Deine Wochenziele sind gespeichert. Du hast den ersten Schritt getan - das ist grossartig!',
        [{ text: 'Los geht\'s!', onPress: () => router.push('/') }]
      );
    } catch (error: any) {
      Alert.alert('Ohje!', error.response?.data?.detail || 'Speichern hat nicht geklappt. Versuch es nochmal!');
    } finally {
      setSaving(false);
    }
  };

  const updateWennDannGoal = (index: number, field: 'wenn' | 'dann', text: string) => {
    const newGoals = [...wennDannGoals];
    newGoals[index] = { ...newGoals[index], [field]: text };
    setWennDannGoals(newGoals);
  };

  const updateSimpleGoal = (index: number, text: string) => {
    const newGoals = [...simpleGoals];
    newGoals[index] = text;
    setSimpleGoals(newGoals);
  };

  const openSuggestions = (index: number) => {
    setCurrentGoalIndex(index);
    setShowSuggestions(true);
  };

  const applySuggestion = (wenn: string, dann: string) => {
    if (goalMode === 'wenn-dann') {
      updateWennDannGoal(currentGoalIndex, 'wenn', wenn);
      updateWennDannGoal(currentGoalIndex, 'dann', dann);
    } else {
      // For simple mode, just use the dann part
      updateSimpleGoal(currentGoalIndex, dann);
    }
    setShowSuggestions(false);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textLight }]}>Einen Moment...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.scrollView}>
          {/* Header with heart */}
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: colors.text }]}>Deine Wochenziele</Text>
              <Text style={styles.heartEmoji}>💜</Text>
            </View>
            <Text style={[styles.subtitle, { color: colors.textLight }]}>
              {isSunday 
                ? 'Perfekter Tag fuer einen Neuanfang!' 
                : 'Kleine Schritte fuehren zu grossen Veraenderungen'}
            </Text>
          </View>

          {/* Theorie-Banner */}
          <TouchableOpacity 
            style={[styles.theoryBanner, { backgroundColor: colors.accent + '40', borderColor: colors.accent }]} 
            onPress={() => setShowTheory(true)}
          >
            <View style={styles.theoryBannerContent}>
              <Ionicons name="school" size={24} color={colors.text} />
              <View style={styles.theoryBannerText}>
                <Text style={[styles.theoryBannerTitle, { color: colors.text }]}>
                  Die Wenn-Dann Methode
                </Text>
                <Text style={[styles.theoryBannerSubtitle, { color: colors.textLight }]}>
                  Wissenschaftlich bewaehrt • Tippe zum Lernen
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
            </View>
          </TouchableOpacity>

          {/* AI Advice Banner */}
          {isSunday && (
            <TouchableOpacity 
              style={[styles.adviceBanner, { backgroundColor: colors.secondary }]} 
              onPress={fetchAdvice}
              disabled={loadingAdvice}
            >
              <View style={styles.adviceBannerContent}>
                <Ionicons name="sparkles" size={24} color="#FFF" />
                <View style={styles.adviceBannerText}>
                  <Text style={styles.adviceBannerTitle}>Persoenliche Tipps vom Coach</Text>
                  <Text style={styles.adviceBannerSubtitle}>
                    {loadingAdvice ? 'Wird geladen...' : 'Tippe fuer Inspiration'}
                  </Text>
                </View>
                {loadingAdvice && <ActivityIndicator color="#FFF" />}
              </View>
            </TouchableOpacity>
          )}

          {/* Advice Card */}
          {showAdvice && (
            <View style={[styles.adviceCard, { backgroundColor: colors.card, borderColor: colors.secondary }]}>
              <View style={styles.adviceHeader}>
                <Ionicons name="chatbubble-ellipses" size={24} color={colors.secondary} />
                <Text style={[styles.adviceTitle, { color: colors.text }]}>Dein Coach sagt</Text>
                <TouchableOpacity onPress={() => setShowAdvice(false)}>
                  <Ionicons name="close-circle" size={24} color={colors.textLight} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.adviceText, { color: colors.text }]}>{advice}</Text>
            </View>
          )}

          {/* Goals Input Card */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Deine 3 winzigen Gewohnheiten
            </Text>
            <Text style={[styles.sectionHint, { color: colors.textLight }]}>
              Formuliere sie als "Wenn... dann..." Saetze - das verdreifacht deinen Erfolg! 🎯
            </Text>

            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.goalBlock}>
                <View style={styles.goalHeader}>
                  <View style={[
                    styles.goalNumber,
                    { backgroundColor: [colors.primary, colors.secondary, colors.accent][index] }
                  ]}>
                    <Text style={styles.goalNumberText}>{index + 1}</Text>
                  </View>
                  <TouchableOpacity 
                    style={[styles.suggestionButton, { backgroundColor: colors.background }]}
                    onPress={() => openSuggestions(index)}
                  >
                    <Ionicons name="bulb-outline" size={16} color={colors.primary} />
                    <Text style={[styles.suggestionButtonText, { color: colors.primary }]}>
                      Vorschlaege
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.wennDannContainer}>
                  <View style={styles.wennRow}>
                    <Text style={[styles.wennLabel, { color: colors.primary }]}>WENN</Text>
                    <TextInput
                      style={[styles.wennInput, { backgroundColor: colors.background, color: colors.text }]}
                      placeholder="z.B. ich morgens aufgestanden bin"
                      placeholderTextColor={colors.textLight}
                      value={goals[index].wenn}
                      onChangeText={(text) => updateGoal(index, 'wenn', text)}
                      maxLength={80}
                    />
                  </View>
                  <View style={styles.dannRow}>
                    <Text style={[styles.dannLabel, { color: colors.secondary }]}>DANN</Text>
                    <TextInput
                      style={[styles.dannInput, { backgroundColor: colors.background, color: colors.text }]}
                      placeholder="z.B. trinke ich ein Glas Wasser"
                      placeholderTextColor={colors.textLight}
                      value={goals[index].dann}
                      onChangeText={(text) => updateGoal(index, 'dann', text)}
                      maxLength={80}
                    />
                  </View>
                </View>

                {goals[index].wenn && goals[index].dann && (
                  <View style={[styles.previewBox, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.previewText, { color: colors.text }]}>
                      ✨ Wenn {goals[index].wenn}, dann {goals[index].dann}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Encouraging Tips */}
          <View style={[styles.tipsCard, { backgroundColor: colors.secondary + '20' }]}>
            <Text style={[styles.tipsTitle, { color: colors.text }]}>💡 Erinnerung mit Herz</Text>
            <View style={styles.tipItem}>
              <Text style={[styles.tipEmoji]}>🌱</Text>
              <Text style={[styles.tipText, { color: colors.text }]}>
                Winzig klein ist perfekt - unter 30 Sekunden!
              </Text>
            </View>
            <View style={styles.tipItem}>
              <Text style={[styles.tipEmoji]}>🔗</Text>
              <Text style={[styles.tipText, { color: colors.text }]}>
                Verknuepfe mit etwas, das du schon tust
              </Text>
            </View>
            <View style={styles.tipItem}>
              <Text style={[styles.tipEmoji]}>🎉</Text>
              <Text style={[styles.tipText, { color: colors.text }]}>
                Feiere jeden kleinen Erfolg - du verdienst es!
              </Text>
            </View>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.primary }, saving && styles.saveButtonDisabled]}
            onPress={saveGoals}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="heart" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>
                  {existingGoals ? 'Ziele aktualisieren' : 'Meine Reise beginnen'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Theory Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showTheory}
        onRequestClose={() => setShowTheory(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <ScrollView>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                📚 Die Wenn-Dann Methode
              </Text>
              <Text style={[styles.modalSubtitle, { color: colors.primary }]}>
                Nach Peter Gollwitzer - Wissenschaftlich bewaehrt
              </Text>

              <View style={[styles.theorySection, { backgroundColor: colors.background }]}>
                <Text style={[styles.theorySectionTitle, { color: colors.text }]}>
                  Was ist das?
                </Text>
                <Text style={[styles.theorySectionText, { color: colors.text }]}>
                  "Implementation Intentions" oder "Wenn-Dann Plaene" sind eine wissenschaftlich
                  erforschte Methode von Prof. Peter Gollwitzer. Sie helfen uns, Vorsaetze
                  tatsaechlich umzusetzen.
                </Text>
              </View>

              <View style={[styles.theorySection, { backgroundColor: colors.background }]}>
                <Text style={[styles.theorySectionTitle, { color: colors.text }]}>
                  Wie funktioniert es?
                </Text>
                <Text style={[styles.theorySectionText, { color: colors.text }]}>
                  Anstatt nur "Ich will mehr Wasser trinken" zu sagen, formulierst du:
                  {'\n\n'}
                  <Text style={{ fontWeight: 'bold', color: colors.primary }}>
                    "Wenn ich morgens aufstehe, dann trinke ich ein Glas Wasser"
                  </Text>
                  {'\n\n'}
                  Das Gehirn verknuepft so die Situation (Aufstehen) mit der Handlung
                  (Wasser trinken). Die Handlung wird automatischer!
                </Text>
              </View>

              <View style={[styles.theorySection, { backgroundColor: colors.secondary + '20' }]}>
                <Text style={[styles.theorySectionTitle, { color: colors.text }]}>
                  ✨ Die Formel
                </Text>
                <View style={styles.formulaBox}>
                  <Text style={[styles.formulaText, { color: colors.primary }]}>
                    WENN [Situation/Ausloeser]
                  </Text>
                  <Text style={[styles.formulaText, { color: colors.secondary }]}>
                    DANN [werde ich meine Gewohnheit ausfuehren]
                  </Text>
                </View>
              </View>

              <View style={[styles.theorySection, { backgroundColor: colors.background }]}>
                <Text style={[styles.theorySectionTitle, { color: colors.text }]}>
                  🔬 Die Wissenschaft dahinter
                </Text>
                <Text style={[styles.theorySectionText, { color: colors.text }]}>
                  Studien zeigen: Menschen mit Wenn-Dann Plaenen erreichen ihre Ziele
                  mit {' '}
                  <Text style={{ fontWeight: 'bold', color: colors.primary }}>
                    2-3x hoeherer Wahrscheinlichkeit
                  </Text>
                  {' '} als Menschen, die nur allgemeine Vorsaetze haben.
                </Text>
              </View>

              <View style={[styles.theorySection, { backgroundColor: colors.accent + '30' }]}>
                <Text style={[styles.theorySectionTitle, { color: colors.text }]}>
                  💜 Tipps fuer gute Wenn-Dann Saetze
                </Text>
                <Text style={[styles.theorySectionText, { color: colors.text }]}>
                  • Waehle einen spezifischen Ausloeser{'\n'}
                  • Die Handlung sollte winzig sein{'\n'}
                  • Verknuepfe mit bestehenden Routinen{'\n'}
                  • Sei konkret und positiv{'\n'}
                  • Formuliere es in deinen eigenen Worten
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalCloseButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowTheory(false)}
            >
              <Text style={styles.modalCloseText}>Verstanden! 👍</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Suggestions Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showSuggestions}
        onRequestClose={() => setShowSuggestions(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              💡 Vorschlaege fuer Gewohnheit {currentGoalIndex + 1}
            </Text>
            <Text style={[styles.modalSubtitle, { color: colors.textLight }]}>
              Tippe zum Uebernehmen oder lass dich inspirieren
            </Text>

            <ScrollView style={styles.suggestionsList}>
              {WENN_DANN_VORSCHLAEGE.map((item, index) => (
                <View key={index} style={[styles.suggestionGroup, { backgroundColor: colors.background }]}>
                  <Text style={[styles.suggestionWenn, { color: colors.primary }]}>
                    {item.wenn}...
                  </Text>
                  {item.dann.map((dann, dannIndex) => (
                    <TouchableOpacity
                      key={dannIndex}
                      style={[styles.suggestionDann, { borderColor: colors.secondary + '50' }]}
                      onPress={() => applySuggestion(item.wenn, dann)}
                    >
                      <Text style={[styles.suggestionDannText, { color: colors.text }]}>
                        → {dann}
                      </Text>
                      <Ionicons name="add-circle" size={20} color={colors.secondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalCloseButton, { backgroundColor: colors.textLight }]}
              onPress={() => setShowSuggestions(false)}
            >
              <Text style={styles.modalCloseText}>Schliessen</Text>
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
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  header: {
    padding: 20,
    paddingTop: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  heartEmoji: {
    fontSize: 28,
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  theoryBanner: {
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  theoryBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  theoryBannerText: {
    marginLeft: 12,
    flex: 1,
  },
  theoryBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  theoryBannerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  adviceBanner: {
    marginHorizontal: 20,
    marginBottom: 15,
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
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
  },
  adviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  adviceTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
    flex: 1,
  },
  adviceText: {
    fontSize: 14,
    lineHeight: 22,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  goalBlock: {
    marginBottom: 20,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  goalNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalNumberText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  suggestionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  suggestionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  wennDannContainer: {
    gap: 10,
  },
  wennRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wennLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    width: 45,
  },
  wennInput: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
  },
  dannRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dannLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    width: 45,
  },
  dannInput: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
  },
  previewBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  previewText: {
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  tipsCard: {
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 16,
    padding: 16,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipEmoji: {
    fontSize: 20,
    width: 30,
  },
  tipText: {
    fontSize: 14,
    flex: 1,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  theorySection: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 15,
  },
  theorySectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  theorySectionText: {
    fontSize: 14,
    lineHeight: 22,
  },
  formulaBox: {
    padding: 15,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  formulaText: {
    fontSize: 16,
    fontWeight: '600',
    marginVertical: 5,
  },
  suggestionsList: {
    maxHeight: 400,
  },
  suggestionGroup: {
    borderRadius: 16,
    padding: 15,
    marginBottom: 12,
  },
  suggestionWenn: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  suggestionDann: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  suggestionDannText: {
    fontSize: 14,
    flex: 1,
  },
  modalCloseButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  modalCloseText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
