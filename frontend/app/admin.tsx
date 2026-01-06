import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { COLOR_PALETTES } from '../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function AdminScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const colors = COLOR_PALETTES.sonnenuntergang;

  const DURATION_OPTIONS = [
    { value: 7, label: isEn ? '1 Week' : '1 Woche' },
    { value: 30, label: isEn ? '1 Month' : '1 Monat' },
    { value: 90, label: isEn ? '3 Months' : '3 Monate' },
    { value: 180, label: isEn ? '6 Months' : '6 Monate' },
    { value: 365, label: isEn ? '1 Year' : '1 Jahr' },
  ];
  
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [promoCodes, setPromoCodes] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const [newCode, setNewCode] = useState('');
  const [newDuration, setNewDuration] = useState(30);
  const [newDescription, setNewDescription] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!authenticated) return;
    
    try {
      const encodedPassword = encodeURIComponent(password);
      const [codesRes, subsRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/promo-codes?admin_password=${encodedPassword}`),
        axios.get(`${API_URL}/api/admin/subscriptions?admin_password=${encodedPassword}`),
      ]);
      
      setPromoCodes(codesRes.data.codes || []);
      setSubscriptions(subsRes.data.subscriptions || []);
    } catch (error) {
      console.error('Error fetching admin data:', error);
      Alert.alert(t('common.error'), isEn ? 'Data could not be loaded.' : 'Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authenticated, password, isEn]);

  useEffect(() => {
    if (authenticated) {
      setLoading(true);
      fetchData();
    }
  }, [authenticated, fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const handleLogin = async () => {
    if (!password.trim()) {
      Alert.alert(isEn ? 'Note' : 'Hinweis', isEn ? 'Please enter password.' : 'Bitte Passwort eingeben.');
      return;
    }
    
    setLoading(true);
    try {
      const encodedPassword = encodeURIComponent(password);
      await axios.get(`${API_URL}/api/admin/promo-codes?admin_password=${encodedPassword}`);
      setAuthenticated(true);
    } catch (error: any) {
      if (error.response?.status === 403) {
        Alert.alert(t('common.error'), isEn ? 'Wrong password.' : 'Falsches Passwort.');
      } else {
        Alert.alert(t('common.error'), isEn ? 'Connection error.' : 'Verbindungsfehler.');
      }
      setLoading(false);
    }
  };

  const createPromoCode = async () => {
    if (!newCode.trim()) {
      Alert.alert(isEn ? 'Note' : 'Hinweis', isEn ? 'Please enter a code.' : 'Bitte Code eingeben.');
      return;
    }

    setCreating(true);
    try {
      await axios.post(`${API_URL}/api/admin/promo-codes`, {
        admin_password: password,
        code: newCode.trim().toUpperCase(),
        duration_days: newDuration,
        description: newDescription.trim() || null,
        max_uses: newMaxUses ? parseInt(newMaxUses) : null,
      });

      Alert.alert(isEn ? 'Success!' : 'Erfolg!', isEn ? `Code "${newCode.toUpperCase()}" created.` : `Code "${newCode.toUpperCase()}" erstellt.`);
      setShowCreateModal(false);
      setNewCode('');
      setNewDescription('');
      setNewMaxUses('');
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || (isEn ? 'Code could not be created.' : 'Code konnte nicht erstellt werden.');
      Alert.alert(t('common.error'), message);
    } finally {
      setCreating(false);
    }
  };

  const deletePromoCode = async (code: string) => {
    Alert.alert(
      isEn ? 'Delete code?' : 'Code löschen?',
      isEn ? `Do you really want to delete "${code}"?` : `Möchtest du "${code}" wirklich löschen?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: isEn ? 'Delete' : 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await axios.delete(`${API_URL}/api/admin/promo-codes/${code}?admin_password=${password}`);
              fetchData();
            } catch (error) {
              Alert.alert(t('common.error'), isEn ? 'Code could not be deleted.' : 'Code konnte nicht gelöscht werden.');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString(isEn ? 'en-US' : 'de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  if (!authenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loginContainer}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButtonLogin}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          
          <Ionicons name="shield-checkmark" size={64} color={colors.primary} />
          <Text style={[styles.loginTitle, { color: colors.text }]}>
            {isEn ? 'Admin Area' : 'Admin-Bereich'}
          </Text>
          <Text style={[styles.loginSubtitle, { color: colors.textLight }]}>
            {isEn ? 'Please enter the admin password' : 'Bitte Admin-Passwort eingeben'}
          </Text>
          
          <TextInput
            style={[styles.passwordInput, { backgroundColor: colors.card, color: colors.text }]}
            value={password}
            onChangeText={setPassword}
            placeholder={isEn ? 'Password' : 'Passwort'}
            placeholderTextColor={colors.textLight}
            secureTextEntry
            autoCapitalize="none"
          />
          
          <TouchableOpacity
            style={[styles.loginButton, { backgroundColor: colors.primary }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.loginButtonText}>{isEn ? 'Login' : 'Anmelden'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{isEn ? 'Admin' : 'Admin'}</Text>
          <TouchableOpacity onPress={() => setAuthenticated(false)}>
            <Ionicons name="log-out-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.secondary + '20' }]}>
            <Ionicons name="pricetag" size={28} color={colors.secondary} />
            <Text style={[styles.statNumber, { color: colors.text }]}>{promoCodes.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textLight }]}>
              {isEn ? 'Codes' : 'Codes'}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="star" size={28} color={colors.primary} />
            <Text style={[styles.statNumber, { color: colors.text }]}>{subscriptions.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textLight }]}>
              {isEn ? 'Premium' : 'Premium'}
            </Text>
          </View>
        </View>

        {/* Create Code Button */}
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: colors.secondary }]}
          onPress={() => setShowCreateModal(true)}
        >
          <Ionicons name="add-circle" size={24} color="#FFF" />
          <Text style={styles.createButtonText}>
            {isEn ? 'Create new code' : 'Neuen Code erstellen'}
          </Text>
        </TouchableOpacity>

        {/* Promo Codes List */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {isEn ? 'Promo Codes' : 'Promo-Codes'}
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : promoCodes.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textLight }]}>
            {isEn ? 'No codes yet' : 'Noch keine Codes vorhanden'}
          </Text>
        ) : (
          promoCodes.map((code, index) => (
            <View key={index} style={[styles.codeCard, { backgroundColor: colors.card }]}>
              <View style={styles.codeHeader}>
                <Text style={[styles.codeText, { color: colors.primary }]}>{code.code}</Text>
                <TouchableOpacity onPress={() => deletePromoCode(code.code)}>
                  <Ionicons name="trash-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
              </View>
              <View style={styles.codeDetails}>
                <View style={styles.codeDetailRow}>
                  <Text style={[styles.codeLabel, { color: colors.textLight }]}>
                    {isEn ? 'Duration' : 'Dauer'}
                  </Text>
                  <Text style={[styles.codeValue, { color: colors.text }]}>
                    {code.duration_days} {isEn ? 'days' : 'Tage'}
                  </Text>
                </View>
                <View style={styles.codeDetailRow}>
                  <Text style={[styles.codeLabel, { color: colors.textLight }]}>
                    {isEn ? 'Uses' : 'Nutzungen'}
                  </Text>
                  <Text style={[styles.codeValue, { color: colors.text }]}>
                    {code.uses || 0}/{code.max_uses || '∞'}
                  </Text>
                </View>
                <View style={styles.codeDetailRow}>
                  <Text style={[styles.codeLabel, { color: colors.textLight }]}>
                    {isEn ? 'Created' : 'Erstellt'}
                  </Text>
                  <Text style={[styles.codeValue, { color: colors.text }]}>
                    {formatDate(code.created_at)}
                  </Text>
                </View>
                {code.description && (
                  <Text style={[styles.codeDescription, { color: colors.textLight }]}>
                    {code.description}
                  </Text>
                )}
              </View>
            </View>
          ))
        )}

        {/* Subscriptions List */}
        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 24 }]}>
          {isEn ? 'Active Subscriptions' : 'Aktive Abonnements'}
        </Text>
        {subscriptions.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textLight }]}>
            {isEn ? 'No subscriptions yet' : 'Noch keine Abonnements'}
          </Text>
        ) : (
          subscriptions.map((sub, index) => (
            <View key={index} style={[styles.subCard, { backgroundColor: colors.card }]}>
              <View style={styles.subHeader}>
                <Text style={[styles.subDevice, { color: colors.text }]} numberOfLines={1}>
                  {sub.device_id}
                </Text>
                <View style={[styles.subTypeBadge, { backgroundColor: colors.secondary + '20' }]}>
                  <Text style={[styles.subTypeText, { color: colors.secondary }]}>
                    {sub.subscription_type}
                  </Text>
                </View>
              </View>
              <Text style={[styles.subExpires, { color: colors.textLight }]}>
                {isEn ? 'Valid until' : 'Gültig bis'}: {formatDate(sub.expires_at)}
              </Text>
            </View>
          ))
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Create Code Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showCreateModal}
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {isEn ? 'Create Promo Code' : 'Promo-Code erstellen'}
            </Text>

            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {isEn ? 'Code' : 'Code'}
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.background, color: colors.text }]}
              value={newCode}
              onChangeText={setNewCode}
              placeholder="SUMMER2024"
              placeholderTextColor={colors.textLight}
              autoCapitalize="characters"
              maxLength={20}
            />

            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {isEn ? 'Duration' : 'Dauer'}
            </Text>
            <View style={styles.durationPicker}>
              {DURATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.durationOption,
                    { backgroundColor: colors.background },
                    newDuration === option.value && { backgroundColor: colors.primary }
                  ]}
                  onPress={() => setNewDuration(option.value)}
                >
                  <Text style={[
                    styles.durationText,
                    { color: colors.text },
                    newDuration === option.value && { color: '#FFF' }
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {isEn ? 'Max uses (optional)' : 'Max. Nutzungen (optional)'}
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.background, color: colors.text }]}
              value={newMaxUses}
              onChangeText={setNewMaxUses}
              placeholder={isEn ? 'e.g. 100' : 'z.B. 100'}
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
            />

            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {isEn ? 'Description (optional)' : 'Beschreibung (optional)'}
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.background, color: colors.text }]}
              value={newDescription}
              onChangeText={setNewDescription}
              placeholder={isEn ? 'e.g. For beta testers' : 'z.B. Für Beta-Tester'}
              placeholderTextColor={colors.textLight}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButtonCancel, { borderColor: colors.textLight }]}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={[styles.modalButtonCancelText, { color: colors.textLight }]}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonCreate, { backgroundColor: colors.primary }]}
                onPress={createPromoCode}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.modalButtonCreateText}>
                    {isEn ? 'Create' : 'Erstellen'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  loginContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  backButtonLogin: { position: 'absolute', top: 20, left: 20 },
  loginTitle: { fontSize: 28, fontWeight: 'bold', marginTop: 20 },
  loginSubtitle: { fontSize: 14, marginTop: 8, marginBottom: 30 },
  passwordInput: { width: '100%', borderRadius: 12, padding: 16, fontSize: 16 },
  loginButton: { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  loginButtonText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 10 },
  backButton: { marginRight: 15 },
  title: { fontSize: 24, fontWeight: 'bold', flex: 1 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 15, marginBottom: 20 },
  statCard: { flex: 1, borderRadius: 16, padding: 16, alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: 'bold', marginTop: 8 },
  statLabel: { fontSize: 12, marginTop: 4 },
  createButton: { marginHorizontal: 20, padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  createButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginHorizontal: 20, marginTop: 24, marginBottom: 12 },
  emptyText: { textAlign: 'center', padding: 20 },
  codeCard: { marginHorizontal: 20, borderRadius: 12, padding: 16, marginBottom: 12 },
  codeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  codeText: { fontSize: 20, fontWeight: 'bold', letterSpacing: 1 },
  codeDetails: { gap: 6 },
  codeDetailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  codeLabel: { fontSize: 13 },
  codeValue: { fontSize: 13, fontWeight: '500' },
  codeDescription: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  subCard: { marginHorizontal: 20, borderRadius: 12, padding: 16, marginBottom: 12 },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  subDevice: { flex: 1, fontSize: 12, fontWeight: '500' },
  subTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginLeft: 10 },
  subTypeText: { fontSize: 11, fontWeight: '600' },
  subExpires: { fontSize: 12 },
  bottomSpacer: { height: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 20, textAlign: 'center' },
  inputLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  modalInput: { borderRadius: 12, padding: 14, fontSize: 16 },
  durationPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationOption: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  durationText: { fontSize: 13, fontWeight: '500' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButtonCancel: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  modalButtonCancelText: { fontSize: 16, fontWeight: '600' },
  modalButtonCreate: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  modalButtonCreateText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
