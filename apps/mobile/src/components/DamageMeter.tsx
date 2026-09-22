import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, getBudgetStatusColor } from '../theme/colors';
import { Money } from '@thassapay/money';

interface DamageMeterProps {
  spentPaise: number;
  budgetPaise: number;
  monthName?: string;
}

export const DamageMeter: React.FC<DamageMeterProps> = ({
  spentPaise,
  budgetPaise,
  monthName = 'SEPTEMBER',
}) => {
  const spentMoney = Money.fromPaise(BigInt(spentPaise));
  const budgetMoney = Money.fromPaise(BigInt(budgetPaise));
  const remainingPaise = Math.max(0, budgetPaise - spentPaise);
  const remainingMoney = Money.fromPaise(BigInt(remainingPaise));

  const percentUsed = budgetPaise > 0 ? Math.round((spentPaise / budgetPaise) * 100) : 0;
  const statusColor = getBudgetStatusColor(percentUsed);

  const isOverBudget = spentPaise > budgetPaise && budgetPaise > 0;
  const statusLabel = isOverBudget
    ? 'FINANCIALLY COOKED 💀'
    : percentUsed >= 90
      ? 'CRITICAL DAMAGE 🔥'
      : percentUsed >= 75
        ? 'CAUTIONARY ZONE ⚠️'
        : 'STILL ALIVE 🛡️';

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.monthText}>{monthName.toUpperCase()}</Text>
        <View style={[styles.badge, { backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.amountContainer}>
        <Text style={[styles.remainingAmount, { color: isOverBudget ? colors.brandPrimary : colors.textPrimary }]}>
          {remainingMoney.toFormattedString({ includeSymbol: true })}
        </Text>
        <Text style={styles.remainingSubtext}>REMAINING ALLOWANCE</Text>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(100, percentUsed)}%`,
              backgroundColor: statusColor,
            },
          ]}
        />
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.ratioText}>
          {spentMoney.toFormattedString({ includeSymbol: true })} / {budgetMoney.toFormattedString({ includeSymbol: true })} spent
        </Text>
        <Text style={[styles.percentText, { color: statusColor }]}>
          {percentUsed}% DAMAGE
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  monthText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1.5,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  amountContainer: {
    marginBottom: 16,
  },
  remainingAmount: {
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  remainingSubtext: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: 2,
  },
  progressTrack: {
    height: 10,
    backgroundColor: colors.surfaceLight,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ratioText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  percentText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
