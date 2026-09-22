import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../../theme/colors';
import { useAuth } from '../../state/AuthContext';
import { RoastTone } from '@thassapay/types';

export const OnboardingScreen: React.FC = () => {
  const { completeOnboarding, user } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [hostelBlock, setHostelBlock] = useState('');
  const [roomNo, setRoomNo] = useState('');
  const [budgetRupees, setBudgetRupees] = useState('10000');
  const [roastTone, setRoastTone] = useState<RoastTone>(RoastTone.BRUTAL);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const tones: { label: string; tone: RoastTone; desc: string }[] = [
    { label: 'Brutal 🔥', tone: RoastTone.BRUTAL, desc: 'Zero mercy. Reality check.' },
    { label: 'Sardonic 😒', tone: RoastTone.SARDONIC, desc: 'Hostel sarcasm & eye-rolls.' },
    { label: 'Disappointed Parent 👵', tone: RoastTone.DISAPPOINTED_PARENT, desc: 'Is this why we sent you to college?' },
    { label: 'Financial Guru 📈', tone: RoastTone.FINANCIAL_GURU, desc: 'Pretending you understand SIPs.' },
    { label: 'Gentle 🕊️', tone: RoastTone.GENTLE, desc: 'Soft reminders.' },
  ];

  const handleSubmit = async () => {
    if (!name.trim() || !hostelBlock.trim() || !roomNo.trim()) {
      setError('Please fill in your name, hostel block and room number');
      return;
    }

    const budget = parseInt(budgetRupees, 10);
    if (isNaN(budget) || budget <= 0) {
      setError('Please enter a valid monthly budget amount');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await completeOnboarding({
        name: name.trim(),
        hostelBlock: hostelBlock.trim(),
        roomNo: roomNo.trim(),
        budgetRupees: budget,
        roastTone,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to complete profile setup');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.tag}>ONBOARDING</Text>
        <Text style={styles.title}>Hostel Profile Setup</Text>
        <Text style={styles.subtitle}>
          Tell us where you live so we can accurately roast your canteen bills.
        </Text>
      </View>

      <View style={styles.formSection}>
        <Text style={styles.label}>YOUR NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Ketan Sharma"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />

        <View style={styles.rowInputs}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.label}>HOSTEL BLOCK</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Block C / MH-2"
              placeholderTextColor={colors.textMuted}
              value={hostelBlock}
              onChangeText={setHostelBlock}
            />
          </View>
          <View style={{ width: 110 }}>
            <Text style={styles.label}>ROOM NO.</Text>
            <TextInput
              style={styles.input}
              placeholder="304"
              placeholderTextColor={colors.textMuted}
              value={roomNo}
              onChangeText={setRoomNo}
            />
          </View>
        </View>

        <Text style={styles.label}>MONTHLY ALLOWANCE / BUDGET (₹)</Text>
        <TextInput
          style={styles.input}
          placeholder="10000"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          value={budgetRupees}
          onChangeText={setBudgetRupees}
        />

        <Text style={[styles.label, { marginTop: 10 }]}>PICK YOUR ROAST PERSONALITY</Text>
        {tones.map((t) => (
          <TouchableOpacity
            key={t.tone}
            style={[styles.toneOption, roastTone === t.tone && styles.toneOptionSelected]}
            onPress={() => setRoastTone(t.tone)}
          >
            <View style={styles.toneTextRow}>
              <Text style={styles.toneLabel}>{t.label}</Text>
              <Text style={styles.toneDesc}>{t.desc}</Text>
            </View>
            <View style={[styles.radio, roastTone === t.tone && styles.radioActive]} />
          </TouchableOpacity>
        ))}

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.disabledButton]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitButtonText}>FINALIZE & ENTER DASHBOARD 🚀</Text>
          )}
        </TouchableOpacity>
      </View>
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
    paddingTop: 60,
  },
  header: {
    marginBottom: 24,
  },
  tag: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.brandPrimary,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  formSection: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
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
    marginBottom: 16,
    fontWeight: '600',
  },
  rowInputs: {
    flexDirection: 'row',
  },
  toneOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  toneOptionSelected: {
    borderColor: colors.brandPrimary,
    backgroundColor: '#1E1724',
  },
  toneTextRow: {
    flex: 1,
  },
  toneLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  toneDesc: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  radioActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandPrimary,
  },
  submitButton: {
    backgroundColor: colors.brandPrimary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  disabledButton: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  errorText: {
    color: colors.textDanger,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
});
