import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { storage } from '../services/storage';
import { apiClient } from '../services/api/apiClient';
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
    } catch {
      // Token invalid or expired
      await storage.removeAccessToken();
      await storage.removeUserSession();
      setUser(null);
      setIsAuthenticated(false);
      setIsOnboarded(false);
    } finally {
      setIsLoading(false);
    }
  };

  const requestOtp = async (phone: string) => {
    return apiClient.auth.requestOtp(phone);
  };

  const verifyOtp = async (phone: string, otp: string) => {
    const res = await apiClient.auth.verifyOtp(phone, otp);
    await storage.setAccessToken(res.accessToken);
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
    await storage.removeAccessToken();
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
