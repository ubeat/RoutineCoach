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
import { useTranslation } from 'react-i18next';

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
  const { t, i18n } = useTranslation();
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
  
  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);
  const [badgeEarned, setBadgeEarned] = useState(false);
  const [showXPInfoModal, setShowXPInfoModal] = useState(false);

  const XP_REWARDS = [
    { action: t('profile.xp_daily_checkin'), xp: 10, icon: 'checkbox-outline', color: '#4CAF50' },
    { action: t('profile.xp_all_habits'), xp: 25, icon: 'star', color: '#FFD700' },
    { action: t('profile.xp_two_habits'), xp: 15, icon: 'star-half', color: '#FFA500' },
    { action: t('profile.xp_one_habit'), xp: 5, icon: 'star-outline', color: '#9E9E9E' },
    { action: t('profile.xp_7day_streak'), xp: 50, icon: 'flame', color: '#FF4500' },
    { action: t('profile.xp_30day_streak'), xp: 200, icon: 'trophy', color: '#9C27B0' },
    { action: t('profile.xp_badge_earned'), xp: 30, icon: 'ribbon', color: '#2196F3' },
    { action: t('profile.xp_challenge_done'), xp: '50-100', icon: 'flag', color: '#E91E63' },
  ];

  const BADGE_EMOJIS: Record<string, string> = {
    'first_checkin': '🌟',
    'streak_3': '🔥',
    'streak_7': '💪',
    'streak_14': '⚡',
    'streak_30': '👑',
    'perfect_week': '🏆',
    'habit_hero': '🦸',
    'early_bird': '🐦',
    'night_owl': '🦉',
    'comeback': '🔄',
  };

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  const openBadgeDetail = (badge: Badge, earned: boolean) => {
    setSelectedBadge(badge);
    setBadgeEarned(earned);
    setShowBadgeModal(true);
  };

  const getInviteMessage = (code: string) => 
    `💜 ${t('profile.invite_message', { code })}`;

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
      Alert.alert(
        t('profile.challenge_started_title') + ' 🚀', 
        t('profile.challenge_started_message')
      );
      setShowChallengeModal(false);
      fetchData();
    } catch (error) {
      Alert.alert('Hmm', t('profile.challenge_error'));
    }
  };

  const createInvite = async () => {
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      const response = await axios.post(`${API_URL}/api/social/invite?device_id=${deviceId}`);
      const code = response.data.invite_code;
      setGeneratedCode(code);
      fetchData();
    } catch (error: any) {
      Alert.alert(
        t('common.note'), 
        error.response?.data?.detail || t('profile.invite_error')
      );
    }
  };

  const shareViaGeneral = async () => {
    if (!generatedCode) return;
    Share.share({ message: getInviteMessage(generatedCode) });
  };

  const shareViaWhatsApp = async () => {
    if (!generatedCode) return;
    const message = encodeURIComponent(getInviteMessage(generatedCode));
    const url = `whatsapp://send?text=${message}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t('profile.whatsapp_not_found'), t('profile.whatsapp_not_installed'));
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('profile.whatsapp_error'));
    }
  };

  const shareViaSMS = async () => {
    if (!generatedCode) return;
    const message = encodeURIComponent(getInviteMessage(generatedCode));
    const url = Platform.OS === 'ios' ? `sms:&body=${message}` : `sms:?body=${message}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(t('common.error'), t('profile.sms_error'));
    }
  };

  const shareViaEmail = async () => {
    if (!generatedCode) return;
    const subject = encodeURIComponent(t('profile.invite_subject'));
    const body = encodeURIComponent(getInviteMessage(generatedCode));
    const url = `mailto:?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(t('common.error'), t('profile.email_error'));
    }
  };

  const copyCodeToClipboard = async () => {
    if (!generatedCode) return;
    if (Clipboard.setString) {
      Clipboard.setString(generatedCode);
    }
    Alert.alert(
      t('profile.copied_title') + ' 📋', 
      t('profile.copied_message', { code: generatedCode })
    );
  };

  const acceptInvite = async () => {
    if (!inviteCode.trim()) {
      Alert.alert(t('common.note') + ' 💭', t('profile.enter_code'));
      return;
    }
    
    try {
      const deviceId = await AsyncStorage.getItem('deviceId');
      await axios.post(`${API_URL}/api/social/accept-invite?device_id=${deviceId}&invite_code=${inviteCode}`);
      Alert.alert(
        t('profile.connected_title') + ' 🎉', 
        t('profile.connected_message')
      );
      setShowPartnerModal(false);
      setInviteCode('');
      fetchData();
    } catch (error: any) {
      Alert.alert('Hmm 🤔', error.response?.data?.detail || t('profile.code_wrong'));
    }
  };

  const removePartner = async () => {
    Alert.alert(
      t('profile.disconnect_confirm_title'),
      t('profile.disconnect_confirm_message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.yes_disconnect'),
          style: 'destructive',
          onPress: async () => {
            try {
              const deviceId = await AsyncStorage.getItem('deviceId');
              await axios.delete(`${API_URL}/api/social/partner/${deviceId}`);
              fetchData();
            } catch (error) {
              Alert.alert('Hmm', t('profile.disconnect_error'));
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
            {userName ? t('profile.title_with_name', { name: userName }) : t('profile.title')} 🏆
          </Text>
          <Text style={[styles.subtitle, { color: colors.textLight }]}>
            {t('profile.subtitle')}
          </Text>
        </View>

        {/* Level & XP Card */}
        <View style={[styles.levelCard, { backgroundColor: colors.primary }]}>
          <View style={styles.levelHeader}>
            <View style={styles.levelIcon}>
              <Ionicons name={currentLevel?.icon as any || 'star'} size={40} color="#FFF" />
            </View>
            <View style={styles.levelInfo}>
              <Text style={styles.levelName}>{t('profile.level')} {currentLevel?.level || 1}</Text>
              <Text style={styles.levelTitle}>{currentLevel?.name || t('profile.beginner')}</Text>
            </View>
            <TouchableOpacity 
              style={styles.xpBadge}
              onPress={() => setShowXPInfoModal(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.xpText}>{profile?.xp || 0} XP</Text>
              <Ionicons name="help-circle-outline" size={14} color="rgba(255,255,255,0.8)" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>
          
          {nextLevel && (
            <View style={styles.xpProgressContainer}>
              <View style={styles.xpProgressBar}>
                <View style={[styles.xpProgressFill, { width: `${Math.min(xpProgress, 100)}%` }]} />
              </View>
              <Text style={styles.xpProgressText}>
                {t('profile.xp_until_next', { xp: (nextLevel?.xp_required || 0) - (profile?.xp || 0), level: nextLevel?.level })}
              </Text>
            </View>
          )}
          
          <TouchableOpacity 
            style={styles.xpInfoLink}
            onPress={() => setShowXPInfoModal(true)}
          >
            <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.9)" />
            <Text style={styles.xpInfoLinkText}>{t('profile.how_to_earn_xp')}</Text>
          </TouchableOpacity>
        </View>

        {/* Streak Card */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.streakRow}>
            <View style={styles.streakItem}>
              <Ionicons name="flame" size={32} color="#FF4500" />
              <Text style={[styles.streakNumber, { color: colors.text }]}>{profile?.current_streak || 0}</Text>
              <Text style={[styles.streakLabel, { color: colors.textLight }]}>{t('profile.current_streak')}</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Ionicons name="trophy" size={32} color="#FFD700" />
              <Text style={[styles.streakNumber, { color: colors.text }]}>{profile?.longest_streak || 0}</Text>
              <Text style={[styles.streakLabel, { color: colors.textLight }]}>{t('profile.longest_streak')}</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Ionicons name="checkmark-done" size={32} color={colors.secondary} />
              <Text style={[styles.streakNumber, { color: colors.text }]}>{profile?.total_habits_completed || 0}</Text>
              <Text style={[styles.streakLabel, { color: colors.textLight }]}>{t('profile.habits_done')}</Text>
            </View>
          </View>
        </View>

        {/* Active Challenge */}
        {profile?.active_challenge && (
          <View style={[styles.card, { backgroundColor: '#FFF3E0', borderColor: '#FFB74D', borderWidth: 1 }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="flag" size={24} color="#FF9800" />
              <Text style={[styles.cardTitle, { color: '#E65100' }]}>{t('profile.active_challenge')}</Text>
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
            {profile?.active_challenge 
              ? (isEn ? 'Change Challenge' : 'Challenge wechseln') 
              : (isEn ? 'Start Weekly Challenge' : 'Wochen-Challenge starten')}
          </Text>
        </TouchableOpacity>

        {/* Badges */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="medal" size={24} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {isEn ? 'Badges' : 'Abzeichen'} ({earnedBadges.length}/{allBadges.length})
            </Text>
          </View>
          <View style={styles.badgesGrid}>
            {allBadges.map((badge) => {
              const isEarned = earnedBadges.some(b => b.id === badge.id);
              return (
                <TouchableOpacity 
                  key={badge.id} 
                  style={[
                    styles.badgeItem,
                    !isEarned && styles.badgeLocked
                  ]}
                  onPress={() => openBadgeDetail(badge, isEarned)}
                  activeOpacity={0.7}
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
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Companion */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="people" size={24} color={colors.secondary} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>{isEn ? 'Your Companion 💜' : 'Deine Wegbegleiterin 💜'}</Text>
          </View>
          
          {partnerInfo?.has_partner ? (
            <View style={styles.partnerInfo}>
              <Text style={[styles.partnerConnectedText, { color: colors.text }]}>
                {isEn ? 'You are connected! Together you can do it.' : 'Ihr seid verbunden! Gemeinsam schafft ihr das.'}
              </Text>
              <View style={styles.partnerStats}>
                <View style={styles.partnerStat}>
                  <Ionicons name="flame" size={20} color="#FF4500" />
                  <Text style={[styles.partnerStatText, { color: colors.text }]}>
                    {partnerInfo.partner.streak} {isEn ? 'day streak' : 'Tage Streak'}
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
                    {partnerInfo.partner.checked_in_today 
                      ? (isEn ? 'Checked in today' : 'Heute eingecheckt') 
                      : (isEn ? 'Not checked in yet' : 'Noch nicht eingecheckt')}
                  </Text>
                </View>
              </View>
              <TouchableOpacity 
                style={[styles.removePartnerButton, { borderColor: colors.primary }]}
                onPress={removePartner}
              >
                <Text style={[styles.removePartnerText, { color: colors.primary }]}>{isEn ? 'Disconnect' : 'Verbindung lösen'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={[styles.partnerExplainText, { color: colors.textLight }]}>
                {isEn 
                  ? 'A companion motivates you and you support each other. Together you stay on track!'
                  : 'Eine Wegbegleiterin motiviert dich und ihr unterstützt euch gegenseitig. Gemeinsam bleibt ihr eher dran!'}
              </Text>
              {partnerInfo?.pending_invite && (
                <View style={[styles.pendingInvite, { backgroundColor: colors.background }]}>
                  <Text style={[styles.pendingText, { color: colors.textLight }]}>
                    {isEn ? 'Your invite code:' : 'Dein Einladungscode:'} 
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
                <Text style={styles.partnerButtonText}>{isEn ? 'Invite Companion' : 'Wegbegleiterin einladen'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Leaderboard */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="podium" size={24} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>{isEn ? 'Leaderboard' : 'Rangliste'}</Text>
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
            <Text style={[styles.modalTitle, { color: colors.text }]}>{isEn ? 'Choose Weekly Challenge' : 'Wochen-Challenge wählen'}</Text>
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
              <Text style={styles.modalCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Partner Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showPartnerModal}
        onRequestClose={() => { setShowPartnerModal(false); setGeneratedCode(null); }}
      >
        <View style={styles.modalOverlay}>
          <ScrollView>
            <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{isEn ? 'Invite Companion 💜' : 'Wegbegleiterin einladen 💜'}</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textLight }]}>
                {isEn ? 'Together it is more fun and you stay on track!' : 'Gemeinsam macht es mehr Spaß und ihr bleibt eher dran!'}
              </Text>
              
              {!generatedCode ? (
                <>
                  <TouchableOpacity
                    style={[styles.inviteButton, { backgroundColor: colors.secondary }]}
                    onPress={createInvite}
                  >
                    <Ionicons name="sparkles" size={20} color="#FFF" />
                    <Text style={styles.inviteButtonText}>{isEn ? 'Create invite code' : 'Einladungscode erstellen'}</Text>
                  </TouchableOpacity>
                  
                  <Text style={[styles.orText, { color: colors.textLight }]}>- {isEn ? 'or' : 'oder'} -</Text>
                  
                  <Text style={[styles.inputLabel, { color: colors.text }]}>{isEn ? 'Got a code?' : 'Du hast einen Code erhalten?'}</Text>
                  <TextInput
                    style={[styles.codeInput, { borderColor: colors.primary, color: colors.text }]}
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    placeholder={isEn ? 'e.g. ABC123' : 'z.B. ABC123'}
                    placeholderTextColor={colors.textLight}
                    autoCapitalize="characters"
                    maxLength={8}
                  />
                  
                  <TouchableOpacity
                    style={[styles.acceptButton, { backgroundColor: colors.primary }]}
                    onPress={acceptInvite}
                  >
                    <Text style={styles.acceptButtonText}>{isEn ? 'Redeem code' : 'Code einlösen'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={[styles.qrCodeContainer, { backgroundColor: '#FFF' }]}>
                    <QRCode
                      value={generatedCode}
                      size={150}
                      color={colors.primary}
                      backgroundColor="#FFF"
                    />
                  </View>
                  
                  <View style={[styles.codeDisplayBox, { backgroundColor: colors.background }]}>
                    <Text style={[styles.codeLabel, { color: colors.textLight }]}>{isEn ? 'Your invite code:' : 'Dein Einladungscode:'}</Text>
                    <Text style={[styles.generatedCodeText, { color: colors.primary }]}>{generatedCode}</Text>
                  </View>
                  
                  <Text style={[styles.shareMethodsTitle, { color: colors.text }]}>
                    {isEn ? 'Share via:' : 'Teilen via:'}
                  </Text>
                  
                  <View style={styles.shareButtonsGrid}>
                    <TouchableOpacity style={[styles.shareMethodButton, { backgroundColor: '#25D366' }]} onPress={shareViaWhatsApp}>
                      <Ionicons name="logo-whatsapp" size={24} color="#FFF" />
                      <Text style={styles.shareMethodText}>WhatsApp</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.shareMethodButton, { backgroundColor: '#007AFF' }]} onPress={shareViaSMS}>
                      <Ionicons name="chatbubble" size={24} color="#FFF" />
                      <Text style={styles.shareMethodText}>SMS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.shareMethodButton, { backgroundColor: '#EA4335' }]} onPress={shareViaEmail}>
                      <Ionicons name="mail" size={24} color="#FFF" />
                      <Text style={styles.shareMethodText}>{isEn ? 'Email' : 'E-Mail'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.shareMethodButton, { backgroundColor: colors.secondary }]} onPress={shareViaGeneral}>
                      <Ionicons name="share-social" size={24} color="#FFF" />
                      <Text style={styles.shareMethodText}>{isEn ? 'More...' : 'Mehr...'}</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <TouchableOpacity style={[styles.copyCodeButton, { borderColor: colors.primary }]} onPress={copyCodeToClipboard}>
                    <Ionicons name="copy-outline" size={20} color={colors.primary} />
                    <Text style={[styles.copyCodeText, { color: colors.primary }]}>{isEn ? 'Copy code' : 'Code kopieren'}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={styles.newCodeButton} onPress={() => setGeneratedCode(null)}>
                    <Text style={[styles.newCodeText, { color: colors.textLight }]}>{isEn ? 'Create new code' : 'Neuen Code erstellen'}</Text>
                  </TouchableOpacity>
                </>
              )}
              
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => { setShowPartnerModal(false); setGeneratedCode(null); }}
              >
                <Text style={[styles.cancelButtonText, { color: colors.textLight }]}>{t('common.later')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Badge Detail Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={showBadgeModal}
        onRequestClose={() => setShowBadgeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.badgeModalContent, { backgroundColor: colors.card }]}>
            {selectedBadge && (
              <>
                <View style={[
                  styles.badgeModalIcon, 
                  { backgroundColor: badgeEarned ? selectedBadge.color : '#E0E0E0' }
                ]}>
                  <Text style={styles.badgeModalEmoji}>
                    {BADGE_IMAGES[selectedBadge.id]?.emoji || '🏅'}
                  </Text>
                </View>
                
                <Text style={[styles.badgeModalTitle, { color: colors.text }]}>
                  {selectedBadge.name}
                </Text>
                
                <View style={[
                  styles.badgeStatusPill, 
                  { backgroundColor: badgeEarned ? '#E8F5E9' : '#FFF3E0' }
                ]}>
                  <Ionicons 
                    name={badgeEarned ? "checkmark-circle" : "lock-closed"} 
                    size={16} 
                    color={badgeEarned ? '#4CAF50' : '#FF9800'} 
                  />
                  <Text style={[
                    styles.badgeStatusText, 
                    { color: badgeEarned ? '#4CAF50' : '#FF9800' }
                  ]}>
                    {badgeEarned 
                      ? (isEn ? 'Unlocked! 🎉' : 'Freigeschaltet! 🎉') 
                      : (isEn ? 'Not yet unlocked' : 'Noch nicht freigeschaltet')}
                  </Text>
                </View>
                
                <Text style={[styles.badgeModalDescription, { color: colors.textLight }]}>
                  {BADGE_IMAGES[selectedBadge.id]?.description || selectedBadge.description}
                </Text>
                
                {!badgeEarned && (
                  <View style={[styles.badgeHintBox, { backgroundColor: colors.background }]}>
                    <Ionicons name="bulb-outline" size={20} color={colors.accent} />
                    <Text style={[styles.badgeHintText, { color: colors.text }]}>
                      {isEn ? 'Tip:' : 'Tipp:'} {selectedBadge.description}
                    </Text>
                  </View>
                )}
                
                <TouchableOpacity
                  style={[styles.badgeModalCloseButton, { backgroundColor: colors.primary }]}
                  onPress={() => setShowBadgeModal(false)}
                >
                  <Text style={styles.badgeModalCloseText}>{t('common.understood')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* XP Info Modal */}
      <Modal
        transparent
        animationType="slide"
        visible={showXPInfoModal}
        onRequestClose={() => setShowXPInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.xpModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.xpModalHeader}>
              <Ionicons name="star" size={32} color="#FFD700" />
              <Text style={[styles.xpModalTitle, { color: colors.text }]}>{isEn ? 'How to earn XP!' : 'So verdienst du XP!'}</Text>
            </View>
            
            <Text style={[styles.xpModalSubtitle, { color: colors.textLight }]}>
              {isEn 
                ? 'XP (experience points) help you level up and unlock new badges.'
                : 'XP (Erfahrungspunkte) helfen dir, Level aufzusteigen und neue Abzeichen freizuschalten.'}
            </Text>
            
            <ScrollView style={styles.xpRewardsList}>
              {XP_REWARDS.map((reward, index) => (
                <View key={index} style={[styles.xpRewardItem, { backgroundColor: colors.background }]}>
                  <View style={[styles.xpRewardIconContainer, { backgroundColor: reward.color + '20' }]}>
                    <Ionicons name={reward.icon as any} size={24} color={reward.color} />
                  </View>
                  <View style={styles.xpRewardInfo}>
                    <Text style={[styles.xpRewardAction, { color: colors.text }]}>{reward.action}</Text>
                  </View>
                  <View style={[styles.xpRewardBadge, { backgroundColor: reward.color }]}>
                    <Text style={styles.xpRewardAmount}>+{reward.xp}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            
            <View style={[styles.xpTipBox, { backgroundColor: colors.accent + '30' }]}>
              <Ionicons name="heart" size={20} color={colors.primary} />
              <Text style={[styles.xpTipText, { color: colors.text }]}>
                {isEn 
                  ? 'Keep going - every small step counts and brings you closer to your goal! 💪'
                  : 'Bleib dran - jeder kleine Schritt zählt und bringt dich näher ans Ziel! 💪'}
              </Text>
            </View>
            
            <TouchableOpacity
              style={[styles.xpModalCloseButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowXPInfoModal(false)}
            >
              <Text style={styles.xpModalCloseText}>{t('common.letsgo')}</Text>
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
  header: { padding: 20, paddingTop: 10 },
  title: { fontSize: 28, fontWeight: 'bold' },
  subtitle: { fontSize: 14, marginTop: 4 },
  levelCard: { marginHorizontal: 20, marginBottom: 15, borderRadius: 20, padding: 20 },
  levelHeader: { flexDirection: 'row', alignItems: 'center' },
  levelIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  levelInfo: { flex: 1, marginLeft: 15 },
  levelName: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  levelTitle: { fontSize: 24, fontWeight: 'bold', color: '#FFF' },
  xpBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, flexDirection: 'row', alignItems: 'center' },
  xpText: { color: '#FFF', fontWeight: '700' },
  xpProgressContainer: { marginTop: 15 },
  xpProgressBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, overflow: 'hidden' },
  xpProgressFill: { height: '100%', backgroundColor: '#FFF', borderRadius: 4 },
  xpProgressText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 5, textAlign: 'center' },
  xpInfoLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 6 },
  xpInfoLinkText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, textDecorationLine: 'underline' },
  card: { marginHorizontal: 20, marginBottom: 15, borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginLeft: 10 },
  streakRow: { flexDirection: 'row', justifyContent: 'space-around' },
  streakItem: { alignItems: 'center', flex: 1 },
  streakDivider: { width: 1, backgroundColor: '#E0E0E0' },
  streakNumber: { fontSize: 28, fontWeight: 'bold', marginTop: 8 },
  streakLabel: { fontSize: 12, marginTop: 4 },
  challengeButton: { marginHorizontal: 20, marginBottom: 15, padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  challengeButtonText: { fontSize: 16, fontWeight: '600' },
  challengeName: { fontSize: 18, fontWeight: '700', marginBottom: 5 },
  challengeDesc: { fontSize: 14, color: '#666', marginBottom: 10 },
  challengeProgress: { flexDirection: 'row', alignItems: 'center' },
  challengeProgressBar: { flex: 1, height: 8, backgroundColor: '#E0E0E0', borderRadius: 4, overflow: 'hidden' },
  challengeProgressFill: { height: '100%', backgroundColor: '#FF9800', borderRadius: 4 },
  challengeProgressText: { marginLeft: 10, fontWeight: '600', color: '#E65100' },
  badgesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  badgeItem: { width: '25%', alignItems: 'center', marginBottom: 15 },
  badgeLocked: { opacity: 0.5 },
  badgeIcon: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  badgeName: { fontSize: 10, marginTop: 5, textAlign: 'center' },
  partnerInfo: { gap: 15 },
  partnerStats: { gap: 10 },
  partnerStat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  partnerStatText: { fontSize: 15 },
  removePartnerButton: { padding: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  removePartnerText: { fontWeight: '600' },
  pendingInvite: { padding: 15, borderRadius: 12, marginBottom: 15, alignItems: 'center' },
  pendingText: { fontSize: 14 },
  inviteCodeDisplay: { fontSize: 24, fontWeight: 'bold', marginTop: 5, letterSpacing: 2 },
  partnerButton: { padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  partnerButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  partnerExplainText: { fontSize: 14, lineHeight: 20, marginBottom: 15, textAlign: 'center' },
  partnerConnectedText: { fontSize: 15, fontWeight: '600', marginBottom: 15, textAlign: 'center' },
  leaderboard: { gap: 8 },
  leaderboardItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10 },
  leaderboardRank: { width: 30, fontWeight: 'bold' },
  leaderboardName: { flex: 1, fontWeight: '600' },
  leaderboardStats: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leaderboardStat: { fontSize: 12, marginRight: 8 },
  leaderboardXP: { fontWeight: '600' },
  bottomSpacer: { height: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, marginTop: 100 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  modalSubtitle: { fontSize: 14, marginBottom: 20, textAlign: 'center' },
  challengeList: { maxHeight: 300 },
  challengeOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderRadius: 12, marginBottom: 10 },
  challengeOptionName: { fontSize: 16, fontWeight: '600' },
  challengeOptionDesc: { fontSize: 13, marginTop: 4 },
  xpReward: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  xpRewardText: { fontWeight: '700', fontSize: 12 },
  modalCloseButton: { padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  modalCloseText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  inviteButton: { padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  inviteButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  orText: { textAlign: 'center', marginVertical: 15 },
  inputLabel: { fontSize: 14, marginBottom: 8 },
  codeInput: { borderWidth: 2, borderRadius: 12, padding: 15, fontSize: 20, textAlign: 'center', letterSpacing: 3 },
  acceptButton: { padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 15 },
  acceptButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  cancelButton: { padding: 16, alignItems: 'center' },
  cancelButtonText: { fontSize: 16 },
  qrCodeContainer: { alignSelf: 'center', padding: 15, borderRadius: 16, marginBottom: 20 },
  codeDisplayBox: { padding: 15, borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  codeLabel: { fontSize: 12, marginBottom: 5 },
  generatedCodeText: { fontSize: 32, fontWeight: 'bold', letterSpacing: 4 },
  shareMethodsTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  shareButtonsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 15 },
  shareMethodButton: { width: '48%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 12, marginBottom: 10, gap: 8 },
  shareMethodText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  copyCodeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 12, borderWidth: 2, gap: 8, marginBottom: 10 },
  copyCodeText: { fontSize: 15, fontWeight: '600' },
  newCodeButton: { padding: 10, alignItems: 'center' },
  newCodeText: { fontSize: 14 },
  badgeModalContent: { marginHorizontal: 30, marginTop: 'auto', marginBottom: 'auto', borderRadius: 24, padding: 24, alignItems: 'center' },
  badgeModalIcon: { width: 100, height: 100, borderRadius: 50, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  badgeModalEmoji: { fontSize: 48 },
  badgeModalTitle: { fontSize: 22, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  badgeStatusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginBottom: 16, gap: 6 },
  badgeStatusText: { fontSize: 14, fontWeight: '600' },
  badgeModalDescription: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 16 },
  badgeHintBox: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 12, marginBottom: 16, gap: 10 },
  badgeHintText: { flex: 1, fontSize: 14, lineHeight: 20 },
  badgeModalCloseButton: { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  badgeModalCloseText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  xpModalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, marginTop: 60, maxHeight: '85%' },
  xpModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 },
  xpModalTitle: { fontSize: 22, fontWeight: '700' },
  xpModalSubtitle: { fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  xpRewardsList: { maxHeight: 320, marginBottom: 16 },
  xpRewardItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 8 },
  xpRewardIconContainer: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  xpRewardInfo: { flex: 1 },
  xpRewardAction: { fontSize: 14, fontWeight: '600' },
  xpRewardBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  xpRewardAmount: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  xpTipBox: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, gap: 10, marginBottom: 16 },
  xpTipText: { flex: 1, fontSize: 14, lineHeight: 20 },
  xpModalCloseButton: { padding: 16, borderRadius: 12, alignItems: 'center' },
  xpModalCloseText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
