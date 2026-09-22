import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { useAuth } from '../state/AuthContext';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { HomeScreen } from '../screens/home/HomeScreen';
import { ExpensesScreen } from '../screens/expenses/ExpensesScreen';
import { AddExpenseScreen } from '../screens/expenses/AddExpenseScreen';
import { PayScreen } from '../screens/pay/PayScreen';
import { PaymentResultScreen } from '../screens/pay/PaymentResultScreen';
import { AnalyticsScreen } from '../screens/analytics/AnalyticsScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';

type Tab = 'HOME' | 'EXPENSES' | 'PAY' | 'ANALYTICS' | 'PROFILE';

export const RootNavigator: React.FC = () => {
  const { isAuthenticated, isOnboarded, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('HOME');
  const [isAddExpenseVisible, setIsAddExpenseVisible] = useState(false);

  // Active payment state for UPI flow
  const [activePayment, setActivePayment] = useState<{
    id: string;
    categoryId: string;
    amountPaise: number;
  } | null>(null);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  if (!isOnboarded) {
    return <OnboardingScreen />;
  }

  if (isAddExpenseVisible) {
    return (
      <AddExpenseScreen
        onSuccess={() => {
          setIsAddExpenseVisible(false);
          setActiveTab('HOME');
        }}
        onCancel={() => setIsAddExpenseVisible(false)}
      />
    );
  }

  if (activePayment) {
    return (
      <PaymentResultScreen
        paymentAttemptId={activePayment.id}
        categoryId={activePayment.categoryId}
        amountPaise={activePayment.amountPaise}
        onDone={() => {
          setActivePayment(null);
          setActiveTab('HOME');
        }}
      />
    );
  }

  const renderCurrentScreen = () => {
    switch (activeTab) {
      case 'HOME':
        return (
          <HomeScreen
            onNavigateToPay={() => setActiveTab('PAY')}
            onNavigateToAddExpense={() => setIsAddExpenseVisible(true)}
            onNavigateToExpenses={() => setActiveTab('EXPENSES')}
          />
        );
      case 'EXPENSES':
        return <ExpensesScreen />;
      case 'PAY':
        return (
          <PayScreen
            onPaymentInitiated={(id, categoryId, amountPaise) => {
              setActivePayment({ id, categoryId, amountPaise });
            }}
            onCancel={() => setActiveTab('HOME')}
          />
        );
      case 'ANALYTICS':
        return <AnalyticsScreen />;
      case 'PROFILE':
        return <ProfileScreen />;
      default:
        return <HomeScreen onNavigateToPay={() => {}} onNavigateToAddExpense={() => {}} onNavigateToExpenses={() => {}} />;
    }
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'HOME', label: 'Damage', icon: '🔥' },
    { id: 'EXPENSES', label: 'Evidence', icon: '📋' },
    { id: 'PAY', label: 'Pay UPI', icon: '⚡' },
    { id: 'ANALYTICS', label: 'Analytics', icon: '📊' },
    { id: 'PROFILE', label: 'Profile', icon: '👤' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.screenArea}>{renderCurrentScreen()}</View>

      {/* Bottom Navigation Bar */}
      <View style={styles.navBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isPayTab = tab.id === 'PAY';
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.navItem, isPayTab && styles.payNavItem]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[styles.navIcon, isPayTab && styles.payNavIcon]}>{tab.icon}</Text>
              <Text
                style={[
                  styles.navLabel,
                  isActive && styles.navLabelActive,
                  isPayTab && styles.payNavLabel,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  screenArea: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 20,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  navLabelActive: {
    color: colors.brandPrimary,
  },
  payNavItem: {
    transform: [{ translateY: -4 }],
  },
  payNavIcon: {
    fontSize: 24,
  },
  payNavLabel: {
    color: colors.brandUpi,
    fontWeight: '800',
  },
});
