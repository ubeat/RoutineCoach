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

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const DURATION_OPTIONS = [
  { value: 7, label: '1 Woche' },
  { value: 30, label: '1 Monat' },
  { value: 90, label: '3 Monate' },
  { value: 180, label: '6 Monate' },
  { value: 365, label: '1 Jahr' },
];

export default function AdminScreen() {
  const router = useRouter();
  const colors = COLOR_PALETTES.sonnenuntergang;
  
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [promoCodes, setPromoCodes] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  // New promo code form
  const [newCode, setNewCode] = useState('');
  const [newDuration, setNewDuration] = useState(30);
  const [newDescription, setNewDescription] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!authenticated) return;
    
    try {
      const [codesRes, subsRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/promo-codes?admin_password=${password}`),
        axios.get(`${API_URL}/api/admin/subscriptions?admin_password=${password}`),
      ]);
      
      setPromoCodes(codesRes.data.codes || []);
      setSubscriptions(subsRes.data.subscriptions || []);
    } catch (error) {
      console.error('Error fetching admin data:', error);
      Alert.alert('Fehler', 'Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authenticated, password]);

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
      Alert.alert('Hinweis', 'Bitte Passwort eingeben.');
      return;
    }
    
    setLoading(true);
    try {
      // Test the password by trying to fetch promo codes
      await axios.get(`${API_URL}/api/admin/promo-codes?admin_password=${password}`);
      setAuthenticated(true);
    } catch (error: any) {
      if (error.response?.status === 403) {
        Alert.alert('Fehler', 'Falsches Passwort.');
      } else {
        Alert.alert('Fehler', 'Verbindungsfehler.');
      }
      setLoading(false);
    }
  };

  const createPromoCode = async () => {
    if (!newCode.trim()) {
      Alert.alert('Hinweis', 'Bitte Code eingeben.');
      return;
    }
    
    setCreating(true);
    try {
      await axios.post(
        `${API_URL}/api/admin/promo-codes?admin_password=${password}`,
        {
          code: newCode.trim().toUpperCase(),
          duration_days: newDuration,
          description: newDescription || null,
          max_uses: newMaxUses ? parseInt(newMaxUses) : null,
        }
      );
      
      Alert.alert('Erfolg! ✓', `Code "${newCode.toUpperCase()}" wurde erstellt.`);
      setShowCreateModal(false);
      setNewCode('');
      setNewDescription('');
      setNewMaxUses('');
      setNewDuration(30);
      fetchData();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Code konnte nicht erstellt werden.';
      Alert.alert('Fehler', message);
    } finally {
      setCreating(false);
    }
  };

  const toggleCodeActive = async (code: string, isActive: boolean) => {
    try {
      await axios.put(
        `${API_URL}/api/admin/promo-codes/${code}?admin_password=${password}&is_active=${!isActive}`
      );
      fetchData();
    } catch (error) {
      Alert.alert('Fehler', 'Status konnte nicht geändert werden.');
    }
  };

  const deleteCode = async (code: string) => {
    Alert.alert(
      'Code löschen?',
      `Möchtest du den Code "${code}" wirklich löschen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await axios.delete(
                `${API_URL}/api/admin/promo-codes/${code}?admin_password=${password}`
              );
              fetchData();
            } catch (error) {
              Alert.alert('Fehler', 'Code konnte nicht gelöscht werden.');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getDurationLabel = (days: number) => {
    return DURATION_OPTIONS.find(d => d.value === days)?.label || `${days} Tage`;
  };

  // Login Screen
  if (!authenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loginContainer}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButtonLogin}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          
          <Ionicons name="shield-checkmark" size={64} color={colors.primary} />
          <Text style={[styles.loginTitle, { color: colors.text }]}>Admin-Bereich</Text>
          <Text style={[styles.loginSubtitle, { color: colors.textLight }]}>
            Promo-Codes und Abonnements verwalten
          </Text>
          
          <TextInput
            style={[styles.passwordInput, { borderColor: colors.primary, color: colors.text }]}
            value={password}
            onChangeText={setPassword}
            placeholder="Admin-Passwort"
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
              <Text style={styles.loginButtonText}>Anmelden</Text>
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
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Admin</Text>
          <TouchableOpacity onPress={() => setAuthenticated(false)} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                <Text style={[styles.statNumber, { color: colors.primary }]}>{promoCodes.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textLight }]}>Promo-Codes</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                <Text style={[styles.statNumber, { color: colors.secondary }]}>{subscriptions.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textLight }]}>Abonnements</Text>
              </View>
            </View>

            {/* Promo Codes Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Promo-Codes</Text>
                <TouchableOpacity
                  style={[styles.addButton, { backgroundColor: colors.secondary }]}
                  onPress={() => setShowCreateModal(true)}
                >
                  <Ionicons name="add" size={20} color="#FFF" />
                  <Text style={styles.addButtonText}>Neu</Text>
                </TouchableOpacity>
              </View>

              {promoCodes.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textLight }]}>
                  Noch keine Promo-Codes erstellt.
                </Text>
              ) : (
                promoCodes.map((code, index) => (
                  <View key={index} style={[styles.codeCard, { backgroundColor: colors.card }]}>
                    <View style={styles.codeHeader}>
                      <Text style={[styles.codeText, { color: colors.primary }]}>{code.code}</Text>
                      <View style={[
                        styles.statusBadge, 
                        { backgroundColor: code.is_active ? '#E8F5E9' : '#FFEBEE' }
                      ]}>
                        <Text style={{ color: code.is_active ? '#4CAF50' : '#F44336', fontSize: 12 }}>
                          {code.is_active ? 'Aktiv' : 'Inaktiv'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.codeInfo, { color: colors.textLight }]}>
                      Dauer: {getDurationLabel(code.duration_days)} • 
                      Verwendet: {code.current_uses || 0}/{code.max_uses || '∞'}
                    </Text>
                    {code.description && (
                      <Text style={[styles.codeDescription, { color: colors.text }]}>
                        {code.description}
                      </Text>
                    )}
                    <View style={styles.codeActions}>
                      <TouchableOpacity
                        style={[styles.codeActionButton, { backgroundColor: colors.background }]}
                        onPress={() => toggleCodeActive(code.code, code.is_active)}
                      >
                        <Ionicons 
                          name={code.is_active ? "pause" : "play"} 
                          size={16} 
                          color={colors.primary} 
                        />
                        <Text style={[styles.codeActionText, { color: colors.primary }]}>
                          {code.is_active ? 'Deaktivieren' : 'Aktivieren'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.codeActionButton, { backgroundColor: '#FFEBEE' }]}
                        onPress={() => deleteCode(code.code)}
                      >
                        <Ionicons name="trash-outline" size={16} color="#F44336" />
                        <Text style={[styles.codeActionText, { color: '#F44336' }]}>Löschen</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Subscriptions Section */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Aktive Abonnements</Text>
              
              {subscriptions.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.textLight }]}>
                  Noch keine Abonnements.
                </Text>
              ) : (
                subscriptions.slice(0, 10).map((sub, index) => (
                  <View key={index} style={[styles.subCard, { backgroundColor: colors.card }]}>
                    <View style={styles.subRow}>
                      <Text style={[styles.subDevice, { color: colors.text }]}>
                        {sub.device_id?.substring(0, 20)}...
                      </Text>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: sub.is_premium ? '#E8F5E9' : '#FFF3E0' }
                      ]}>
                        <Text style={{ 
                          color: sub.is_premium ? '#4CAF50' : '#FF9800', 
                          fontSize: 11,
                          fontWeight: '600'
                        }}>
                          {sub.is_premium ? 'Premium' : 'Abgelaufen'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.subInfo, { color: colors.textLight }]}>
                      Typ: {sub.subscription_type} • Bis: {formatDate(sub.expires_at)}
                    </Text>
                  </View>
                ))
              )}
              
              {subscriptions.length > 10 && (
                <Text style={[styles.moreText, { color: colors.textLight }]}>
                  ... und {subscriptions.length - 10} weitere
                </Text>
              )}
            </View>
          </>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Create Promo Code Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Neuen Promo-Code erstellen</Text>
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Code *</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: colors.primary, color: colors.text }]}
              value={newCode}
              onChangeText={setNewCode}
              placeholder="z.B. GESCHENK2025"
              placeholderTextColor={colors.textLight}
              autoCapitalize="characters"
              maxLength={20}
            />
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Gültigkeitsdauer *</Text>
            <View style={styles.durationOptions}>
              {DURATION_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.durationOption,
                    { borderColor: colors.primary },
                    newDuration === option.value && { backgroundColor: colors.primary }
                  ]}
                  onPress={() => setNewDuration(option.value)}
                >
                  <Text style={[
                    styles.durationOptionText,
                    { color: newDuration === option.value ? '#FFF' : colors.primary }
                  ]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Beschreibung (optional)</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: colors.primary, color: colors.text }]}
              value={newDescription}
              onChangeText={setNewDescription}
              placeholder="z.B. Influencer-Kampagne März"
              placeholderTextColor={colors.textLight}
            />
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Max. Verwendungen (optional)</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: colors.primary, color: colors.text }]}
              value={newMaxUses}
              onChangeText={setNewMaxUses}
              placeholder="Leer = unbegrenzt"
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalCancelButton, { borderColor: colors.textLight }]}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={[styles.modalCancelText, { color: colors.textLight }]}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreateButton, { backgroundColor: colors.secondary }]}
                onPress={createPromoCode}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.modalCreateText}>Erstellen</Text>
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
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  backButtonLogin: {
    position: 'absolute',
    top: 20,
    left: 20,
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 8,
  },
  loginSubtitle: {
    fontSize: 14,
    marginBottom: 30,
    textAlign: 'center',
  },
  passwordInput: {
    width: '100%',
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 20,
  },
  loginButton: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
  },
  backButton: {
    marginRight: 15,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    flex: 1,
  },
  logoutButton: {
    padding: 4,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    padding: 20,
  },
  codeCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  codeText: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  codeInfo: {
    fontSize: 13,
    marginBottom: 4,
  },
  codeDescription: {
    fontSize: 13,
    marginTop: 4,
  },
  codeActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  codeActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  codeActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  subCard: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  subRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  subDevice: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  subInfo: {
    fontSize: 12,
  },
  moreText: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 13,
  },
  bottomSpacer: {
    height: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  durationOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  durationOption: {
    borderWidth: 2,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  durationOptionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalCreateButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCreateText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
