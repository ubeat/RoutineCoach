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

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const PREMIUM_FEATURES = [
  { icon: 'sparkles', title: 'KI-Wochenanalyse', description: 'Personalisierte Auswertung deiner Fortschritte' },
  { icon: 'chatbubbles', title: 'KI-Coach', description: 'Lösungsorientierter Coaching-Dialog' },
  { icon: 'location', title: 'Orts-Erinnerungen', description: 'Erinnerungen wenn du an bestimmten Orten bist' },
  { icon: 'stats-chart', title: 'Erweiterte Statistiken', description: 'Monats- und Jahresübersichten' },
  { icon: 'analytics', title: 'Stimmungs-Analyse', description: 'Erkenne wann du dich am besten fühlst' },
  { icon: 'cloud-upload', title: 'Cloud-Backup', description: 'Sichere deine Daten in der Cloud' },
  { icon: 'download', title: 'Daten-Export', description: 'Exportiere als PDF oder CSV' },
  { icon: 'medal', title: 'Alle 20+ Badges', description: 'Schalte alle Abzeichen frei' },
];

const FREE_FEATURES = [
  { icon: 'checkmark-circle', title: '3 Gewohnheiten', description: 'Optimal für nachhaltigen Erfolg' },
  { icon: 'color-palette', title: 'Alle Themes', description: 'Personalisiere deine App' },
  { icon: 'time', title: 'Zeit-Erinnerungen', description: 'Tägliche Benachrichtigungen' },
  { icon: 'bar-chart', title: 'Wochen-Statistik', description: 'Dein Fortschritt auf einen Blick' },
  { icon: 'people', title: 'Wegbegleiter/in', description: 'Gemeinsam stark bleiben' },
];

export default function PremiumScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState<any>(null);
  const [promoCode, setPromoCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

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
      Alert.alert('Hinweis', 'Bitte gib einen Promo-Code ein.');
      return;
    }

    setRedeeming(true);
    try {
      const response = await axios.post(`${API_URL}/api/subscription/redeem-promo`, {
        device_id: deviceId,
        code: promoCode.trim().toUpperCase(),
      });

      Alert.alert('Erfolg! 🎉', response.data.message);
      setPromoCode('');
      fetchSubscriptionStatus();
    } catch (error: any) {
      const message = error.response?.data?.detail || 'Code konnte nicht eingelöst werden.';
      Alert.alert('Fehler', message);
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
      const message = error.response?.data?.detail || 'Stripe-Zahlung konnte nicht gestartet werden.';
      Alert.alert('Fehler', message);
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
      const message = error.response?.data?.detail || 'PayPal-Zahlung konnte nicht gestartet werden.';
      Alert.alert('Fehler', message);
    } finally {
      setPaymentLoading(null);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
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
          // Premium User View
          <View style={styles.content}>
            <View style={[styles.premiumBadge, { backgroundColor: '#FFD700' }]}>
              <Ionicons name="star" size={40} color="#FFF" />
            </View>
            <Text style={[styles.premiumTitle, { color: colors.text }]}>
              Du bist Premium! 🎉
            </Text>
            <Text style={[styles.premiumSubtitle, { color: colors.textLight }]}>
              Vielen Dank für deine Unterstützung!
            </Text>

            <View style={[styles.subscriptionCard, { backgroundColor: colors.card }]}>
              <View style={styles.subscriptionRow}>
                <Text style={[styles.subscriptionLabel, { color: colors.textLight }]}>Status</Text>
                <Text style={[styles.subscriptionValue, { color: colors.secondary }]}>Aktiv ✓</Text>
              </View>
              <View style={styles.subscriptionRow}>
                <Text style={[styles.subscriptionLabel, { color: colors.textLight }]}>Typ</Text>
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
                  <Text style={[styles.subscriptionLabel, { color: colors.textLight }]}>Gültig bis</Text>
                  <Text style={[styles.subscriptionValue, { color: colors.text }]}>
                    {formatDate(subscriptionInfo.expires_at)}
                  </Text>
                </View>
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: colors.text }]}>Deine Features</Text>
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
          // Non-Premium User View
          <View style={styles.content}>
            {/* Premium Banner */}
            <View style={[styles.premiumBanner, { backgroundColor: colors.primary }]}>
              <Ionicons name="diamond" size={48} color="#FFF" />
              <Text style={styles.bannerTitle}>Schritt für Schritt Premium</Text>
              <Text style={styles.bannerSubtitle}>Dein persönlicher KI-Coach</Text>
              <View style={styles.priceContainer}>
                <Text style={styles.price}>4,99€</Text>
                <Text style={styles.priceUnit}>/Monat</Text>
              </View>
            </View>

            {/* Features */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Was du bekommst</Text>
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
              </View>
            ))}

            {/* Promo Code */}
            <View style={[styles.promoSection, { backgroundColor: colors.card }]}>
              <Text style={[styles.promoTitle, { color: colors.text }]}>
                Hast du einen Promo-Code?
              </Text>
              <View style={styles.promoInputRow}>
                <TextInput
                  style={[styles.promoInput, { 
                    borderColor: colors.primary, 
                    color: colors.text,
                    backgroundColor: colors.background 
                  }]}
                  value={promoCode}
                  onChangeText={setPromoCode}
                  placeholder="CODE EINGEBEN"
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
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.promoButtonText}>Einlösen</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Payment Options */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Zahlungsmethode wählen</Text>

            {/* Stripe */}
            <TouchableOpacity
              style={[styles.paymentButton, { backgroundColor: '#635BFF' }]}
              onPress={startStripeCheckout}
              disabled={paymentLoading !== null}
            >
              {paymentLoading === 'stripe' ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="card" size={24} color="#FFF" />
                  <View style={styles.paymentButtonContent}>
                    <Text style={styles.paymentButtonTitle}>Kreditkarte / SEPA</Text>
                    <Text style={styles.paymentButtonSubtitle}>via Stripe</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#FFF" />
                </>
              )}
            </TouchableOpacity>

            {/* PayPal */}
            <TouchableOpacity
              style={[styles.paymentButton, { backgroundColor: '#003087' }]}
              onPress={startPayPalCheckout}
              disabled={paymentLoading !== null}
            >
              {paymentLoading === 'paypal' ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="logo-paypal" size={24} color="#FFF" />
                  <View style={styles.paymentButtonContent}>
                    <Text style={styles.paymentButtonTitle}>PayPal</Text>
                    <Text style={styles.paymentButtonSubtitle}>Schnell & sicher</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#FFF" />
                </>
              )}
            </TouchableOpacity>

            {/* In-App Purchase hint for native */}
            {Platform.OS !== 'web' && (
              <TouchableOpacity
                style={[styles.paymentButton, { backgroundColor: colors.text }]}
                disabled={true}
              >
                <Ionicons name="phone-portrait" size={24} color="#FFF" />
                <View style={styles.paymentButtonContent}>
                  <Text style={styles.paymentButtonTitle}>In-App Kauf</Text>
                  <Text style={styles.paymentButtonSubtitle}>Demnächst verfügbar</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Terms */}
            <Text style={[styles.termsText, { color: colors.textLight }]}>
              Mit dem Kauf stimmst du unseren Nutzungsbedingungen zu. Das Abo verlängert sich automatisch, 
              kann aber jederzeit gekündigt werden. Preise inkl. MwSt.
            </Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
  },
  backButton: {
    marginRight: 15,
    padding: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  content: {
    paddingHorizontal: 20,
  },
  premiumBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  premiumTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  premiumSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  subscriptionCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  subscriptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  subscriptionLabel: {
    fontSize: 14,
  },
  subscriptionValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  premiumBanner: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  bannerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 12,
  },
  bannerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 4,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 16,
  },
  price: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFF',
  },
  priceUnit: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    marginTop: 8,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 13,
  },
  promoSection: {
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    marginBottom: 24,
  },
  promoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  promoInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  promoInput: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 2,
    fontWeight: '600',
  },
  promoButton: {
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 100,
  },
  promoButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  paymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 14,
    marginBottom: 12,
  },
  paymentButtonContent: {
    flex: 1,
    marginLeft: 14,
  },
  paymentButtonTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  paymentButtonSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },
  termsText: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 16,
    paddingHorizontal: 10,
  },
  bottomSpacer: {
    height: 40,
  },
});
