import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { RoastIntensity, RoastTone } from '@thassapay/types';

interface RoastCardProps {
  roastText: string;
  tone?: RoastTone;
  intensity?: RoastIntensity;
  damageScore?: number;
}

export const RoastCard: React.FC<RoastCardProps> = ({
  roastText,
  tone = RoastTone.BRUTAL,
  intensity = RoastIntensity.MILD,
  damageScore,
}) => {
  const getIntensityColor = () => {
    switch (intensity) {
      case RoastIntensity.NUCLEAR:
        return colors.brandPrimary;
      case RoastIntensity.SPICY:
        return colors.brandOrange;
      default:
        return colors.brandYellow;
    }
  };

  const color = getIntensityColor();

  return (
    <View style={[styles.card, { borderColor: `${color}44` }]}>
      <View style={styles.headerRow}>
        <View style={styles.badgeRow}>
          <Text style={styles.fireEmoji}>🔥</Text>
          <Text style={[styles.badgeText, { color }]}>
            {intensity.toUpperCase()} ROAST
          </Text>
        </View>
        <Text style={styles.toneText}>{tone.replace(/_/g, ' ')}</Text>
      </View>

      <Text style={styles.roastQuote}>"{roastText}"</Text>

      {damageScore !== undefined && (
        <View style={styles.damageFooter}>
          <Text style={styles.damageScoreText}>
            Damage Impact: <Text style={{ color, fontWeight: '800' }}>{damageScore}/100</Text>
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#17141D',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  fireEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  toneText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  roastQuote: {
    fontSize: 15,
    lineHeight: 22,
    color: '#F5F6FA',
    fontStyle: 'italic',
    fontWeight: '500',
  },
  damageFooter: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 8,
  },
  damageScoreText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
