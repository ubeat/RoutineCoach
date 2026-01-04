import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Share,
  Alert,
  TextInput,
  Modal,
  Linking,
  Clipboard,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { COLOR_PALETTES } from '../contexts/SettingsContext';
import QRCode from 'react-native-qrcode-svg';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

interface Level {
  level: number;
  name: string;
  xp_required: number;
  icon: string;
}

interface Challenge {
  id: string;
  name: string;
  description: string;
  target: number;
  xp_reward: number;
}

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [currentLevel, setCurrentLevel] = useState<Level | null>(null);
  const [nextLevel, setNextLevel] = useState<Level | null>(null);
  const [earnedBadges, setEarnedBadges] = useState<Badge[]>([]);
  const [allBadges, setAllBadges] = useState<Badge[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [partnerInfo, setPartnerInfo] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [userName, setUserName] = useState<string>('');

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  // Einladungstext für alle Methoden
  const getInviteMessage = (code: string) => 
    `💜 Lass uns gemeinsam gute Gewohnheiten aufbauen! Werde meine Wegbegleiterin bei "Schritt fuer Schritt". Dein Code: ${code}`;

  const fetchData = useCallback(async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const storedName = await AsyncStorage.getItem('userName');
      if (storedName) setUserName(storedName);
      if (!deviceId) return;

      const [gamRes, challengesRes, partnerRes, leaderboardRes, settingsRes] = await Promise.all([
        axios.get(`${API_URL}/api/gamification/${deviceId}`),
        axios.get(`${API_URL}/api/challenges`),
        axios.get(`${API_URL}/api/social/partner/${deviceId}`),
        axios.get(`${API_URL}/api/social/leaderboard?device_id=${deviceId}`),
        axios.get(`${API_URL}/api/settings/${deviceId}`),
      ]);

      setProfile(gamRes.data.profile);
      setCurrentLevel(gamRes.data.current_level);
      setNextLevel(gamRes.data.next_level);
      setEarnedBadges(gamRes.data.badges_earned);
      setAllBadges(gamRes.data.all_badges);
      setChallenges(challengesRes.data.challenges);
      setPartnerInfo(partnerRes.data);
      setLeaderboard(leaderboardRes.data.leaderboard);
      setSettings(settingsRes.data);
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

  const startChallenge = async (challengeId: string) => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      await axios.post(`${API_URL}/api/gamification/${deviceId}/start-challenge?challenge_id=${challengeId}`);
      Alert.alert('Los gehts! 🚀', 'Deine Challenge hat begonnen. Du schaffst das!');
      setShowChallengeModal(false);
      fetchData();
    } catch (error) {
      Alert.alert('Hmm', 'Challenge konnte nicht gestartet werden. Versuch es nochmal!');
    }
  };

  const createInvite = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const response = await axios.post(`${API_URL}/api/social/invite?device_id=${deviceId}`);
      const code = response.data.invite_code;
      
      Share.share({
        message: `💜 Lass uns gemeinsam gute Gewohnheiten aufbauen! Werde mein Accountability Partner bei "Schritt fuer Schritt". Nutze den Code: ${code}`,
      });
      
      fetchData();
    } catch (error: any) {
      Alert.alert('Hinweis', error.response?.data?.detail || 'Einladung konnte nicht erstellt werden. Versuch es nochmal!');
    }
  };

  const acceptInvite = async () => {
    if (!inviteCode.trim()) {
      Alert.alert('Moment mal 💭', 'Bitte gib einen Code ein');
      return;
    }
    
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      await axios.post(`${API_URL}/api/social/accept-invite?device_id=${deviceId}&invite_code=${inviteCode}`);
      Alert.alert('Wunderbar! 🎉', 'Ihr seid jetzt verbunden! Gemeinsam schafft ihr das!');
      setShowPartnerModal(false);
      setInviteCode('');
      fetchData();
    } catch (error: any) {
      Alert.alert('Hmm 🤔', error.response?.data?.detail || 'Der Code scheint nicht zu stimmen. Pruef ihn nochmal!');
    }
  };

  const removePartner = async () => {
    Alert.alert(
      'Partner entfernen?',
      'Moechtest du die Verbindung wirklich loesen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            try {
              const deviceId = await AsyncStorage.getItem('deviceId');
              await axios.delete(`${API_URL}/api/social/partner/${deviceId}`);
              fetchData();
            } catch (error) {
              Alert.alert('Fehler', 'Konnte nicht entfernt werden');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const xpProgress = nextLevel 
    ? ((profile?.xp || 0) - (currentLevel?.xp_required || 0)) / 
      ((nextLevel?.xp_required || 1) - (currentLevel?.xp_required || 0)) * 100
    : 100;

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
            {userName ? `${userName}s Erfolge` : 'Deine Erfolge'} 🏆
          </Text>
          <Text style={[styles.subtitle, { color: colors.textLight }]}>
            Jeder kleine Schritt zaehlt - du machst das grossartig!
          </Text>
        </View>

        {/* Level & XP Card */}
        <View style={[styles.levelCard, { backgroundColor: colors.primary }]}>
          <View style={styles.levelHeader}>
            <View style={styles.levelIcon}>
              <Ionicons name={currentLevel?.icon as any || 'star'} size={40} color="#FFF" />
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.levelName}>Level {currentLevel?.level || 1}</Text>
              <Text style={styles.levelTitle}>{currentLevel?.name || 'Anfaenger'}</Text>
            </View>
            <View style={styles.xpBadge}>
              <Text style={styles.xpText}>{profile?.xp || 0} XP</Text>
            </View>
          </View>
          
          {nextLevel && (
            <View style={styles.xpProgressContainer}>
              <View style={styles.xpProgressBar}>
                <View style={[styles.xpProgressFill, { width: `${Math.min(xpProgress, 100)}%` }]} />
              </View>
              <Text style={styles.xpProgressText}>
                Noch {(nextLevel?.xp_required || 0) - (profile?.xp || 0)} XP bis Level {nextLevel?.level}
              </Text>
            </View>
          )}
        </View>

        {/* Streak Card */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.streakRow}>
            <View style={styles.streakItem}>
              <Ionicons name="flame" size={32} color="#FF4500" />
              <Text style={[styles.streakNumber, { color: colors.text }]}>{profile?.current_streak || 0}</Text>
              <Text style={[styles.streakLabel, { color: colors.textLight }]}>Aktueller Streak</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Ionicons name="trophy" size={32} color="#FFD700" />
              <Text style={[styles.streakNumber, { color: colors.text }]}>{profile?.longest_streak || 0}</Text>
              <Text style={[styles.streakLabel, { color: colors.textLight }]}>Laengster Streak</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Ionicons name="checkmark-done" size={32} color={colors.secondary} />
              <Text style={[styles.streakNumber, { color: colors.text }]}>{profile?.total_habits_completed || 0}</Text>
              <Text style={[styles.streakLabel, { color: colors.textLight }]}>Habits erledigt</Text>
            </View>
          </View>
        </View>

        {/* Active Challenge */}
        {profile?.active_challenge && (
          <View style={[styles.card, { backgroundColor: '#FFF3E0', borderColor: '#FFB74D', borderWidth: 1 }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="flag" size={24} color="#FF9800" />
              <Text style={[styles.cardTitle, { color: '#E65100' }]}>Aktive Challenge</Text>
            </View>
            {(() => {
              const challenge = challenges.find(c => c.id === profile.active_challenge);
              return challenge ? (
                <>
                  <Text style={[styles.challengeName, { color: '#E65100' }]}>{challenge.name}</Text>
                  <Text style={styles.challengeDesc}>{challenge.description}</Text>
                  <View style={styles.challengeProgress}>
                    <View style={styles.challengeProgressBar}>
                      <View 
                        style={[
                          styles.challengeProgressFill, 
                          { width: `${(profile.challenge_progress / challenge.target) * 100}%` }
                        ]} 
                      />
                    </View>
                    <Text style={styles.challengeProgressText}>
                      {profile.challenge_progress}/{challenge.target}
                    </Text>
                  </View>
                </>
              ) : null;
            })()}
          </View>
        )}

        {/* Weekly Challenge Button */}
        <TouchableOpacity
          style={[styles.challengeButton, { backgroundColor: colors.accent }]}
          onPress={() => setShowChallengeModal(true)}
        >
          <Ionicons name="flag" size={24} color={colors.text} />
          <Text style={[styles.challengeButtonText, { color: colors.text }]}>
            {profile?.active_challenge ? 'Challenge wechseln' : 'Wochen-Challenge starten'}
          </Text>
        </TouchableOpacity>

        {/* Badges */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="medal" size={24} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Abzeichen ({earnedBadges.length}/{allBadges.length})
            </Text>
          </View>
          <View style={styles.badgesGrid}>
            {allBadges.map((badge) => {
              const isEarned = earnedBadges.some(b => b.id === badge.id);
              return (
                <View 
                  key={badge.id} 
                  style={[
                    styles.badgeItem,
                    !isEarned && styles.badgeLocked
                  ]}
                >
                  <View style={[styles.badgeIcon, { backgroundColor: isEarned ? badge.color : '#E0E0E0' }]}>
                    <Ionicons 
                      name={badge.icon as any} 
                      size={24} 
                      color={isEarned ? '#FFF' : '#999'} 
                    />
                  </View>
                  <Text style={[
                    styles.badgeName, 
                    { color: isEarned ? colors.text : colors.textLight }
                  ]} numberOfLines={1}>
                    {badge.name}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Accountability Partner */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="people" size={24} color={colors.secondary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Accountability Partner</Text>
          </View>
          
          {partnerInfo?.has_partner ? (
            <View style={styles.partnerInfo}>
              <View style={styles.partnerStats}>
                <View style={styles.partnerStat}>
                  <Ionicons name="flame" size={20} color="#FF4500" />
                  <Text style={[styles.partnerStatText, { color: colors.text }]}>
                    {partnerInfo.partner.streak} Tage Streak
                  </Text>
                </View>
                <View style={styles.partnerStat}>
                  <Ionicons name="star" size={20} color="#FFD700" />
                  <Text style={[styles.partnerStatText, { color: colors.text }]}>
                    Level {partnerInfo.partner.level}
                  </Text>
                </View>
                <View style={styles.partnerStat}>
                  <Ionicons 
                    name={partnerInfo.partner.checked_in_today ? "checkmark-circle" : "close-circle"} 
                    size={20} 
                    color={partnerInfo.partner.checked_in_today ? colors.secondary : colors.primary} 
                  />
                  <Text style={[styles.partnerStatText, { color: colors.text }]}>
                    {partnerInfo.partner.checked_in_today ? 'Heute eingecheckt' : 'Noch nicht eingecheckt'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity 
                style={[styles.removePartnerButton, { borderColor: colors.primary }]}
                onPress={removePartner}
              >
                <Text style={[styles.removePartnerText, { color: colors.primary }]}>Partner entfernen</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              {partnerInfo?.pending_invite && (
                <View style={[styles.pendingInvite, { backgroundColor: colors.background }]}>
                  <Text style={[styles.pendingText, { color: colors.textLight }]}>
                    Dein Einladungscode: 
                  </Text>
                  <Text style={[styles.inviteCodeDisplay, { color: colors.primary }]}>
                    {partnerInfo.pending_invite.invite_code}
                  </Text>
                </View>
              )}
              <TouchableOpacity 
                style={[styles.partnerButton, { backgroundColor: colors.secondary }]}
                onPress={() => setShowPartnerModal(true)}
              >
                <Ionicons name="person-add" size={20} color="#FFF" />
                <Text style={styles.partnerButtonText}>Partner einladen oder Code eingeben</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Leaderboard */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="podium" size={24} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Rangliste</Text>
          </View>
          <View style={styles.leaderboard}>
            {leaderboard.slice(0, 5).map((entry, index) => (
              <View 
                key={index} 
                style={[
                  styles.leaderboardItem,
                  entry.is_you && { backgroundColor: colors.primary + '20' }
                ]}
              >
                <Text style={[styles.leaderboardRank, { color: colors.text }]}>#{entry.rank}</Text>
                <Text style={[styles.leaderboardName, { color: colors.text }]}>{entry.name}</Text>
                <View style={styles.leaderboardStats}>
                  <Ionicons name="flame" size={14} color="#FF4500" />
                  <Text style={[styles.leaderboardStat, { color: colors.textLight }]}>{entry.streak}</Text>
                  <Text style={[styles.leaderboardXP, { color: colors.primary }]}>{entry.xp} XP</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Challenge Selection Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showChallengeModal}
        onRequestClose={() => setShowChallengeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Wochen-Challenge waehlen</Text>
            <ScrollView style={styles.challengeList}>
              {challenges.map((challenge) => (
                <TouchableOpacity
                  key={challenge.id}
                  style={[styles.challengeOption, { backgroundColor: colors.background }]}
                  onPress={() => startChallenge(challenge.id)}
                >
                  <View>
                    <Text style={[styles.challengeOptionName, { color: colors.text }]}>{challenge.name}</Text>
                    <Text style={[styles.challengeOptionDesc, { color: colors.textLight }]}>{challenge.description}</Text>
                  </View>
                  <View style={[styles.xpReward, { backgroundColor: colors.accent }]}>
                    <Text style={styles.xpRewardText}>+{challenge.xp_reward} XP</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalCloseButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowChallengeModal(false)}
            >
              <Text style={styles.modalCloseText}>Schliessen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Partner Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showPartnerModal}
        onRequestClose={() => setShowPartnerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Accountability Partner 💜</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textLight }]}>
              Gemeinsam ist alles leichter! Lade einen Freund ein.
            </Text>
            
            <TouchableOpacity
              style={[styles.inviteButton, { backgroundColor: colors.secondary }]}
              onPress={createInvite}
            >
              <Ionicons name="share" size={20} color="#FFF" />
              <Text style={styles.inviteButtonText}>Einladung erstellen & teilen</Text>
            </TouchableOpacity>
            
            <Text style={[styles.orText, { color: colors.textLight }]}>- oder -</Text>
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Du hast einen Code erhalten?</Text>
            <TextInput
              style={[styles.codeInput, { borderColor: colors.primary, color: colors.text }]}
              value={inviteCode}
              onChangeText={setInviteCode}
              placeholder="z.B. ABC123"
              placeholderTextColor={colors.textLight}
              autoCapitalize="characters"
              maxLength={8}
            />
            
            <TouchableOpacity
              style={[styles.acceptButton, { backgroundColor: colors.primary }]}
              onPress={acceptInvite}
            >
              <Text style={styles.acceptButtonText}>Code einloesen</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowPartnerModal(false)}
            >
              <Text style={[styles.cancelButtonText, { color: colors.textLight }]}>Spaeter</Text>
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
  header: {
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  levelCard: {
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 20,
    padding: 20,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelInfo: {
    flex: 1,
    marginLeft: 15,
  },
  levelName: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  levelTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFF',
  },
  xpBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  xpText: {
    color: '#FFF',
    fontWeight: '700',
  },
  xpProgressContainer: {
    marginTop: 15,
  },
  xpProgressBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  xpProgressFill: {
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 4,
  },
  xpProgressText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
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
  streakRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  streakItem: {
    alignItems: 'center',
    flex: 1,
  },
  streakDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
  },
  streakNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 8,
  },
  streakLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  challengeButton: {
    marginHorizontal: 20,
    marginBottom: 15,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  challengeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  challengeName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 5,
  },
  challengeDesc: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  challengeProgress: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  challengeProgressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  challengeProgressFill: {
    height: '100%',
    backgroundColor: '#FF9800',
    borderRadius: 4,
  },
  challengeProgressText: {
    marginLeft: 10,
    fontWeight: '600',
    color: '#E65100',
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  badgeItem: {
    width: '25%',
    alignItems: 'center',
    marginBottom: 15,
  },
  badgeLocked: {
    opacity: 0.5,
  },
  badgeIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeName: {
    fontSize: 10,
    marginTop: 5,
    textAlign: 'center',
  },
  partnerInfo: {
    gap: 15,
  },
  partnerStats: {
    gap: 10,
  },
  partnerStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partnerStatText: {
    fontSize: 15,
  },
  removePartnerButton: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  removePartnerText: {
    fontWeight: '600',
  },
  pendingInvite: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: 'center',
  },
  pendingText: {
    fontSize: 14,
  },
  inviteCodeDisplay: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 5,
    letterSpacing: 2,
  },
  partnerButton: {
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  partnerButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  leaderboard: {
    gap: 8,
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
  },
  leaderboardRank: {
    width: 30,
    fontWeight: 'bold',
  },
  leaderboardName: {
    flex: 1,
    fontWeight: '600',
  },
  leaderboardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  leaderboardStat: {
    fontSize: 12,
    marginRight: 8,
  },
  leaderboardXP: {
    fontWeight: '600',
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
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  challengeList: {
    maxHeight: 300,
  },
  challengeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  challengeOptionName: {
    fontSize: 16,
    fontWeight: '600',
  },
  challengeOptionDesc: {
    fontSize: 13,
    marginTop: 4,
  },
  xpReward: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  xpRewardText: {
    fontWeight: '700',
    fontSize: 12,
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
  inviteButton: {
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  inviteButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  orText: {
    textAlign: 'center',
    marginVertical: 15,
  },
  inputLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  codeInput: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 15,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: 3,
  },
  acceptButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 15,
  },
  acceptButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
  },
});
