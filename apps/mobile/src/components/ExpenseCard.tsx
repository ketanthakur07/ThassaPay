import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { Money } from '@thassapay/money';

interface ExpenseCardProps {
  id: string;
  amountPaise: number;
  categoryName: string;
  categoryIcon?: string;
  paymentMethod: string;
  description?: string;
  expenseDate: string;
  isDeleted?: boolean;
  onPress?: () => void;
}

export const ExpenseCard: React.FC<ExpenseCardProps> = ({
  amountPaise,
  categoryName,
  categoryIcon = '💸',
  paymentMethod,
  description,
  expenseDate,
  isDeleted,
  onPress,
}) => {
  const money = Money.fromPaise(BigInt(amountPaise));
  const formattedDate = new Date(expenseDate).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[styles.card, isDeleted && styles.deletedCard]}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.iconText}>{categoryIcon}</Text>
      </View>

      <View style={styles.infoContainer}>
        <View style={styles.titleRow}>
          <Text style={styles.categoryTitle} numberOfLines={1}>
            {categoryName.replace(/_/g, ' ')}
          </Text>
          <Text style={[styles.amountText, isDeleted && styles.deletedAmount]}>
            -{money.toFormattedString({ includeSymbol: true })}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.dateText}>{formattedDate}</Text>
          <View style={styles.methodBadge}>
            <Text style={styles.methodText}>{paymentMethod}</Text>
          </View>
        </View>

        {!!description && (
          <Text style={styles.descText} numberOfLines={1}>
            "{description}"
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  deletedCard: {
    opacity: 0.5,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 22,
  },
  infoContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.brandPrimary,
  },
  deletedAmount: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  methodBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  methodText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  descText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
