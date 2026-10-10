import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { colors } from '../../theme/colors';
import { useAuth } from '../../state/AuthContext';
import { indianPhoneSchema } from '@thassapay/validation';

export const LoginScreen: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [devOtpHint, setDevOtpHint] = useState('');

  const handleRequestOtp = async () => {
    setErrorMessage('');
    const validation = indianPhoneSchema.safeParse(phoneNumber);
    if (!validation.success) {
      setErrorMessage('Please enter a valid 10-digit Indian phone number');
      return;
    }

    setIsLoading(true);
    try {
      const res = await requestOtp(phoneNumber);
      if (res.devOtp) {
        setDevOtpHint(res.devOtp);
      }
      setStep('otp');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to request OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMessage('');
    if (otp.length !== 6) {
      setErrorMessage('OTP must be 6 digits');
      return;
    }

    setIsLoading(true);
    try {
      await verifyOtp(phoneNumber, otp);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Invalid or expired OTP');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.logoBadge}>THASSAPAY</Text>
          <Text style={styles.title}>Track your damage.{'\n'}Pay through UPI.</Text>
          <Text style={styles.subtitle}>
            Hostel-first finance app. Get roasted for your midnight Swiggy orders.
          </Text>
        </View>

        <View style={styles.card}>
          {step === 'phone' ? (
            <>
              <Text style={styles.label}>MOBILE NUMBER</Text>
              <View style={styles.phoneInputRow}>
                <View style={styles.prefixContainer}>
                  <Text style={styles.prefixText}>+91</Text>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="9876543210"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  editable={!isLoading}
                />
              </View>

              {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

              <TouchableOpacity
                style={[styles.primaryButton, isLoading && styles.disabledButton]}
                onPress={handleRequestOtp}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.buttonText}>GET OTP →</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.otpHeader}>
                <Text style={styles.label}>ENTER 6-DIGIT OTP</Text>
                <TouchableOpacity onPress={() => setStep('phone')}>
                  <Text style={styles.changePhoneText}>Edit phone</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={[styles.input, styles.otpInput]}
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={setOtp}
                editable={!isLoading}
              />

              {!!devOtpHint && (
                <View style={styles.devHintBox}>
                  <Text style={styles.devHintText}>💡 Dev OTP auto-filled: {devOtpHint}</Text>
                  <TouchableOpacity onPress={() => setOtp(devOtpHint)}>
                    <Text style={styles.devHintAction}>Tap to use</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

              <TouchableOpacity
                style={[styles.primaryButton, isLoading && styles.disabledButton]}
                onPress={handleVerifyOtp}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.buttonText}>VERIFY & ENTER →</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.footerNotice}>
          <Text style={styles.footerNoticeText}>
            🔒 Financial Safety: ThassaPay never asks for your UPI PIN, ATM PIN, or banking passwords.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 32,
  },
  logoBadge: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.brandPrimary,
    letterSpacing: 2,
    marginBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.textPrimary,
    lineHeight: 38,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  phoneInputRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  prefixContainer: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    marginRight: 10,
  },
  prefixText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  otpInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: 16,
  },
  otpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  changePhoneText: {
    fontSize: 12,
    color: colors.brandUpi,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  errorText: {
    color: colors.textDanger,
    fontSize: 13,
    marginBottom: 12,
    fontWeight: '600',
  },
  devHintBox: {
    backgroundColor: 'rgba(255, 165, 2, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 2, 0.3)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  devHintText: {
    color: colors.brandOrange,
    fontSize: 12,
    fontWeight: '600',
  },
  devHintAction: {
    color: colors.brandOrange,
    fontSize: 12,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  footerNotice: {
    paddingHorizontal: 12,
  },
  footerNoticeText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    textAlign: 'center',
  },
});
