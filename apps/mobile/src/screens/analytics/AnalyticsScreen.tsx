import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { colors, getBudgetStatusColor } from '../../theme/colors';
import { apiClient } from '../../services/api/apiClient';
import { Money } from '@thassapay/money';

export const AnalyticsScreen: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [summary, setSummary] = useState<{
    month: string;
    totalSpentPaise: number;
    budgetLimitPaise: number;
    damageScore: number;
    categoryBreakdown: Array<{ categoryId: string; categoryName: string; amountPaise: number }>;
    transactionCount: number;
  }>({
    month: new Date().toISOString().slice(0, 7),
    totalSpentPaise: 0,
    budgetLimitPaise: 1000000,
    damageScore: 0,
    categoryBreakdown: [],
    transactionCount: 0,
  });

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const res = await apiClient.analytics.getSummary(currentMonth);
      setSummary(res);
    } catch {
      // Ignored
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const spentMoney = Money.fromPaise(BigInt(summary.totalSpentPaise));
  const budgetMoney = Money.fromPaise(BigInt(summary.budgetLimitPaise));
  const scoreColor = getBudgetStatusColor(summary.damageScore);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => {
            setIsRefreshing(true);
            loadAnalytics();
          }}
          tintColor={colors.brandPrimary}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.tag}>NUMBERS DON'T LIE</Text>
        <Text style={styles.title}>Post-Mortem & Analytics</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Damage Score Gauge */}
          <View style={styles.gaugeCard}>
            <Text style={styles.gaugeLabel}>FINANCIAL DAMAGE SCORE</Text>
            <Text style={[styles.gaugeScore, { color: scoreColor }]}>
              {summary.damageScore}
              <Text style={styles.gaugeMax}> / 100</Text>
            </Text>
            <Text style={styles.gaugeSummary}>
              {summary.damageScore >= 90
                ? '💀 Critical life support. Immediate freeze on all food delivery recommended.'
                : summary.damageScore >= 70
                  ? '🔥 High damage. You are spending like it is day 1 of allowance.'
                  : summary.damageScore >= 50
                    ? '⚠️ Moderate damage. Watch the weekend canteen trips.'
                    : '🛡️ Healthy. Mess food is doing its job.'}
            </Text>
          </View>

          {/* Quick Metrics Grid */}
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>TOTAL DAMAGE</Text>
              <Text style={styles.statValue}>
                {spentMoney.toFormattedString({ includeSymbol: true })}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>MONTHLY BUDGET</Text>
              <Text style={styles.statValue}>
                {budgetMoney.toFormattedString({ includeSymbol: true })}
              </Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>TRANSACTIONS</Text>
              <Text style={styles.statValue}>{summary.transactionCount} times</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>TOP EXPENSE CATEGORY</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {summary.categoryBreakdown[0]?.categoryName?.replace(/_/g, ' ') || 'None'}
              </Text>
            </View>
          </View>

          {/* Category Breakdown Bars */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>WHERE DID THE MONEY DISAPPEAR?</Text>
            <View style={styles.breakdownCard}>
              {summary.categoryBreakdown.length === 0 ? (
                <Text style={styles.emptyText}>No category data yet.</Text>
              ) : (
                summary.categoryBreakdown.map((cat) => {
                  const catMoney = Money.fromPaise(BigInt(cat.amountPaise));
                  const percentage =
                    summary.totalSpentPaise > 0
                      ? Math.round((cat.amountPaise / summary.totalSpentPaise) * 100)
                      : 0;

                  return (
                    <View key={cat.categoryId} style={styles.catRow}>
                      <View style={styles.catMeta}>
                        <Text style={styles.catName}>{cat.categoryName.replace(/_/g, ' ')}</Text>
                        <Text style={styles.catAmount}>
                          {catMoney.toFormattedString({ includeSymbol: true })} ({percentage}%)
                        </Text>
                      </View>
                      <View style={styles.catTrack}>
                        <View
                          style={[
                            styles.catBar,
                            { width: `${percentage}%`, backgroundColor: colors.brandPrimary },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  tag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.brandPrimary,
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  gaugeCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginBottom: 20,
  },
  gaugeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  gaugeScore: {
    fontSize: 54,
    fontWeight: '900',
    letterSpacing: -1,
  },
  gaugeMax: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textMuted,
  },
  gaugeSummary: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  sectionContainer: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  breakdownCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catRow: {
    marginBottom: 14,
  },
  catMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  catName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  catAmount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  catTrack: {
    height: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  catBar: {
    height: '100%',
    borderRadius: 4,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
