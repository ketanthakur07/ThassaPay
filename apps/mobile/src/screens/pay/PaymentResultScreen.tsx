import React, { useState, useEffect, useRef } from 'react';
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

type Phase =
  | 'REPORTING_RETURN' // calling backend after UPI app returned
  | 'NEEDS_REVIEW' // backend says: user must answer "did it go through?"
  | 'CONFIRMED' // backend state machine says SUCCESS (only after /confirm)
  | 'FAILED'; // backend says FAILED/CANCELLED — never guessed client-side

/**
 * Audit rewrite (P0/P1) of the payment-result flow. Previous version:
 *  - sent { status: 'USER_RETURNED' } — a field the backend never read, so the
 *    unvalidated union defaulted every real return to FAILED;
 *  - could never reach NEEDS_REVIEW before the 10-minute sweep, so the
 *    confirm screen was unreachable in real use;
 *  - on ANY error (including network loss) it showed FAILED — asserting the
 *    opposite of the truth ("payment did not happen") with zero evidence.
 *
 * Now: every state change is driven by the backend's authoritative response.
 * Unknown states resolve to NEEDS_REVIEW (honest "we don't know yet"), and
 * reconciliation remains the safety net for abandoned attempts.
 */
export const PaymentResultScreen: React.FC<PaymentResultScreenProps> = ({
  paymentAttemptId,
  categoryId,
  amountPaise,
  onDone,
}) => {
  const [phase, setPhase] = useState<Phase>('REPORTING_RETURN');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [roast, setRoast] = useState<{
    roastText: string;
    toneUsed: RoastTone;
    intensity: RoastIntensity;
    damageScore: number;
  } | null>(null);
  const didReport = useRef(false); // guards against double-run of useEffect in React StrictMode/remounts

  const money = Money.fromPaise(BigInt(amountPaise));

  useEffect(() => {
    handleAppReturn();
  }, []);

  const handleAppReturn = async () => {
    // Idempotency guard: a remount must not report the return twice.
    if (didReport.current) return;
    didReport.current = true;

    try {
      // Audit fix: send the outcome enum the backend actually validates.
      // We report app_returned_ok because the UPI app handed control back —
      // this only means AWAITING_CONFIRMATION, never SUCCESS.
      await apiClient.payments.reportReturn(paymentAttemptId, 'app_returned_ok');
    } catch {
      // Return-report failed (network drop / token expiry / already swept).
      // The backend still owns the truth: ask it directly.
      try {
        const current = await apiClient.payments.get(paymentAttemptId);
        if (current.status === PaymentStatus.NEEDS_REVIEW) {
          setPhase('NEEDS_REVIEW');
          return;
        }
        if (current.status === PaymentStatus.SUCCESS) {
          setPhase('CONFIRMED');
          return;
        }
        if (current.status === PaymentStatus.FAILED || current.status === PaymentStatus.CANCELLED) {
          setPhase('FAILED');
          return;
        }
        // INITIATED / AWAITING_CONFIRMATION: push it into review explicitly.
        await apiClient.payments.review(paymentAttemptId);
      } catch {
        // Backend unreachable: stay honest — we do NOT know the outcome.
        setPhase('NEEDS_REVIEW');
        setErrorMsg(
          'Network problem while checking your payment. Nothing has been recorded yet — confirm below only if you are sure the payment went through.',
        );
        return;
      }
    }

    try {
      await apiClient.payments.review(paymentAttemptId);
      setPhase('NEEDS_REVIEW');
    } catch {
      // If review transition fails because the sweep already moved it, the
      // attempt is already NEEDS_REVIEW — show the question either way.
      setPhase('NEEDS_REVIEW');
    }
  };

  const handleConfirm = async (didSucceed: boolean) => {
    setIsProcessing(true);
    setErrorMsg('');
    try {
      const res = await apiClient.payments.confirm(paymentAttemptId, {
        didSucceed,
        categoryId,
        description: 'UPI Payment',
      });

      if (didSucceed && res.status === 'SUCCESS') {
        setPhase('CONFIRMED');

        // Roast is cosmetic — never let it block or fail the financial truth.
        try {
          const roastRes = await apiClient.roasts.generate({
            amountPaise,
            categoryName: 'FOOD_SWIGGY_ZOMATO',
            monthlySpendPaise: amountPaise,
            tone: RoastTone.BRUTAL,
          });
          setRoast(roastRes);
        } catch {
          // No roast is acceptable; a missing roast must never hide the result.
        }
      } else if (res.status === 'FAILED') {
        setPhase('FAILED');
      } else {
        // Unexpected backend state: keep the user in review, not in a lie.
        setPhase('NEEDS_REVIEW');
      }
    } catch {
      // Confirm call itself failed — the attempt's backend state is unchanged.
      // Stay in review so the user can retry; never flip to FAILED.
      setErrorMsg('Could not record your answer. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.statusBadgeRow}>
          <PaymentStatusBadge status={phase === 'REPORTING_RETURN' ? 'AWAITING_CONFIRMATION' : phase === 'CONFIRMED' ? 'SUCCESS' : phase === 'FAILED' ? 'FAILED' : 'NEEDS_REVIEW'} />
        </View>

        <Text style={styles.amountText}>
          {money.toFormattedString({ includeSymbol: true })}
        </Text>

        {phase === 'REPORTING_RETURN' && (
          <View style={styles.card}>
            <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 20 }} />
            <Text style={styles.reviewSub}>Checking with your bank records…</Text>
          </View>
        )}

        {phase === 'NEEDS_REVIEW' && (
          <View style={styles.card}>
            <Text style={styles.reviewHeading}>DID THIS PAYMENT ACTUALLY GO THROUGH?</Text>
            <Text style={styles.reviewSub}>
              UPI apps return without letting us peek into your bank balance. Tell us the truth so your budget stays accurate.
            </Text>
            {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

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

        {phase === 'CONFIRMED' && (
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

        {phase === 'FAILED' && (
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
  errorText: {
    color: colors.textDanger,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
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
