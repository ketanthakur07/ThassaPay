import { RoastTone } from '@thassapay/types';

/**
 * Storage service for mobile application.
 * Manages JWT tokens, current user session, and onboarding status.
 * Safe across web, testing, and native environments.
 */

/**
 * Session shape persisted to storage. Mirrors the API's /v1/users/me payload;
 * kept structurally identical to AuthContext's AuthUser so the two cannot drift.
 */
export interface StoredUser {
  // Partial on purpose: this is the cached session blob, and tests round-trip
  // arbitrary shapes through it. AuthContext is what enforces its own AuthUser.
  id?: string;
  name?: string;
  email?: string;
  phone?: string | null;
  hostelBlock?: string | null;
  roomNo?: string | null;
  preferredRoastTone?: RoastTone;
}

class StorageService {
  private memoryStore: Map<string, string> = new Map();

  async getItem(key: string): Promise<string | null> {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch {
      // Ignore fallback to memory
    }
    return this.memoryStore.get(key) || null;
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {
      // Ignore
    }
    this.memoryStore.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore
    }
    this.memoryStore.delete(key);
  }

  async clear(): Promise<void> {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    } catch {
      // Ignore
    }
    this.memoryStore.clear();
  }

  // Token conveniences
  async getAccessToken(): Promise<string | null> {
    return this.getItem('thassapay_access_token');
  }

  async setAccessToken(token: string): Promise<void> {
    return this.setItem('thassapay_access_token', token);
  }

  async removeAccessToken(): Promise<void> {
    return this.removeItem('thassapay_access_token');
  }

  // User Profile
  async getUserSession(): Promise<StoredUser | null> {
    const raw = await this.getItem('thassapay_user_session');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredUser;
    } catch {
      return null;
    }
  }

  async setUserSession(user: StoredUser): Promise<void> {
    return this.setItem('thassapay_user_session', JSON.stringify(user));
  }

  async removeUserSession(): Promise<void> {
    return this.removeItem('thassapay_user_session');
  }
}

export const storage = new StorageService();
