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
  Linking,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useRouter } from 'expo-router';
import { COLOR_PALETTES } from '../contexts/SettingsContext';
import { useTranslation } from 'react-i18next';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function PremiumScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState<any>(null);
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const PREMIUM_FEATURES = [
    { icon: 'sparkles', title: t('premium.feature_ai_analysis'), description: t('premium.feature_ai_analysis_desc') },
    { icon: 'chatbubbles', title: t('premium.feature_ai_coach'), description: t('premium.feature_ai_coach_desc') },
    { icon: 'location', title: t('premium.feature_location'), description: t('premium.feature_location_desc') },
    { icon: 'stats-chart', title: t('premium.feature_stats'), description: t('premium.feature_stats_desc') },
    { icon: 'analytics', title: t('premium.feature_mood'), description: t('premium.feature_mood_desc') },
    { icon: 'cloud-upload', title: t('premium.feature_backup'), description: t('premium.feature_backup_desc') },
    { icon: 'download', title: t('premium.feature_export'), description: t('premium.feature_export_desc') },
    { icon: 'medal', title: t('premium.feature_badges'), description: t('premium.feature_badges_desc') },
  ];

  const FREE_FEATURES = [
    { icon: 'checkmark-circle', title: t('premium.free_habits'), description: t('premium.free_habits_desc') },
    { icon: 'color-palette', title: t('premium.free_themes'), description: t('premium.free_themes_desc') },
    { icon: 'time', title: t('premium.free_time'), description: t('premium.free_time_desc') },
    { icon: 'bar-chart', title: t('premium.free_stats'), description: t('premium.free_stats_desc') },
    { icon: 'people', title: t('premium.free_companion'), description: t('premium.free_companion_desc') },
  ];

  const colors = settings?.appearance?.color_palette 
    ? (COLOR_PALETTES[settings.appearance.color_palette] || COLOR_PALETTES.sonnenuntergang)
    : COLOR_PALETTES.sonnenuntergang;

  const fetchSubscriptionStatus = useCallback(async () => {
    try {
      const id = await AsyncStorage.getItem('deviceId');
      if (!id) {
        setLoading(false);
        return;
      }
      setDeviceId(id);

      const [subRes, settingsRes] = await Promise.all([
        axios.get(`${API_URL}/api/subscription/${id}`),
        axios.get(`${API_URL}/api/settings/${id}`),
      ]);

      setIsPremium(subRes.data.is_premium);
      setSubscriptionInfo(subRes.data);
      setSettings(settingsRes.data);
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSubscriptionStatus();
  }, [fetchSubscriptionStatus]);

  const redeemPromoCode = async () => {
    if (!promoCode.trim()) {
      Alert.alert(t('common.note'), t('premium.enter_code_hint'));
      return;
    }

    setRedeeming(true);
    try {
      const response = await axios.post(`${API_URL}/api/subscription/redeem-promo`, {
        device_id: deviceId,
        code: promoCode.trim().toUpperCase(),
      });

      Alert.alert(t('premium.redeem_success') + ' 🎉', response.data.message);
      setPromoCode('');
      fetchSubscriptionStatus();
    } catch (error: any) {
      const message = error.response?.data?.detail || t('premium.redeem_error');
      Alert.alert(t('common.error'), message);
    } finally {
      setRedeeming(false);
    }
  };

  const startStripeCheckout = async () => {
    setPaymentLoading('stripe');
    try {
      const response = await axios.post(`${API_URL}/api/subscription/stripe/create-checkout`, {
        device_id: deviceId,
        success_url: `${API_URL}/premium-success`,
        cancel_url: `${API_URL}/premium-cancel`,
      });

      if (response.data.checkout_url) {
        await Linking.openURL(response.data.checkout_url);
      }
    } catch (error: any) {
      const message = error.response?.data?.detail || t('premium.stripe_error');
      Alert.alert(t('common.error'), message);
    } finally {
      setPaymentLoading(null);
    }
  };

  const startPayPalCheckout = async () => {
    setPaymentLoading('paypal');
    try {
      const response = await axios.post(`${API_URL}/api/subscription/paypal/create-order`, {
        device_id: deviceId,
        return_url: `${API_URL}/paypal-success?device_id=${deviceId}`,
        cancel_url: `${API_URL}/paypal-cancel`,
      });

      if (response.data.approval_url) {
        await Linking.openURL(response.data.approval_url);
      }
    } catch (error: any) {
      const message = error.response?.data?.detail || t('premium.paypal_error');
      Alert.alert(t('common.error'), message);
    } finally {
      setPaymentLoading(null);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
          <Text style={[styles.title, { color: colors.text }]}>Premium</Text>
        </View>

        {isPremium ? (
          <View style={styles.content}>
            <View style={[styles.premiumBadge, { backgroundColor: '#FFD700' }]}>
              <Ionicons name="star" size={40} color="#FFF" />
            </View>
            <Text style={[styles.premiumTitle, { color: colors.text }]}>
              {t('premium.you_are_premium')} 🎉
            </Text>
            <Text style={[styles.premiumSubtitle, { color: colors.textLight }]}>
              {t('premium.thank_you')}
            </Text>

            <View style={[styles.subscriptionCard, { backgroundColor: colors.card }]}>
              <View style={styles.subscriptionRow}>
                <Text style={[styles.subscriptionLabel, { color: colors.textLight }]}>{t('premium.status')}</Text>
                <Text style={[styles.subscriptionValue, { color: colors.secondary }]}>{t('premium.active')} ✓</Text>
              </View>
              <View style={styles.subscriptionRow}>
                <Text style={[styles.subscriptionLabel, { color: colors.textLight }]}>{t('premium.type')}</Text>
                <Text style={[styles.subscriptionValue, { color: colors.text }]}>
                  {subscriptionInfo?.subscription_type === 'promo' ? 'Promo-Code' :
                   subscriptionInfo?.subscription_type === 'stripe' ? 'Stripe' :
                   subscriptionInfo?.subscription_type === 'paypal' ? 'PayPal' :
                   subscriptionInfo?.subscription_type === 'revenuecat' ? 'App Store' : 
                   'Premium'}
                </Text>
              </View>
              {subscriptionInfo?.expires_at && (
                <View style={styles.subscriptionRow}>
                  <Text style={[styles.subscriptionLabel, { color: colors.textLight }]}>{t('premium.valid_until')}</Text>
                  <Text style={[styles.subscriptionValue, { color: colors.text }]}>
                    {formatDate(subscriptionInfo.expires_at)}
                  </Text>
                </View>
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('premium.your_features')}</Text>
            {PREMIUM_FEATURES.map((feature, index) => (
              <View key={index} style={[styles.featureItem, { backgroundColor: colors.card }]}>
                <View style={[styles.featureIcon, { backgroundColor: colors.secondary + '20' }]}>
                  <Ionicons name={feature.icon as any} size={24} color={colors.secondary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>{feature.title}</Text>
                  <Text style={[styles.featureDescription, { color: colors.textLight }]}>
                    {feature.description}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={24} color={colors.secondary} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.content}>
            {/* Premium Banner */}
            <View style={[styles.premiumBanner, { backgroundColor: colors.primary }]}>
              <Ionicons name="sparkles" size={48} color="#FFF" />
              <Text style={styles.premiumBannerTitle}>Premium</Text>
              <Text style={styles.premiumBannerPrice}>€4,99/{t('premium.per_month')}</Text>
              <Text style={styles.premiumBannerSubtitle}>
                {t('premium.unlock_features')}
              </Text>
            </View>

            {/* Premium Features */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('premium.premium_features')}
            </Text>
            {PREMIUM_FEATURES.map((feature, index) => (
              <View key={index} style={[styles.featureItem, { backgroundColor: colors.card }]}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name={feature.icon as any} size={24} color={colors.primary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>{feature.title}</Text>
                  <Text style={[styles.featureDescription, { color: colors.textLight }]}>
                    {feature.description}
                  </Text>
                </View>
                <Ionicons name="lock-closed" size={20} color={colors.textLight} />
              </View>
            ))}

            {/* Payment Buttons */}
            <View style={styles.paymentSection}>
              <TouchableOpacity
                style={[styles.paymentButton, { backgroundColor: '#635BFF' }]}
                onPress={startStripeCheckout}
                disabled={paymentLoading !== null}
              >
                {paymentLoading === 'stripe' ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="card" size={24} color="#FFF" />
                    <Text style={styles.paymentButtonText}>
                      {t('premium.pay_with_stripe')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.paymentButton, { backgroundColor: '#0070BA' }]}
                onPress={startPayPalCheckout}
                disabled={paymentLoading !== null}
              >
                {paymentLoading === 'paypal' ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="logo-paypal" size={24} color="#FFF" />
                    <Text style={styles.paymentButtonText}>
                      {t('premium.pay_with_paypal')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Promo Code */}
            <View style={[styles.promoSection, { backgroundColor: colors.card }]}>
              <Text style={[styles.promoTitle, { color: colors.text }]}>
                {t('premium.promo_code_title')}
              </Text>
              <View style={styles.promoInputRow}>
                <TextInput
                  style={[styles.promoInput, { backgroundColor: colors.background, color: colors.text }]}
                  value={promoCode}
                  onChangeText={setPromoCode}
                  placeholder={t('premium.enter_code')}
                  placeholderTextColor={colors.textLight}
                  autoCapitalize="characters"
                  maxLength={20}
                />
                <TouchableOpacity
                  style={[styles.promoButton, { backgroundColor: colors.secondary }]}
                  onPress={redeemPromoCode}
                  disabled={redeeming}
                >
                  {redeeming ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={styles.promoButtonText}>{t('premium.redeem')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Free Features */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('premium.free_forever')}
            </Text>
            {FREE_FEATURES.map((feature, index) => (
              <View key={index} style={[styles.featureItem, { backgroundColor: colors.card }]}>
                <View style={[styles.featureIcon, { backgroundColor: colors.secondary + '20' }]}>
                  <Ionicons name={feature.icon as any} size={24} color={colors.secondary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={[styles.featureTitle, { color: colors.text }]}>{feature.title}</Text>
                  <Text style={[styles.featureDescription, { color: colors.textLight }]}>
                    {feature.description}
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={24} color={colors.secondary} />
              </View>
            ))}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
  content: { paddingHorizontal: 20 },
  premiumBadge: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 16 },
  premiumTitle: { fontSize: 28, fontWeight: 'bold', textAlign: 'center' },
  premiumSubtitle: { fontSize: 16, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  subscriptionCard: { borderRadius: 16, padding: 20, marginBottom: 24 },
  subscriptionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  subscriptionLabel: { fontSize: 14 },
  subscriptionValue: { fontSize: 14, fontWeight: '600' },
  premiumBanner: { borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 24 },
  premiumBannerTitle: { fontSize: 32, fontWeight: 'bold', color: '#FFF', marginTop: 12 },
  premiumBannerPrice: { fontSize: 24, fontWeight: '600', color: '#FFF', marginTop: 8 },
  premiumBannerSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16, marginTop: 8 },
  featureItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 12, marginBottom: 10 },
  featureIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 16, fontWeight: '600' },
  featureDescription: { fontSize: 13, marginTop: 2 },
  paymentSection: { marginVertical: 24, gap: 12 },
  paymentButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 12, gap: 10 },
  paymentButtonText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  promoSection: { borderRadius: 16, padding: 20, marginBottom: 24 },
  promoTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  promoInputRow: { flexDirection: 'row', gap: 10 },
  promoInput: { flex: 1, borderRadius: 10, padding: 14, fontSize: 16 },
  promoButton: { paddingHorizontal: 20, borderRadius: 10, justifyContent: 'center' },
  promoButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  bottomSpacer: { height: 30 },
});
