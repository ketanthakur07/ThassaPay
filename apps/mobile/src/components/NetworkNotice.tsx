import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

interface NetworkNoticeProps {
  message?: string;
}

export const NetworkNotice: React.FC<NetworkNoticeProps> = ({
  message = 'Network vanished. Money has not necessarily vanished. Do not pay again blindly.',
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📡</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2C1B1F',
    borderWidth: 1,
    borderColor: '#7A222B',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 18,
    marginRight: 10,
  },
  message: {
    fontSize: 13,
    color: '#FF7675',
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
});
