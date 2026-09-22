export const config = {
  // Use EXPO_PUBLIC_API_URL or fallback to localhost:3000
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000',
  apiTimeoutMs: 10000,
  defaultCurrency: 'INR',
  appName: 'ThassaPay',
};
