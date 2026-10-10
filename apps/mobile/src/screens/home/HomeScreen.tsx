import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../../theme/colors';
import { useAuth } from '../../state/AuthContext';
import { apiClient, ExpenseRecord } from '../../services/api/apiClient';
import { DamageMeter } from '../../components/DamageMeter';
import { RoastCard } from '../../components/RoastCard';
import { ExpenseCard } from '../../components/ExpenseCard';
import { NetworkNotice } from '../../components/NetworkNotice';
import { Money } from '@thassapay/money';
import { RoastTone, RoastIntensity } from '@thassapay/types';

interface HomeScreenProps {
  onNavigateToPay: () => void;
  onNavigateToAddExpense: () => void;
  onNavigateToExpenses: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigateToPay,
  onNavigateToAddExpense,
  onNavigateToExpenses,
}) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  const [summary, setSummary] = useState<{
    month: string;
    totalSpentPaise: number;
    budgetLimitPaise: number;
    damageScore: number;
    categoryBreakdown: Array<{ categoryId: string; categoryName: string; amountPaise: number }>;
  }>({
    month: new Date().toISOString().slice(0, 7),
    totalSpentPaise: 0,
    budgetLimitPaise: 1000000, // Default ₹10,000
    damageScore: 0,
    categoryBreakdown: [],
  });

  const [recentExpenses, setRecentExpenses] = useState<ExpenseRecord[]>([]);
  const [currentRoast, setCurrentRoast] = useState<{
    roastText: string;
    toneUsed: RoastTone;
    intensity: RoastIntensity;
    damageScore: number;
  }>({
    roastText: 'Month has started. Try not to blow your allowance on day three.',
    toneUsed: RoastTone.BRUTAL,
    intensity: RoastIntensity.MILD,
    damageScore: 10,
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setNetworkError(false);
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const [sum, expenses] = await Promise.all([
        apiClient.analytics.getSummary(currentMonth),
        apiClient.expenses.list({ month: currentMonth, limit: 5 }),
      ]);

      setSummary(sum);
      setRecentExpenses(expenses);

      // Fetch dynamic roast based on current spending
      const roast = await apiClient.roasts.generate({
        amountPaise: sum.totalSpentPaise,
        categoryName: sum.categoryBreakdown[0]?.categoryName || 'DEFAULT',
        monthlySpendPaise: sum.totalSpentPaise,
        monthlyBudgetPaise: sum.budgetLimitPaise,
        tone: user?.preferredRoastTone || RoastTone.BRUTAL,
      });
      setCurrentRoast(roast);
    } catch {
      setNetworkError(true);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const onRefresh = () => {
    setIsRefreshing(true);
    loadDashboardData();
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const currentMonthName = monthNames[new Date().getMonth()];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
      }
    >
      {/* Header */}
      <View style={styles.userBar}>
        <View>
          <Text style={styles.hostelTag}>
            {user?.hostelBlock ? `${user.hostelBlock} • Room ${user.roomNo}` : 'HOSTEL APARTMENT'}
          </Text>
          <Text style={styles.greetingText}>Hey, {user?.name?.split(' ')[0] || 'Hosteller'} 👋</Text>
        </View>
        <TouchableOpacity style={styles.quickPayButton} onPress={onNavigateToPay}>
          <Text style={styles.quickPayText}>⚡ PAY UPI</Text>
        </TouchableOpacity>
      </View>

      {networkError && <NetworkNotice />}

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* Main Damage Progress & Remaining Allowance */}
          <DamageMeter
            spentPaise={summary.totalSpentPaise}
            budgetPaise={summary.budgetLimitPaise}
            monthName={currentMonthName}
          />

          {/* Dynamic Roast Engine Banner */}
          <RoastCard
            roastText={currentRoast.roastText}
            tone={currentRoast.toneUsed}
            intensity={currentRoast.intensity}
            damageScore={currentRoast.damageScore}
          />

          {/* Quick Action Bar */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtnPrimary} onPress={onNavigateToPay}>
              <Text style={styles.actionBtnText}>⚡ Scan & Pay UPI</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtnSecondary} onPress={onNavigateToAddExpense}>
              <Text style={styles.actionBtnSecText}>+ Add Expense</Text>
            </TouchableOpacity>
          </View>

          {/* Financial Damage Category Breakdown */}
          {summary.categoryBreakdown.length > 0 && (
            <View style={styles.sectionContainer}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>FINANCIAL DAMAGE BREAKDOWN</Text>
              </View>

              <View style={styles.categoryCard}>
                {summary.categoryBreakdown.slice(0, 4).map((cat) => {
                  const catMoney = Money.fromPaise(BigInt(cat.amountPaise));
                  return (
                    <View key={cat.categoryId} style={styles.categoryRow}>
                      <Text style={styles.categoryName} numberOfLines={1}>
                        {cat.categoryName.replace(/_/g, ' ')}
                      </Text>
                      <Text style={styles.categoryAmount}>
                        {catMoney.toFormattedString({ includeSymbol: true })}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Recent Evidence / Expenses */}
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>EVIDENCE (RECENT EXPENSES)</Text>
              <TouchableOpacity onPress={onNavigateToExpenses}>
                <Text style={styles.seeAllText}>See all →</Text>
              </TouchableOpacity>
            </View>

            {recentExpenses.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No expenses recorded yet. Your wallet rests in peace.</Text>
              </View>
            ) : (
              recentExpenses.map((exp) => (
                <ExpenseCard
                  key={exp.id}
                  id={exp.id}
                  amountPaise={exp.amountPaise}
                  categoryName={exp.category?.name || 'Expense'}
                  categoryIcon={exp.category?.icon || '💸'}
                  paymentMethod={exp.paymentMethod}
                  description={exp.description}
                  expenseDate={exp.expenseDate}
                  isDeleted={!!exp.deletedAt}
                />
              ))
            )}
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
  userBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  hostelTag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  greetingText: {
    fontSize: 22,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  quickPayButton: {
    backgroundColor: colors.brandUpi,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  quickPayText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionRow: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  actionBtnPrimary: {
    flex: 1,
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginRight: 10,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionBtnSecText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  sectionContainer: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1.2,
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.brandPrimary,
  },
  categoryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceLight,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
