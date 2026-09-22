import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { colors } from '../../theme/colors';
import { apiClient } from '../../services/api/apiClient';
import { vpaSchema } from '@thassapay/validation';
import { Money } from '@thassapay/money';

interface PayScreenProps {
  onPaymentInitiated: (paymentAttemptId: string, categoryId: string, amountPaise: number) => void;
  onCancel: () => void;
}

export const PayScreen: React.FC<PayScreenProps> = ({ onPaymentInitiated, onCancel }) => {
  const [rupeesInput, setRupeesInput] = useState('');
  const [upiId, setUpiId] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const cats = await apiClient.categories.getAll();
      setCategories(cats);
      if (cats.length > 0) {
        setSelectedCategoryId(cats[0].id);
      }
    } catch {
      // Ignored
    }
  };

  const handlePay = async () => {
    setError('');

    // 1. Amount validation
    if (!rupeesInput.trim()) {
      setError('Please enter payment amount');
      return;
    }

    let money: Money;
    try {
      money = Money.fromRupees(rupeesInput.trim());
      if (money.toPaise() <= 0n) {
        setError('Payment amount must be greater than zero');
        return;
      }
    } catch {
      setError('Invalid rupee format');
      return;
    }

    // 2. VPA / UPI ID validation
    const vpaRes = vpaSchema.safeParse(upiId.trim());
    if (!vpaRes.success) {
      setError('Invalid UPI VPA (e.g. name@upi, 9876543210@paytm, canteen@okaxis)');
      return;
    }

    if (!selectedCategoryId) {
      setError('Please select a category for this payment');
      return;
    }

    setIsLoading(true);
    try {
      const amountPaise = Number(money.toPaise());
      // Generate client idempotency key
      const idempotencyKey = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // 3. Create backend PaymentAttempt (state machine: INITIATED)
      const paymentAttempt = await apiClient.payments.create({
        upiId: upiId.trim(),
        amountPaise,
        idempotencyKey,
        referenceId: note.trim() || undefined,
      });

      // 4. Construct or use UPI URI
      // e.g. upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...
      const upiUrl = paymentAttempt.upiUri ||
        `upi://pay?pa=${encodeURIComponent(upiId.trim())}&pn=${encodeURIComponent('Merchant')}&am=${money.toRupees().toFixed(2)}&cu=INR&tn=${encodeURIComponent(note || 'ThassaPay')}`;

      const supported = await Linking.canOpenURL(upiUrl).catch(() => true);
      if (supported) {
        await Linking.openURL(upiUrl).catch(() => {
          // In simulator or environments without native UPI apps
          Alert.alert(
            'UPI App Not Found',
            'No external UPI app could be opened on this device simulator. Simulating payment return...',
          );
        });
      }

      // Notify return to payment state machine verification screen
      onPaymentInitiated(paymentAttempt.id, selectedCategoryId, amountPaise);
    } catch (err: any) {
      setError(err.message || 'Failed to initiate UPI payment');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTag}>UPI PAYMENT INITIATION</Text>
          <Text style={styles.title}>Scan & Pay UPI</Text>
        </View>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.securityNotice}>
        <Text style={styles.securityNoticeText}>
          🔒 ThassaPay initiates payments directly through your installed UPI apps. We never handle or touch your funds or PIN.
        </Text>
      </View>

      <View style={styles.amountBox}>
        <Text style={styles.amountCurrency}>₹</Text>
        <TextInput
          style={styles.amountInput}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          autoFocus
          value={rupeesInput}
          onChangeText={setRupeesInput}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PAYEE UPI ID (VPA)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. mess.canteen@okaxis or 9876543210@paytm"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={upiId}
          onChangeText={setUpiId}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>CATEGORY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          {categories.map((cat) => {
            const isSelected = selectedCategoryId === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.catChip, isSelected && styles.catChipSelected]}
                onPress={() => setSelectedCategoryId(cat.id)}
              >
                <Text style={styles.catEmoji}>{cat.icon || '💸'}</Text>
                <Text style={[styles.catName, isSelected && styles.catNameSelected]}>
                  {cat.name.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>NOTE / REFERENCE (OPTIONAL)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Night canteen bill"
          placeholderTextColor={colors.textMuted}
          value={note}
          onChangeText={setNote}
        />
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.payButton, isLoading && styles.disabledButton]}
        onPress={handlePay}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.payButtonText}>⚡ LAUNCH UPI APP →</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 24,
    paddingTop: 50,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.brandUpi,
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  cancelText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  securityNotice: {
    backgroundColor: 'rgba(108, 92, 231, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(108, 92, 231, 0.3)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  securityNoticeText: {
    fontSize: 12,
    color: '#A29BFE',
    lineHeight: 18,
    fontWeight: '500',
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  amountCurrency: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.brandUpi,
    marginRight: 8,
  },
  amountInput: {
    fontSize: 48,
    fontWeight: '900',
    color: colors.textPrimary,
    minWidth: 120,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  categoryScroll: {
    paddingBottom: 4,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    marginRight: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catChipSelected: {
    borderColor: colors.brandUpi,
    backgroundColor: '#1B172E',
  },
  catEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  catName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  catNameSelected: {
    color: colors.textPrimary,
  },
  errorText: {
    color: colors.textDanger,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14,
  },
  payButton: {
    backgroundColor: colors.brandUpi,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  disabledButton: {
    opacity: 0.6,
  },
  payButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
