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
import { useTranslation } from 'react-i18next';
import { COLOR_PALETTES } from '../contexts/SettingsContext';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Get localized suggestions based on current language
const getLocalizedSuggestions = (isEn: boolean) => {
  if (isEn) {
    return [
      { wenn: 'After waking up in the morning', dann: ['drink a glass of water', 'make my bed', 'take 3 deep breaths', 'stretch briefly'] },
      { wenn: 'After brushing my teeth', dann: ['do 2 squats', 'moisturize my face', 'smile in the mirror', 'say an affirmation'] },
      { wenn: 'Before having breakfast', dann: ['drink a glass of water', 'meditate briefly', 'review my daily goals'] },
      { wenn: 'When I sit down at my desk', dann: ['take 3 deep breaths', 'write down my most important task', 'prepare water'] },
      { wenn: 'After lunch', dann: ['go for a 5-minute walk', 'take 10 steps', 'stretch briefly'] },
      { wenn: 'When I come home', dann: ['put my shoes away neatly', 'take a deep breath', 'sit down briefly'] },
      { wenn: 'Before going to bed', dann: ['write down 3 things I am grateful for', 'put my phone away', 'pause for a moment'] },
      { wenn: 'When I feel stressed', dann: ['take 3 deep breaths', 'look out the window briefly', 'drink water'] },
    ];
  }
  
  // German (default)
  return [
    { wenn: 'Nachdem ich morgens aufgestanden bin', dann: ['ein Glas Wasser trinken', 'mein Bett machen', '3 tiefe Atemzuege nehmen', 'mich kurz strecken'] },
    { wenn: 'Nachdem ich mir die Zaehne geputzt habe', dann: ['2 Kniebeugen machen', 'mein Gesicht eincremen', 'im Spiegel laecheln', 'eine Affirmation sagen'] },
    { wenn: 'Bevor ich fruehstuecke', dann: ['ein Glas Wasser trinken', 'kurz meditieren', 'meine Tagesziele anschauen'] },
    { wenn: 'Wenn ich mich an den Schreibtisch setze', dann: ['3 tiefe Atemzuege nehmen', 'meine wichtigste Aufgabe notieren', 'Wasser bereitstellen'] },
    { wenn: 'Nachdem ich Mittag gegessen habe', dann: ['5 Minuten spazieren gehen', '10 Schritte gehen', 'mich kurz strecken'] },
    { wenn: 'Wenn ich nach Hause komme', dann: ['Schuhe ordentlich wegstellen', 'tief durchatmen', 'mich kurz hinsetzen'] },
    { wenn: 'Bevor ich ins Bett gehe', dann: ['3 Dinge aufschreiben, fuer die ich dankbar bin', 'Handy weglegen', 'einen Moment innehalten'] },
    { wenn: 'Wenn ich gestresst bin', dann: ['3 tiefe Atemzuege nehmen', 'kurz aus dem Fenster schauen', 'Wasser trinken'] },
  ];
};

interface Goal {
  wenn: string;
  dann: string;
}

export default function GoalsScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  
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
  const [showTheory, setShowTheory] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [currentGoalIndex, setCurrentGoalIndex] = useState(0);
  const [settings, setSettings] = useState<any>(null);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  useEffect(() => {
    loadGoals();
  }, []);

  const loadGoals = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      if (!deviceId) {
        setLoading(false);
        return;
      }

      const [goalsRes, settingsRes] = await Promise.all([
        axios.get(`${API_URL}/api/goals/${deviceId}`),
        axios.get(`${API_URL}/api/settings/${deviceId}`),
      ]);
      
      if (goalsRes.data.goals) {
        setExistingGoals(goalsRes.data.goals);
        
        // Check if goals are in wenn-dann format
        const goals = goalsRes.data.goals;
        const hasWennDann = goals.some((g: string) => g.toLowerCase().includes('wenn') && g.toLowerCase().includes('dann'));
        
        if (hasWennDann) {
          setGoalMode('wenn-dann');
          const parsedGoals = goals.map((g: string) => {
            const match = g.match(/^Wenn (.+), dann (.+)$/i);
            if (match) {
              return { wenn: match[1], dann: match[2] };
            }
            return { wenn: '', dann: g };
          });
          setWennDannGoals(parsedGoals);
        } else {
          setGoalMode('simple');
          setSimpleGoals(goals);
        }
      }
      
      setSettings(settingsRes.data);
    } catch (error) {
      console.error('Error loading goals:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveGoals = async () => {
    let formattedGoals: string[] = [];
    
    if (goalMode === 'wenn-dann') {
      formattedGoals = wennDannGoals.map((goal) => {
        if (goal.wenn && goal.dann) {
          return isEn ? `When ${goal.wenn}, then ${goal.dann}` : `Wenn ${goal.wenn}, dann ${goal.dann}`;
        }
        return goal.dann.trim();
      });
    } else {
      formattedGoals = simpleGoals.map(g => g.trim());
    }

    if (formattedGoals.some(g => g === '')) {
      Alert.alert(
        isEn ? 'Not finished yet 💭' : 'Noch nicht fertig 💭',
        isEn ? 'Please fill in all 3 habits. Remember: They can be tiny!' : 'Bitte fuelle alle 3 Gewohnheiten aus. Denk dran: Sie duerfen winzig klein sein!'
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
        isEn ? 'Wonderful! 🌟' : 'Wunderbar! 🌟',
        isEn ? 'Your weekly goals are saved. You took the first step - that is great!' : 'Deine Wochenziele sind gespeichert. Du hast den ersten Schritt getan - das ist grossartig!',
        [{ text: isEn ? "Let's go!" : "Los geht's!", onPress: () => router.push('/') }]
      );
    } catch (error: any) {
      Alert.alert(
        isEn ? 'Oops!' : 'Ohje!', 
        error.response?.data?.detail || (isEn ? 'Saving failed. Try again!' : 'Speichern hat nicht geklappt. Versuch es nochmal!')
      );
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
      updateSimpleGoal(currentGoalIndex, dann);
    }
    setShowSuggestions(false);
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
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View>
              <Text style={[styles.title, { color: colors.text }]}>
                {isEn ? 'Your Weekly Goals' : 'Deine Wochenziele'} 🎯
              </Text>
              <Text style={[styles.subtitle, { color: colors.textLight }]}>
                {isEn ? 'Focus on 3 tiny habits' : 'Konzentriere dich auf 3 winzige Gewohnheiten'}
              </Text>
            </View>
          </View>

          {/* Theory Banner */}
          <TouchableOpacity 
            style={[styles.theoryBanner, { backgroundColor: colors.accent + '40', borderColor: colors.accent }]} 
            onPress={() => setShowTheory(true)}
          >
            <View style={styles.theoryBannerContent}>
              <Ionicons name="school" size={24} color={colors.text} />
              <View style={styles.theoryBannerText}>
                <Text style={[styles.theoryBannerTitle, { color: colors.text }]}>
                  {isEn ? 'The If-Then Method' : 'Die Wenn-Dann Methode'}
                </Text>
                <Text style={[styles.theoryBannerSubtitle, { color: colors.textLight }]}>
                  {isEn ? 'Scientifically proven • Tap to learn' : 'Wissenschaftlich bewaehrt • Tippe zum Lernen'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
            </View>
          </TouchableOpacity>

          {/* Why only 3 habits */}
          <View style={[styles.whyThreeBox, { backgroundColor: colors.card }]}>
            <View style={styles.whyThreeHeader}>
              <Text style={styles.brainEmoji}>🧠</Text>
              <Text style={[styles.whyThreeTitle, { color: colors.text }]}>
                {isEn ? 'Why only 3 habits?' : 'Warum nur 3 Gewohnheiten?'}
              </Text>
            </View>
            <Text style={[styles.whyThreeText, { color: colors.textLight }]}>
              {isEn 
                ? 'Research shows: Less is more! Our brain can only process a limited number of new behaviors at once. With 1-3 habits you have the best chance of real, lasting success. Quality over quantity! 💪'
                : 'Forschung zeigt: Weniger ist mehr! Unser Gehirn kann nur begrenzt neue Verhaltensweisen gleichzeitig verarbeiten. Mit 1-3 Gewohnheiten hast du die beste Chance auf echten, nachhaltigen Erfolg. Qualitaet vor Quantitaet! 💪'}
            </Text>
          </View>

          {/* Goals Input Card */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {isEn ? 'Your 3 tiny habits' : 'Deine 3 winzigen Gewohnheiten'}
            </Text>
            
            {/* Mode Selector */}
            <View style={styles.modeSelector}>
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  goalMode === 'simple' && { backgroundColor: colors.primary },
                  goalMode !== 'simple' && { backgroundColor: colors.background }
                ]}
                onPress={() => setGoalMode('simple')}
              >
                <Ionicons 
                  name="checkmark-circle-outline" 
                  size={18} 
                  color={goalMode === 'simple' ? '#FFF' : colors.textLight} 
                />
                <Text style={[
                  styles.modeButtonText,
                  { color: goalMode === 'simple' ? '#FFF' : colors.textLight }
                ]}>
                  {isEn ? 'Simple' : 'Einfach'}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.modeButton,
                  goalMode === 'wenn-dann' && { backgroundColor: colors.secondary },
                  goalMode !== 'wenn-dann' && { backgroundColor: colors.background }
                ]}
                onPress={() => setGoalMode('wenn-dann')}
              >
                <Ionicons 
                  name="git-branch-outline" 
                  size={18} 
                  color={goalMode === 'wenn-dann' ? '#FFF' : colors.textLight} 
                />
                <Text style={[
                  styles.modeButtonText,
                  { color: goalMode === 'wenn-dann' ? '#FFF' : colors.textLight }
                ]}>
                  {isEn ? 'If-Then' : 'Wenn-Dann'}
                </Text>
              </TouchableOpacity>
            </View>
            
            <Text style={[styles.sectionHint, { color: colors.textLight }]}>
              {goalMode === 'wenn-dann' 
                ? (isEn ? 'Link your habit to a trigger - this triples success! 🎯' : 'Verknuepfe deine Gewohnheit mit einem Ausloeser - das verdreifacht den Erfolg! 🎯')
                : (isEn ? 'Simply describe what you want to do - short and sweet! 🎯' : 'Beschreibe einfach, was du tun moechtest - kurz und knapp! 🎯')
              }
            </Text>

            {/* Goal Inputs */}
            {[0, 1, 2].map((index) => (
              <View key={index} style={styles.goalInputContainer}>
                <View style={[styles.goalNumber, { backgroundColor: [colors.primary, colors.secondary, colors.accent][index] }]}>
                  <Text style={styles.goalNumberText}>{index + 1}</Text>
                </View>
                
                {goalMode === 'wenn-dann' ? (
                  <View style={styles.wennDannContainer}>
                    <View style={styles.wennRow}>
                      <Text style={[styles.wennLabel, { color: colors.textLight }]}>
                        {isEn ? 'When' : 'Wenn'}
                      </Text>
                      <TextInput
                        style={[styles.wennInput, { backgroundColor: colors.background, color: colors.text }]}
                        value={wennDannGoals[index].wenn}
                        onChangeText={(text) => updateWennDannGoal(index, 'wenn', text)}
                        placeholder={isEn ? 'e.g. I wake up in the morning' : 'z.B. ich morgens aufgestanden bin'}
                        placeholderTextColor={colors.textLight}
                      />
                    </View>
                    <View style={styles.dannRow}>
                      <Text style={[styles.dannLabel, { color: colors.textLight }]}>
                        {isEn ? 'Then' : 'Dann'}
                      </Text>
                      <TextInput
                        style={[styles.dannInput, { backgroundColor: colors.background, color: colors.text }]}
                        value={wennDannGoals[index].dann}
                        onChangeText={(text) => updateWennDannGoal(index, 'dann', text)}
                        placeholder={isEn ? 'e.g. drink a glass of water' : 'z.B. trinke ich ein Glas Wasser'}
                        placeholderTextColor={colors.textLight}
                      />
                    </View>
                    <TouchableOpacity 
                      style={[styles.ideasButton, { backgroundColor: colors.primary + '15' }]}
                      onPress={() => openSuggestions(index)}
                    >
                      <Ionicons name="bulb-outline" size={16} color={colors.primary} />
                      <Text style={[styles.ideasButtonText, { color: colors.primary }]}>
                        {isEn ? 'Ideas' : 'Ideen'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.simpleContainer}>
                    <TextInput
                      style={[styles.simpleInput, { backgroundColor: colors.background, color: colors.text }]}
                      value={simpleGoals[index]}
                      onChangeText={(text) => updateSimpleGoal(index, text)}
                      placeholder={isEn ? `Habit ${index + 1}...` : `Gewohnheit ${index + 1}...`}
                      placeholderTextColor={colors.textLight}
                    />
                    <TouchableOpacity 
                      style={[styles.ideasButtonSmall, { backgroundColor: colors.primary + '15' }]}
                      onPress={() => openSuggestions(index)}
                    >
                      <Ionicons name="bulb-outline" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Reminder with Heart */}
          <View style={[styles.tipsBox, { backgroundColor: colors.pink + '20', borderColor: colors.pink }]}>
            <Text style={[styles.tipsTitle, { color: colors.text }]}>
              {isEn ? '💡 Reminder with Heart' : '💡 Erinnerung mit Herz'}
            </Text>
            <Text style={[styles.tipsText, { color: colors.textLight }]}>
              {isEn 
                ? '• Make your habits SO tiny that you cannot fail\n• 1 pushup is better than 0\n• Be kind to yourself! 💜'
                : '• Mach deine Gewohnheiten SO winzig, dass du nicht scheitern kannst\n• 1 Liegestuetze ist besser als 0\n• Sei liebevoll zu dir selbst! 💜'}
            </Text>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.primary }]}
            onPress={saveGoals}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="heart" size={24} color="#FFF" />
                <Text style={styles.saveButtonText}>
                  {existingGoals 
                    ? (isEn ? 'Update Goals' : 'Ziele aktualisieren') 
                    : (isEn ? 'Start My Journey' : 'Meine Reise beginnen')}
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
          <View style={[styles.theoryModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.theoryModalTitle, { color: colors.text }]}>
                {isEn ? '📚 The If-Then Method' : '📚 Die Wenn-Dann Methode'}
              </Text>
              
              <Text style={[styles.theoryParagraph, { color: colors.text }]}>
                {isEn 
                  ? '"If-Then Plans" (Implementation Intentions) are a scientifically researched method by Prof. Peter Gollwitzer. They help us turn resolutions into automatic behaviors.'
                  : '"Wenn-Dann Plaene" (Implementation Intentions) sind eine wissenschaftlich erforschte Methode von Prof. Peter Gollwitzer. Sie helfen uns, Vorsaetze in automatische Verhaltensweisen zu verwandeln.'}
              </Text>
              
              <View style={[styles.exampleBox, { backgroundColor: colors.primary + '15' }]}>
                <Text style={[styles.exampleLabel, { color: colors.primary }]}>
                  {isEn ? 'Example:' : 'Beispiel:'}
                </Text>
                <Text style={[styles.exampleText, { color: colors.text }]}>
                  {isEn 
                    ? '"When I wake up in the morning, then I drink a glass of water"'
                    : '"Wenn ich morgens aufstehe, dann trinke ich ein Glas Wasser"'}
                </Text>
              </View>
              
              <Text style={[styles.theorySubtitle, { color: colors.text }]}>
                {isEn ? 'The Formula:' : 'Die Formel:'}
              </Text>
              <View style={[styles.formulaBox, { backgroundColor: colors.secondary + '15' }]}>
                <Text style={[styles.formulaText, { color: colors.secondary }]}>
                  {isEn ? 'WHEN [situation/trigger]' : 'WENN [Situation/Ausloeser]'}
                </Text>
                <Text style={[styles.formulaText, { color: colors.secondary }]}>
                  {isEn ? 'THEN [I will do my habit]' : 'DANN [werde ich meine Gewohnheit ausfuehren]'}
                </Text>
              </View>
              
              <Text style={[styles.theorySubtitle, { color: colors.text }]}>
                {isEn ? 'Why does it work?' : 'Warum funktioniert es?'}
              </Text>
              <Text style={[styles.theoryParagraph, { color: colors.text }]}>
                {isEn
                  ? 'Studies show: People with If-Then plans achieve their goals'
                  : 'Studien zeigen: Menschen mit Wenn-Dann Plaenen erreichen ihre Ziele'}
                <Text style={[styles.highlight, { color: colors.primary }]}>
                  {isEn ? ' 2-3x more often ' : ' 2-3x haeufiger '}
                </Text>
                {isEn
                  ? 'than people who only have general resolutions.'
                  : 'als Menschen, die nur allgemeine Vorsaetze haben.'}
              </Text>
              
              <Text style={[styles.theorySubtitle, { color: colors.text }]}>
                {isEn ? 'Tips for your habits:' : 'Tipps fuer deine Gewohnheiten:'}
              </Text>
              <Text style={[styles.tipsList, { color: colors.textLight }]}>
                {isEn
                  ? '• Choose a specific trigger (time, place, action)\n• Keep the habit tiny\n• Formulate it in your own words\n• Link it to existing routines'
                  : '• Waehle einen konkreten Ausloeser (Zeit, Ort, Handlung)\n• Halte die Gewohnheit winzig klein\n• Formuliere es in deinen eigenen Worten\n• Verknuepfe es mit bestehenden Routinen'}
              </Text>
            </ScrollView>
            
            <TouchableOpacity
              style={[styles.modalCloseButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowTheory(false)}
            >
              <Text style={styles.modalCloseText}>
                {isEn ? 'Got it! 👍' : 'Verstanden! 👍'}
              </Text>
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
          <View style={[styles.suggestionsModalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.suggestionsTitle, { color: colors.text }]}>
              {isEn ? '💡 Ideas for habit' : '💡 Vorschlaege fuer Gewohnheit'} {currentGoalIndex + 1}
            </Text>
            <Text style={[styles.suggestionsSubtitle, { color: colors.textLight }]}>
              {isEn ? 'Tap to apply or get inspired' : 'Tippe zum Uebernehmen oder lass dich inspirieren'}
            </Text>
            
            <ScrollView style={styles.suggestionsList}>
              {getLocalizedSuggestions(isEn).map((item, index) => (
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
              <Text style={styles.modalCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 10 },
  backButton: { marginRight: 15 },
  title: { fontSize: 24, fontWeight: 'bold' },
  subtitle: { fontSize: 14, marginTop: 2 },
  theoryBanner: { marginHorizontal: 20, marginBottom: 15, borderRadius: 16, padding: 16, borderWidth: 1 },
  theoryBannerContent: { flexDirection: 'row', alignItems: 'center' },
  theoryBannerText: { flex: 1, marginLeft: 12 },
  theoryBannerTitle: { fontSize: 16, fontWeight: '700' },
  theoryBannerSubtitle: { fontSize: 12, marginTop: 2 },
  whyThreeBox: { marginHorizontal: 20, marginBottom: 15, borderRadius: 16, padding: 16 },
  whyThreeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  brainEmoji: { fontSize: 24, marginRight: 10 },
  whyThreeTitle: { fontSize: 16, fontWeight: '700' },
  whyThreeText: { fontSize: 14, lineHeight: 20 },
  card: { marginHorizontal: 20, marginBottom: 15, borderRadius: 20, padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  sectionHint: { fontSize: 13, marginBottom: 16 },
  modeSelector: { flexDirection: 'row', marginBottom: 16, gap: 10 },
  modeButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, gap: 6 },
  modeButtonText: { fontSize: 14, fontWeight: '600' },
  goalInputContainer: { flexDirection: 'row', marginBottom: 16 },
  goalNumber: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 4 },
  goalNumberText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  wennDannContainer: { flex: 1 },
  wennRow: { marginBottom: 8 },
  wennLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  wennInput: { borderRadius: 10, padding: 12, fontSize: 14 },
  dannRow: { marginBottom: 8 },
  dannLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  dannInput: { borderRadius: 10, padding: 12, fontSize: 14 },
  simpleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  simpleInput: { flex: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  ideasButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 4 },
  ideasButtonText: { fontSize: 12, fontWeight: '600' },
  ideasButtonSmall: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  tipsBox: { marginHorizontal: 20, marginBottom: 15, borderRadius: 16, padding: 16, borderWidth: 1 },
  tipsTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  tipsText: { fontSize: 14, lineHeight: 22 },
  saveButton: { marginHorizontal: 20, padding: 18, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  saveButtonText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  bottomSpacer: { height: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  theoryModalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  theoryModalTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  theoryParagraph: { fontSize: 15, lineHeight: 24, marginBottom: 16 },
  theorySubtitle: { fontSize: 17, fontWeight: '700', marginBottom: 10, marginTop: 8 },
  exampleBox: { padding: 16, borderRadius: 12, marginBottom: 16 },
  exampleLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  exampleText: { fontSize: 16, fontStyle: 'italic', lineHeight: 24 },
  formulaBox: { padding: 16, borderRadius: 12, marginBottom: 16 },
  formulaText: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  highlight: { fontWeight: 'bold' },
  tipsList: { fontSize: 14, lineHeight: 24 },
  modalCloseButton: { padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  modalCloseText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  suggestionsModalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  suggestionsTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  suggestionsSubtitle: { fontSize: 14, marginBottom: 16 },
  suggestionsList: { maxHeight: 400 },
  suggestionGroup: { borderRadius: 12, padding: 12, marginBottom: 12 },
  suggestionWenn: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  suggestionDann: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 6 },
  suggestionDannText: { flex: 1, fontSize: 14 },
  pink: '#F472B6',
});
