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

interface Goal {
  wenn: string;
  dann: string;
}

export default function GoalsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [goalMode, setGoalMode] = useState<'simple' | 'wenn-dann'>('simple');
  const [wennDannGoals, setWennDannGoals] = useState<Goal[]>([
    { wenn: '', dann: '' },
    { wenn: '', dann: '' },
    { wenn: '', dann: '' },
  ]);
  const [simpleGoals, setSimpleGoals] = useState<string[]>(['', '', '']);
  const [existingGoals, setExistingGoals] = useState<string[] | null>(null);
  const [showTheory, setShowTheory] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [currentGoalIndex, setCurrentGoalIndex] = useState(0);
  const [settings, setSettings] = useState<any>(null);

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  // Localized suggestions using t()
  const getSuggestions = () => [
    { wenn: t('suggestions.after_waking'), dann: [t('suggestions.drink_water'), t('suggestions.make_bed'), t('suggestions.deep_breaths'), t('suggestions.stretch')] },
    { wenn: t('suggestions.after_brushing'), dann: [t('suggestions.squats'), t('suggestions.moisturize'), t('suggestions.smile_mirror'), t('suggestions.affirmation')] },
    { wenn: t('suggestions.before_breakfast'), dann: [t('suggestions.drink_water'), t('suggestions.meditate'), t('suggestions.review_goals')] },
    { wenn: t('suggestions.at_desk'), dann: [t('suggestions.deep_breaths'), t('suggestions.write_task'), t('suggestions.prepare_water')] },
    { wenn: t('suggestions.after_lunch'), dann: [t('suggestions.walk_5min'), t('suggestions.take_steps'), t('suggestions.stretch')] },
    { wenn: t('suggestions.coming_home'), dann: [t('suggestions.put_shoes'), t('suggestions.deep_breaths'), t('suggestions.sit_down')] },
    { wenn: t('suggestions.before_bed'), dann: [t('suggestions.gratitude'), t('suggestions.phone_away'), t('suggestions.pause')] },
    { wenn: t('suggestions.when_stressed'), dann: [t('suggestions.deep_breaths'), t('suggestions.look_window'), t('suggestions.drink_water')] },
  ];

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
        const goals = goalsRes.data.goals;
        const hasWennDann = goals.some((g: string) => 
          (g.toLowerCase().includes('wenn') && g.toLowerCase().includes('dann')) ||
          (g.toLowerCase().includes('when') && g.toLowerCase().includes('then'))
        );
        
        if (hasWennDann) {
          setGoalMode('wenn-dann');
          const parsedGoals = goals.map((g: string) => {
            const matchDe = g.match(/^Wenn (.+), dann (.+)$/i);
            const matchEn = g.match(/^When (.+), then (.+)$/i);
            if (matchDe) return { wenn: matchDe[1], dann: matchDe[2] };
            if (matchEn) return { wenn: matchEn[1], dann: matchEn[2] };
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
          return `${t('goals.when')} ${goal.wenn}, ${t('goals.then').toLowerCase()} ${goal.dann}`;
        }
        return goal.dann.trim();
      });
    } else {
      formattedGoals = simpleGoals.map(g => g.trim());
    }

    if (formattedGoals.some(g => g === '')) {
      Alert.alert(t('goals.not_finished_title'), t('goals.not_finished_message'));
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
        t('goals.saved_title'),
        t('goals.saved_message'),
        [{ text: t('common.letsgo'), onPress: () => router.push('/') }]
      );
    } catch (error: any) {
      Alert.alert(t('common.error'), error.response?.data?.detail || t('errors.save_failed'));
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={styles.scrollView}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View>
              <Text style={[styles.title, { color: colors.text }]}>{t('goals.title')} 🎯</Text>
              <Text style={[styles.subtitle, { color: colors.textLight }]}>{t('goals.subtitle')}</Text>
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
                <Text style={[styles.theoryBannerTitle, { color: colors.text }]}>{t('goals.theory_title')}</Text>
                <Text style={[styles.theoryBannerSubtitle, { color: colors.textLight }]}>{t('goals.theory_subtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
            </View>
          </TouchableOpacity>

          {/* Why 3 habits */}
          <View style={[styles.whyThreeBox, { backgroundColor: colors.card }]}>
            <View style={styles.whyThreeHeader}>
              <Text style={styles.brainEmoji}>🧠</Text>
              <Text style={[styles.whyThreeTitle, { color: colors.text }]}>{t('goals.why_three_title')}</Text>
            </View>
            <Text style={[styles.whyThreeText, { color: colors.textLight }]}>{t('goals.why_three_text')} 💪</Text>
          </View>

          {/* Goals Card */}
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('goals.your_three_habits')}</Text>
            
            {/* Mode Selector */}
            <View style={styles.modeSelector}>
              <TouchableOpacity
                style={[styles.modeButton, goalMode === 'simple' && { backgroundColor: colors.primary }, goalMode !== 'simple' && { backgroundColor: colors.background }]}
                onPress={() => setGoalMode('simple')}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={goalMode === 'simple' ? '#FFF' : colors.textLight} />
                <Text style={[styles.modeButtonText, { color: goalMode === 'simple' ? '#FFF' : colors.textLight }]}>{t('goals.mode_simple')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modeButton, goalMode === 'wenn-dann' && { backgroundColor: colors.secondary }, goalMode !== 'wenn-dann' && { backgroundColor: colors.background }]}
                onPress={() => setGoalMode('wenn-dann')}
              >
                <Ionicons name="git-branch-outline" size={18} color={goalMode === 'wenn-dann' ? '#FFF' : colors.textLight} />
                <Text style={[styles.modeButtonText, { color: goalMode === 'wenn-dann' ? '#FFF' : colors.textLight }]}>{t('goals.mode_wenn_dann')}</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={[styles.sectionHint, { color: colors.textLight }]}>
              {goalMode === 'wenn-dann' ? t('goals.hint_wenn_dann') : t('goals.hint_simple')} 🎯
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
                      <Text style={[styles.wennLabel, { color: colors.textLight }]}>{t('goals.when')}</Text>
                      <TextInput
                        style={[styles.wennInput, { backgroundColor: colors.background, color: colors.text }]}
                        value={wennDannGoals[index].wenn}
                        onChangeText={(text) => updateWennDannGoal(index, 'wenn', text)}
                        placeholder={t('goals.when_placeholder')}
                        placeholderTextColor={colors.textLight}
                      />
                    </View>
                    <View style={styles.dannRow}>
                      <Text style={[styles.dannLabel, { color: colors.textLight }]}>{t('goals.then')}</Text>
                      <TextInput
                        style={[styles.dannInput, { backgroundColor: colors.background, color: colors.text }]}
                        value={wennDannGoals[index].dann}
                        onChangeText={(text) => updateWennDannGoal(index, 'dann', text)}
                        placeholder={t('goals.then_placeholder')}
                        placeholderTextColor={colors.textLight}
                      />
                    </View>
                    <TouchableOpacity style={[styles.ideasButton, { backgroundColor: colors.primary + '15' }]} onPress={() => openSuggestions(index)}>
                      <Ionicons name="bulb-outline" size={16} color={colors.primary} />
                      <Text style={[styles.ideasButtonText, { color: colors.primary }]}>{t('goals.ideas')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.simpleContainer}>
                    <TextInput
                      style={[styles.simpleInput, { backgroundColor: colors.background, color: colors.text }]}
                      value={simpleGoals[index]}
                      onChangeText={(text) => updateSimpleGoal(index, text)}
                      placeholder={`${t('goals.habit_placeholder')} ${index + 1}...`}
                      placeholderTextColor={colors.textLight}
                    />
                    <TouchableOpacity style={[styles.ideasButtonSmall, { backgroundColor: colors.primary + '15' }]} onPress={() => openSuggestions(index)}>
                      <Ionicons name="bulb-outline" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>

          {/* Reminder Box */}
          <View style={[styles.tipsBox, { backgroundColor: '#F472B620', borderColor: '#F472B6' }]}>
            <Text style={[styles.tipsTitle, { color: colors.text }]}>💡 {t('goals.reminder_title')}</Text>
            <Text style={[styles.tipsText, { color: colors.textLight }]}>{t('goals.reminder_text')} 💜</Text>
          </View>

          {/* Save Button */}
          <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={saveGoals} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="heart" size={24} color="#FFF" />
                <Text style={styles.saveButtonText}>{existingGoals ? t('goals.update_goals') : t('goals.start_journey')}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Theory Modal */}
      <Modal transparent animationType="slide" visible={showTheory} onRequestClose={() => setShowTheory(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.theoryModalContent, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.theoryModalTitle, { color: colors.text }]}>📚 {t('goals.theory_title')}</Text>
              <Text style={[styles.theoryParagraph, { color: colors.text }]}>{t('goals.theory_intro')}</Text>
              
              <View style={[styles.exampleBox, { backgroundColor: colors.primary + '15' }]}>
                <Text style={[styles.exampleLabel, { color: colors.primary }]}>{t('goals.theory_example_label')}</Text>
                <Text style={[styles.exampleText, { color: colors.text }]}>{t('goals.theory_example')}</Text>
              </View>
              
              <Text style={[styles.theorySubtitle, { color: colors.text }]}>{t('goals.theory_formula_title')}</Text>
              <View style={[styles.formulaBox, { backgroundColor: colors.secondary + '15' }]}>
                <Text style={[styles.formulaText, { color: colors.secondary }]}>{t('goals.theory_formula_when')}</Text>
                <Text style={[styles.formulaText, { color: colors.secondary }]}>{t('goals.theory_formula_then')}</Text>
              </View>
              
              <Text style={[styles.theorySubtitle, { color: colors.text }]}>{t('goals.theory_why_title')}</Text>
              <Text style={[styles.theoryParagraph, { color: colors.text }]}>
                {t('goals.theory_why_text')}
                <Text style={[styles.highlight, { color: colors.primary }]}>{t('goals.theory_why_highlight')}</Text>
                {t('goals.theory_why_text2')}
              </Text>
              
              <Text style={[styles.theorySubtitle, { color: colors.text }]}>{t('goals.theory_tips_title')}</Text>
              <Text style={[styles.tipsList, { color: colors.textLight }]}>{t('goals.theory_tips')}</Text>
            </ScrollView>
            
            <TouchableOpacity style={[styles.modalCloseButton, { backgroundColor: colors.primary }]} onPress={() => setShowTheory(false)}>
              <Text style={styles.modalCloseText}>{t('goals.got_it')} 👍</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Suggestions Modal */}
      <Modal transparent animationType="slide" visible={showSuggestions} onRequestClose={() => setShowSuggestions(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.suggestionsModalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.suggestionsTitle, { color: colors.text }]}>💡 {t('goals.ideas_title')} {currentGoalIndex + 1}</Text>
            <Text style={[styles.suggestionsSubtitle, { color: colors.textLight }]}>{t('goals.ideas_subtitle')}</Text>
            
            <ScrollView style={styles.suggestionsList}>
              {getSuggestions().map((item, index) => (
                <View key={index} style={[styles.suggestionGroup, { backgroundColor: colors.background }]}>
                  <Text style={[styles.suggestionWenn, { color: colors.primary }]}>{item.wenn}...</Text>
                  {item.dann.map((dann, dannIndex) => (
                    <TouchableOpacity
                      key={dannIndex}
                      style={[styles.suggestionDann, { borderColor: colors.secondary + '50' }]}
                      onPress={() => applySuggestion(item.wenn, dann)}
                    >
                      <Text style={[styles.suggestionDannText, { color: colors.text }]}>→ {dann}</Text>
                      <Ionicons name="add-circle" size={20} color={colors.secondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            
            <TouchableOpacity style={[styles.modalCloseButton, { backgroundColor: colors.textLight }]} onPress={() => setShowSuggestions(false)}>
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
});
