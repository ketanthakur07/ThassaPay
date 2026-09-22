/**
 * Storage service for mobile application.
 * Manages JWT tokens, current user session, and onboarding status.
 * Safe across web, testing, and native environments.
 */

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
  async getUserSession(): Promise<any | null> {
    const raw = await this.getItem('thassapay_user_session');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async setUserSession(user: any): Promise<void> {
    return this.setItem('thassapay_user_session', JSON.stringify(user));
  }

  async removeUserSession(): Promise<void> {
    return this.removeItem('thassapay_user_session');
  }
}

export const storage = new StorageService();
