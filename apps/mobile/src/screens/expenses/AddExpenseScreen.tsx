import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { colors } from '../../theme/colors';
import { apiClient } from '../../services/api/apiClient';
import { Money } from '@thassapay/money';
import { RoastCard } from '../../components/RoastCard';
import { RoastTone, RoastIntensity } from '@thassapay/types';

interface AddExpenseScreenProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const AddExpenseScreen: React.FC<AddExpenseScreenProps> = ({ onSuccess, onCancel }) => {
  const [rupeesInput, setRupeesInput] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string; icon: string; isDefault: boolean }>>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH' | 'CARD' | 'OTHER'>('UPI');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Post-expense roast modal state
  const [roastModal, setRoastModal] = useState<{
    visible: boolean;
    roastText: string;
    tone: RoastTone;
    intensity: RoastIntensity;
    damageScore: number;
  }>({
    visible: false,
    roastText: '',
    tone: RoastTone.BRUTAL,
    intensity: RoastIntensity.MILD,
    damageScore: 0,
  });

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

  const handleSave = async () => {
    setError('');
    if (!rupeesInput.trim()) {
      setError('Please enter an amount');
      return;
    }

    let money: Money;
    try {
      money = Money.fromRupees(rupeesInput.trim());
      if (money.toPaise() <= 0n) {
        setError('Amount must be greater than zero');
        return;
      }
    } catch {
      setError('Invalid rupee amount format');
      return;
    }

    if (!selectedCategoryId) {
      setError('Please select an expense category');
      return;
    }

    setIsLoading(true);
    try {
      const amountPaise = Number(money.toPaise());
      const selectedCat = categories.find((c) => c.id === selectedCategoryId);

      await apiClient.expenses.create({
        categoryId: selectedCategoryId,
        amountPaise,
        paymentMethod,
        description: description.trim() || undefined,
      });

      // Generate instant roast for the damage caused
      const roast = await apiClient.roasts.generate({
        amountPaise,
        categoryName: selectedCat?.name || 'DEFAULT',
        monthlySpendPaise: amountPaise,
        tone: RoastTone.BRUTAL,
      });

      setRoastModal({
        visible: true,
        roastText: roast.roastText,
        tone: roast.toneUsed,
        intensity: roast.intensity,
        damageScore: roast.damageScore,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record expense');
    } finally {
      setIsLoading(false);
    }
  };

  const methods: ('UPI' | 'CASH' | 'CARD' | 'OTHER')[] = ['UPI', 'CASH', 'CARD', 'OTHER'];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Record Damage</Text>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
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
        <Text style={styles.sectionLabel}>PAYMENT METHOD</Text>
        <View style={styles.methodRow}>
          {methods.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.methodChip, paymentMethod === m && styles.methodChipSelected]}
              onPress={() => setPaymentMethod(m)}
            >
              <Text style={[styles.methodText, paymentMethod === m && styles.methodTextSelected]}>
                {m}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>NOTE / VENDOR</Text>
        <TextInput
          style={styles.noteInput}
          placeholder="e.g. 2 Butter Chicken + Garlic Naan"
          placeholderTextColor={colors.textMuted}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submitButton, isLoading && styles.disabledButton]}
        onPress={handleSave}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.submitButtonText}>RECORD EXPENSE 💸</Text>
        )}
      </TouchableOpacity>

      {/* Instant Roast Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={roastModal.visible}
        onRequestClose={() => {
          setRoastModal((prev) => ({ ...prev, visible: false }));
          onSuccess();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.roastDialog}>
            <Text style={styles.damageConfirmedTitle}>💥 DAMAGE RECORDED</Text>
            <RoastCard
              roastText={roastModal.roastText}
              tone={roastModal.tone}
              intensity={roastModal.intensity}
              damageScore={roastModal.damageScore}
            />
            <TouchableOpacity
              style={styles.roastDismissButton}
              onPress={() => {
                setRoastModal((prev) => ({ ...prev, visible: false }));
                onSuccess();
              }}
            >
              <Text style={styles.roastDismissText}>ACCEPT REALITY & CONTINUE →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    marginBottom: 24,
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
    color: colors.brandPrimary,
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
    borderColor: colors.brandPrimary,
    backgroundColor: '#1E1420',
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
  methodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  methodChip: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  methodChipSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surfaceLight,
  },
  methodText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
  },
  methodTextSelected: {
    color: colors.brandPrimary,
  },
  noteInput: {
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
  errorText: {
    color: colors.textDanger,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14,
  },
  submitButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  disabledButton: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    padding: 24,
  },
  roastDialog: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  damageConfirmedTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.brandPrimary,
    textAlign: 'center',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  roastDismissButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  roastDismissText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
