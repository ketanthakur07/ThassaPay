import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { PaymentStatus } from '@thassapay/types';

interface PaymentStatusBadgeProps {
  status: PaymentStatus | string;
}

export const PaymentStatusBadge: React.FC<PaymentStatusBadgeProps> = ({ status }) => {
  const getBadgeConfig = () => {
    switch (status) {
      case PaymentStatus.CONFIRMED:
      case 'SUCCESS':
        return { label: 'CONFIRMED', color: colors.statusSuccess, bg: 'rgba(46, 213, 115, 0.15)' };
      case PaymentStatus.PENDING_VERIFICATION:
      case 'AWAITING_CONFIRMATION':
        return { label: 'AWAITING CONFIRMATION', color: colors.statusInitiated, bg: 'rgba(255, 165, 2, 0.15)' };
      case 'NEEDS_REVIEW':
        return { label: 'NEEDS REVIEW', color: colors.statusReview, bg: 'rgba(224, 86, 253, 0.15)' };
      case PaymentStatus.FAILED:
      case 'FAILED':
        return { label: 'FAILED', color: colors.statusFailed, bg: 'rgba(255, 71, 87, 0.15)' };
      default:
        return { label: 'INITIATED', color: colors.brandBlue, bg: 'rgba(30, 144, 255, 0.15)' };
    }
  };

  const config = getBadgeConfig();

  return (
    <View style={[styles.badge, { backgroundColor: config.bg, borderColor: `${config.color}44` }]}>
      <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
