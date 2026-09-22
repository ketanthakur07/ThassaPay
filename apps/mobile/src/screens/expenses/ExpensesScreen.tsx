import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { colors } from '../../theme/colors';
import { apiClient } from '../../services/api/apiClient';
import { ExpenseCard } from '../../components/ExpenseCard';
import { Money } from '@thassapay/money';

export const ExpensesScreen: React.FC = () => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<any | null>(null);

  useEffect(() => {
    loadData();
  }, [selectedCategory]);

  const loadData = async () => {
    try {
      const [cats, exps] = await Promise.all([
        apiClient.categories.getAll(),
        apiClient.expenses.list({
          categoryId: selectedCategory === 'ALL' ? undefined : selectedCategory,
          limit: 100,
        }),
      ]);
      setCategories(cats);
      setExpenses(exps);
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleSoftDelete = async (id: string) => {
    try {
      await apiClient.expenses.delete(id);
      setSelectedExpense(null);
      loadData();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to delete expense');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTag}>FINANCIAL DAMAGE</Text>
        <Text style={styles.headerTitle}>Evidence & Transactions</Text>
      </View>

      {/* Category Filter Chips */}
      <View style={styles.filterScroll}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[{ id: 'ALL', name: 'ALL' }, ...categories]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isSelected = selectedCategory === item.id;
            return (
              <TouchableOpacity
                style={[styles.chip, isSelected && styles.chipActive]}
                onPress={() => setSelectedCategory(item.id)}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                  {item.name.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 20 }}
        />
      </View>

      {/* Expenses List */}
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                setIsRefreshing(true);
                loadData();
              }}
              tintColor={colors.brandPrimary}
            />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>Zero Damage Found</Text>
              <Text style={styles.emptySub}>No expenses match this category filter.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ExpenseCard
              id={item.id}
              amountPaise={item.amountPaise}
              categoryName={item.category?.name || 'Expense'}
              categoryIcon={item.category?.icon || '💸'}
              paymentMethod={item.paymentMethod}
              description={item.description}
              expenseDate={item.expenseDate}
              isDeleted={!!item.deletedAt}
              onPress={() => setSelectedExpense(item)}
            />
          )}
        />
      )}

      {/* Expense Detail & Action Modal */}
      {selectedExpense && (
        <Modal
          animationType="fade"
          transparent
          visible={!!selectedExpense}
          onRequestClose={() => setSelectedExpense(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalCategory}>
                {selectedExpense.category?.icon} {selectedExpense.category?.name?.replace(/_/g, ' ')}
              </Text>
              <Text style={styles.modalAmount}>
                {Money.fromPaise(BigInt(selectedExpense.amountPaise)).toFormattedString({ includeSymbol: true })}
              </Text>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment Method:</Text>
                <Text style={styles.detailValue}>{selectedExpense.paymentMethod}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Recorded Date:</Text>
                <Text style={styles.detailValue}>
                  {new Date(selectedExpense.expenseDate).toLocaleString('en-IN')}
                </Text>
              </View>

              {selectedExpense.description && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Note:</Text>
                  <Text style={styles.detailValue}>"{selectedExpense.description}"</Text>
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    Alert.alert(
                      'Remove Expense?',
                      'This expense will be soft-deleted and logged in the financial audit trail.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => handleSoftDelete(selectedExpense.id),
                        },
                      ],
                    );
                  }}
                >
                  <Text style={styles.deleteButtonText}>🗑️ Soft Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setSelectedExpense(null)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 12,
  },
  headerTag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.brandPrimary,
    letterSpacing: 1.5,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  filterScroll: {
    paddingBottom: 14,
  },
  chip: {
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#FFF',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  emptyBox: {
    padding: 40,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCategory: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  modalAmount: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.brandPrimary,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceLight,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 71, 87, 0.15)',
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 10,
  },
  deleteButtonText: {
    color: colors.brandPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  closeButton: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
});
