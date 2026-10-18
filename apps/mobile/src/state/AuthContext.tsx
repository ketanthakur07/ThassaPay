import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { storage } from '../services/storage';
import { apiClient, onSessionExpired, isSessionRejection } from '../services/api/apiClient';
import { RoastTone } from '@thassapay/types';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  // The API returns null for unset optional columns, never `undefined`.
  phone?: string | null;
  hostelBlock?: string | null;
  roomNo?: string | null;
  preferredRoastTone?: RoastTone;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isOnboarded: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  requestOtp: (phone: string) => Promise<{ message: string; devOtp?: string }>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  updateProfile: (data: {
    name?: string;
    hostelBlock?: string;
    roomNo?: string;
    preferredRoastTone?: RoastTone;
  }) => Promise<void>;
  completeOnboarding: (data: {
    name: string;
    hostelBlock: string;
    roomNo: string;
    budgetRupees: number;
    roastTone: RoastTone;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isOnboarded, setIsOnboarded] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    bootstrapSession();
    // When a refresh is definitively rejected the apiClient clears tokens and
    // fires this — drop the user back to login wherever they are in the app.
    const unsubscribe = onSessionExpired(() => {
      setUser(null);
      setIsAuthenticated(false);
      setIsOnboarded(false);
    });
    return unsubscribe;
  }, []);

  const bootstrapSession = async () => {
    try {
      const token = await storage.getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      const me = await apiClient.users.getMe();
      setUser(me);
      setIsAuthenticated(true);
      // If user has set hostelBlock or name is customized, considered onboarded
      setIsOnboarded(!!me.hostelBlock);
    } catch (error) {
      if (isSessionRejection(error)) {
        // DEFINITIVE: the server rejected this session (rotated/revoked/
        // expired) — apiClient already cleared it; drop local state too.
        await storage.clearTokens();
        await storage.removeUserSession();
        setUser(null);
        setIsAuthenticated(false);
        setIsOnboarded(false);
      } else {
        // TRANSIENT: offline start, timeout, 5xx or a secure-storage read
        // failure. The persisted session may be perfectly valid — a failed
        // startup must NOT log the user out. Keep the tokens and fall back to
        // the cached profile when we have one; the next successful call (or
        // the 401 refresh path) decides for real.
        const cached = await storage.getUserSession().catch(() => null);
        const restored: AuthUser | null =
          cached &&
          typeof cached.id === 'string' &&
          cached.id &&
          typeof cached.name === 'string' &&
          typeof cached.email === 'string'
            ? { ...cached, id: cached.id, name: cached.name, email: cached.email }
            : null;
        if (restored) {
          setUser(restored);
          setIsAuthenticated(true);
          setIsOnboarded(!!restored.hostelBlock);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const requestOtp = async (phone: string) => {
    return apiClient.auth.requestOtp(phone);
  };

  const verifyOtp = async (phone: string, otp: string) => {
    const res = await apiClient.auth.verifyOtp(phone, otp);
    // Persist the pair as ONE atomic secure write. If SecureStore fails we must
    // NOT report a successful login — a half-persisted session (or a refresh
    // token that only lives in memory) would silently break on next launch.
    // Re-throw so the login screen can show a safe, actionable message.
    await storage.saveTokenPair({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
    });
    await storage.setUserSession(res.user);
    setUser(res.user);
    setIsAuthenticated(true);
    setIsOnboarded(!!res.user.hostelBlock);
  };

  const updateProfile = async (data: {
    name?: string;
    hostelBlock?: string;
    roomNo?: string;
    preferredRoastTone?: RoastTone;
  }) => {
    const updated = await apiClient.users.updateProfile(data);
    setUser(updated);
    await storage.setUserSession(updated);
  };

  const completeOnboarding = async (data: {
    name: string;
    hostelBlock: string;
    roomNo: string;
    budgetRupees: number;
    roastTone: RoastTone;
  }) => {
    const updated = await apiClient.users.updateProfile({
      name: data.name,
      hostelBlock: data.hostelBlock,
      roomNo: data.roomNo,
      preferredRoastTone: data.roastTone,
    });
    setUser(updated);
    await storage.setUserSession(updated);

    // Set initial monthly budget in paise (e.g. ₹10,000 * 100 paise)
    const currentMonth = new Date().toISOString().slice(0, 7);
    await apiClient.budgets.set(currentMonth, data.budgetRupees * 100);

    setIsOnboarded(true);
  };

  const logout = async () => {
    // Revoke server-side FIRST so the refresh token cannot be replayed. Read
    // it before clearing local state; if the network is down we still clear
    // locally (the token expires within 15 min anyway) rather than trap the
    // user in a half-logged-in state.
    const refreshToken = await storage.getRefreshToken();
    if (refreshToken) {
      try {
        await apiClient.auth.logout(refreshToken);
      } catch {
        // Best-effort: proceed to local cleanup regardless.
      }
    }
    await storage.clearTokens();
    await storage.removeUserSession();
    setUser(null);
    setIsAuthenticated(false);
    setIsOnboarded(false);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isOnboarded,
        isLoading,
        user,
        requestOtp,
        verifyOtp,
        updateProfile,
        completeOnboarding,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
