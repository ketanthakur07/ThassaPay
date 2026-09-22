export const colors = {
  background: '#0D0F17',
  surface: '#161B26',
  surfaceLight: '#202736',
  border: '#2A3346',
  borderLight: '#39445C',

  // Brand / Financial Damage Palette
  brandPrimary: '#FF4757', // Damage Crimson
  brandUpi: '#6C5CE7', // UPI Accent
  brandOrange: '#FFA502', // Swiggy / Caution Amber
  brandGreen: '#2ED573', // Still Alive Green
  brandBlue: '#1E90FF', // Information Blue
  brandYellow: '#ECCC68', // Gentle Alert

  // Typography
  textPrimary: '#FFFFFF',
  textSecondary: '#8E9AAF',
  textMuted: '#576574',
  textDanger: '#FF6B81',

  // Statuses
  statusInitiated: '#FFA502',
  statusSuccess: '#2ED573',
  statusFailed: '#FF4757',
  statusReview: '#E056FD',

  // Budget threshold colors
  budgetNormal: '#2ED573',
  budgetCaution: '#FFA502',
  budgetWarning: '#FF7F50',
  budgetCritical: '#FF4757',
  budgetExceeded: '#9B0000',
};

export const getBudgetStatusColor = (percentage: number) => {
  if (percentage >= 100) return colors.budgetExceeded;
  if (percentage >= 90) return colors.budgetCritical;
  if (percentage >= 75) return colors.budgetWarning;
  if (percentage >= 50) return colors.budgetCaution;
  return colors.budgetNormal;
};
