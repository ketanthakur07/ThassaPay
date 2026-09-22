import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../../theme/colors';
import { apiClient } from '../../services/api/apiClient';
import { Money } from '@thassapay/money';
import { RoastCard } from '../../components/RoastCard';
import { PaymentStatusBadge } from '../../components/PaymentStatusBadge';
import { PaymentStatus, RoastTone, RoastIntensity } from '@thassapay/types';

interface PaymentResultScreenProps {
  paymentAttemptId: string;
  categoryId: string;
  amountPaise: number;
  onDone: () => void;
}

export const PaymentResultScreen: React.FC<PaymentResultScreenProps> = ({
  paymentAttemptId,
  categoryId,
  amountPaise,
  onDone,
}) => {
  const [status, setStatus] = useState<PaymentStatus | 'NEEDS_REVIEW'>(PaymentStatus.INITIATED);
  const [isProcessing, setIsProcessing] = useState(false);
  const [roast, setRoast] = useState<{
    roastText: string;
    toneUsed: RoastTone;
    intensity: RoastIntensity;
    damageScore: number;
  } | null>(null);

  const money = Money.fromPaise(BigInt(amountPaise));

  useEffect(() => {
    // When returning from UPI app, report return to backend
    handleAppReturn();
  }, []);

  const handleAppReturn = async () => {
    try {
      // Transition INITIATED -> AWAITING_CONFIRMATION / NEEDS_REVIEW
      await apiClient.payments.reportReturn(paymentAttemptId, {
        status: 'USER_RETURNED',
      });
      setStatus('NEEDS_REVIEW');
    } catch {
      setStatus('NEEDS_REVIEW');
    }
  };

  const handleConfirm = async (didSucceed: boolean) => {
    setIsProcessing(true);
    try {
      const res = await apiClient.payments.confirm(paymentAttemptId, {
        didSucceed,
        categoryId,
        description: didSucceed ? 'UPI Payment' : 'UPI Payment Failed',
      });

      if (didSucceed && res.status === 'SUCCESS') {
        setStatus(PaymentStatus.CONFIRMED);

        // Fetch roast for successful payment
        const roastRes = await apiClient.roasts.generate({
          amountPaise,
          categoryName: 'FOOD_SWIGGY_ZOMATO', // or selected category
          monthlySpendPaise: amountPaise,
          tone: RoastTone.BRUTAL,
        });
        setRoast(roastRes);
      } else {
        setStatus(PaymentStatus.FAILED);
      }
    } catch {
      setStatus(PaymentStatus.FAILED);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.statusBadgeRow}>
          <PaymentStatusBadge status={status} />
        </View>

        <Text style={styles.amountText}>
          {money.toFormattedString({ includeSymbol: true })}
        </Text>

        {status === 'NEEDS_REVIEW' && (
          <View style={styles.card}>
            <Text style={styles.reviewHeading}>DID THIS PAYMENT ACTUALLY GO THROUGH?</Text>
            <Text style={styles.reviewSub}>
              UPI apps return without letting us peek into your bank balance. Tell us the truth so your budget stays accurate.
            </Text>

            {isProcessing ? (
              <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.reviewActions}>
                <TouchableOpacity
                  style={styles.confirmSuccessBtn}
                  onPress={() => handleConfirm(true)}
                >
                  <Text style={styles.confirmSuccessText}>✅ YES, I PAID</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.confirmFailBtn}
                  onPress={() => handleConfirm(false)}
                >
                  <Text style={styles.confirmFailText}>❌ NO, IT FAILED / CANCELLED</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {status === PaymentStatus.CONFIRMED && (
          <View style={styles.card}>
            <Text style={styles.successHeading}>PAYMENT CONFIRMED 🎉</Text>
            <Text style={styles.successSub}>
              Expense recorded into your financial evidence.
            </Text>

            {roast && (
              <View style={{ marginTop: 16 }}>
                <RoastCard
                  roastText={roast.roastText}
                  tone={roast.toneUsed}
                  intensity={roast.intensity}
                  damageScore={roast.damageScore}
                />
              </View>
            )}

            <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
              <Text style={styles.doneBtnText}>VIEW DASHBOARD DAMAGE →</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === PaymentStatus.FAILED && (
          <View style={styles.card}>
            <Text style={styles.failedHeading}>PAYMENT NOT RECORDED</Text>
            <Text style={styles.failedSub}>
              No funds were recorded against your budget. Try again or check your UPI app.
            </Text>

            <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
              <Text style={styles.doneBtnText}>RETURN TO DASHBOARD →</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
  },
  statusBadgeRow: {
    marginBottom: 16,
  },
  amountText: {
    fontSize: 44,
    fontWeight: '900',
    color: colors.textPrimary,
    marginBottom: 24,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  reviewHeading: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.brandOrange,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  reviewSub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
  },
  reviewActions: {
    width: '100%',
  },
  confirmSuccessBtn: {
    backgroundColor: colors.brandGreen,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmSuccessText: {
    color: '#0D0F17',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  confirmFailBtn: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmFailText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  successHeading: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.brandGreen,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 6,
  },
  successSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  failedHeading: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.brandPrimary,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 6,
  },
  failedSub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  doneBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  doneBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
