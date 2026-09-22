import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { colors } from '../../theme/colors';
import { useAuth } from '../../state/AuthContext';
import { apiClient } from '../../services/api/apiClient';
import { RoastTone } from '@thassapay/types';

export const ProfileScreen: React.FC = () => {
  const { user, updateProfile, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [hostelBlock, setHostelBlock] = useState(user?.hostelBlock || '');
  const [roomNo, setRoomNo] = useState(user?.roomNo || '');
  const [roastTone, setRoastTone] = useState<RoastTone>(
    user?.preferredRoastTone || RoastTone.BRUTAL,
  );
  const [budgetRupees, setBudgetRupees] = useState('10000');
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    loadBudget();
  }, []);

  const loadBudget = async () => {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const b = await apiClient.budgets.get(currentMonth);
      if (b?.amountPaise) {
        setBudgetRupees(String(b.amountPaise / 100));
      }
    } catch {
      // Ignored
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSuccessMsg('');
    try {
      await updateProfile({
        name: name.trim(),
        hostelBlock: hostelBlock.trim(),
        roomNo: roomNo.trim(),
        preferredRoastTone: roastTone,
      });

      const budgetVal = parseInt(budgetRupees, 10);
      if (!isNaN(budgetVal) && budgetVal > 0) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        await apiClient.budgets.set(currentMonth, budgetVal * 100);
      }

      setSuccessMsg('Profile & roast settings updated!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  const tones: { label: string; tone: RoastTone }[] = [
    { label: 'Brutal 🔥', tone: RoastTone.BRUTAL },
    { label: 'Sardonic 😒', tone: RoastTone.SARDONIC },
    { label: 'Disappointed Parent 👵', tone: RoastTone.DISAPPOINTED_PARENT },
    { label: 'Financial Guru 📈', tone: RoastTone.FINANCIAL_GURU },
    { label: 'Gentle 🕊️', tone: RoastTone.GENTLE },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.tag}>SETTINGS</Text>
        <Text style={styles.title}>Hostel & Roast Profile</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionHeader}>STUDENT INFORMATION</Text>

        <Text style={styles.label}>FULL NAME</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholderTextColor={colors.textMuted}
        />

        <View style={styles.rowInputs}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.label}>HOSTEL BLOCK</Text>
            <TextInput
              style={styles.input}
              value={hostelBlock}
              onChangeText={setHostelBlock}
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={{ width: 110 }}>
            <Text style={styles.label}>ROOM NO.</Text>
            <TextInput
              style={styles.input}
              value={roomNo}
              onChangeText={setRoomNo}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        <Text style={styles.label}>MONTHLY ALLOWANCE (₹)</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={budgetRupees}
          onChangeText={setBudgetRupees}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionHeader}>ROAST ENGINE PREFERENCES</Text>
        <Text style={styles.sectionSub}>
          Choose how fiercely ThassaPay attacks your late-night expenditures.
        </Text>

        {tones.map((t) => {
          const isSelected = roastTone === t.tone;
          return (
            <TouchableOpacity
              key={t.tone}
              style={[styles.toneRow, isSelected && styles.toneRowActive]}
              onPress={() => setRoastTone(t.tone)}
            >
              <Text style={[styles.toneText, isSelected && styles.toneTextActive]}>
                {t.label}
              </Text>
              <View style={[styles.radio, isSelected && styles.radioActive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {!!successMsg && <Text style={styles.successText}>✅ {successMsg}</Text>}

      <TouchableOpacity
        style={[styles.saveButton, isSaving && styles.disabledBtn]}
        onPress={handleSave}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.saveButtonText}>SAVE PREFERENCES 💾</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutButtonText}>LOGOUT SESSION 🚪</Text>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionSub: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 14,
    lineHeight: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 14,
    fontWeight: '600',
  },
  rowInputs: {
    flexDirection: 'row',
  },
  toneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  toneRowActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: '#1E1420',
  },
  toneText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  toneTextActive: {
    color: colors.textPrimary,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  radioActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimary,
  },
  saveButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  logoutButton: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: colors.textDanger,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  successText: {
    color: colors.brandGreen,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
});
