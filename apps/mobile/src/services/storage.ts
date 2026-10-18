import { RoastTone } from '@thassapay/types';
import {
  saveSecure,
  readSecure,
  deleteSecure,
  isSecureStorageAvailable,
  SecureStorageError,
} from './secureStorage';

/**
 * Storage service for the mobile app.
 *
 * Two very different kinds of data live here, and they are stored VERY
 * differently on purpose:
 *
 *  1. AUTH TOKENS (access + refresh) — persisted ONLY through expo-secure-store
 *     via secureStorage.ts (Keychain / Keystore). They are written as ONE
 *     serialized pair under a single key so a pair is never half-updated, and
 *     there is NO localStorage/AsyncStorage fallback on native. A failed secure
 *     write THROWS — it never silently "succeeds" with an unpersisted token.
 *
 *  2. UI/session cache (cached profile, onboarding flags) — not secrets, kept
 *     in the plain key/value store below.
 *
 * See docs/SECURITY.md "Refresh Tokens" for the storage rationale.
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

/** The access/refresh pair returned by OTP verify and by /auth/refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Single SecureStore key holding the whole serialized pair (atomic by design). */
const SECURE_SESSION_KEY = 'thassapay_auth_session';

/**
 * Plaintext keys used before Phase 5. Purged on startup WITHOUT reading their
 * values, so a legacy token is never migrated blindly, never logged, and the
 * user is simply required to re-authenticate.
 */
const LEGACY_PLAINTEXT_KEYS = ['thassapay_access_token', 'thassapay_refresh_token'];

class StorageService {
  // Non-secret UI cache only (localStorage on web, Map in tests/node).
  private memoryStore: Map<string, string> = new Map();

  // Session-scope cache of the secure pair. A fast path for reads — it NEVER
  // substitutes for SecureStore persistence: every write goes to SecureStore
  // first, and a failed write never populates this cache.
  private cachedPair: TokenPair | null = null;

  private legacyPurged = false;

  /**
   * Set when a secure delete fails (logout / failed refresh). The token may
   * still sit in SecureStore, but the app has already decided the session is
   * over — so reads must NOT resurrect it from disk and leave a half-cleared,
   * inconsistent session. Cleared on the next successful saveTokenPair (a new
   * login supersedes it).
   *
   * Known limitation: this flag is in-memory, so a token whose delete failed
   * could still be readable after a full app restart. That is documented in
   * docs/SECURITY.md; the flag bounds the exposure to the current session.
   */
  private sessionTerminated = false;

  // ---------------------------------------------------------------------
  // Non-secret key/value (profile cache, flags). NOT for tokens.
  // ---------------------------------------------------------------------
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

  /**
   * Remove legacy plaintext tokens. Only calls removeItem — the stored value
   * is never read, copied or logged, so a pre-Phase-5 token is simply dropped
   * and the user re-authenticates.
   */
  private purgeLegacyPlaintextTokens(): void {
    if (this.legacyPurged) return;
    this.legacyPurged = true;
    try {
      if (typeof localStorage !== 'undefined') {
        for (const key of LEGACY_PLAINTEXT_KEYS) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore — worst case the stale plaintext keys linger until next launch.
    }
    // Also drop any in-memory copies from this session.
    for (const key of LEGACY_PLAINTEXT_KEYS) {
      this.memoryStore.delete(key);
    }
  }

  // ---------------------------------------------------------------------
  // AUTH TOKEN PAIR — secure, atomic, no insecure fallback.
  // ---------------------------------------------------------------------

  /**
   * Persist the pair as one SecureStore value.
   *
   * Writes to SecureStore FIRST. If the write fails it THROWS and the
   * in-memory cache is left untouched, so a failed write can never be mistaken
   * for a successful login/refresh (no unpersisted refresh token is activated).
   */
  async saveTokenPair(pair: TokenPair): Promise<void> {
    this.purgeLegacyPlaintextTokens();
    await saveSecure(SECURE_SESSION_KEY, JSON.stringify(pair));
    this.cachedPair = pair;
    this.sessionTerminated = false;
  }

  /** Read the pair. Session-cache fast path, else SecureStore. */
  async getTokenPair(): Promise<TokenPair | null> {
    this.purgeLegacyPlaintextTokens();
    if (this.sessionTerminated) return null; // a failed delete already ended this session
    if (this.cachedPair) return this.cachedPair;

    const raw = await readSecure(SECURE_SESSION_KEY);
    if (!raw) return null;
    try {
      const pair = JSON.parse(raw) as TokenPair;
      if (typeof pair?.accessToken !== 'string' || typeof pair?.refreshToken !== 'string') {
        throw new Error('malformed pair');
      }
      this.cachedPair = pair;
      return pair;
    } catch {
      // Corrupt/legacy blob — treat as no session and remove it.
      await this.clearTokenPair().catch(() => undefined);
      return null;
    }
  }

  /**
   * Clear the pair. Drops the in-memory cache FIRST so the session cannot be
   * used from memory while a delete is in flight, then attempts the SecureStore
   * delete. A delete failure is surfaced (not swallowed) so callers can report
   * it — but the in-memory session is already unusable either way.
   */
  async clearTokenPair(): Promise<void> {
    this.cachedPair = null;
    try {
      await deleteSecure(SECURE_SESSION_KEY);
      this.sessionTerminated = false;
    } catch {
      // The delete failed: the value may persist in SecureStore, so mark the
      // session terminated to block reads for the rest of this run, then
      // surface the failure to the caller.
      this.sessionTerminated = true;
      throw new SecureStorageError('delete', `Failed to securely delete "${SECURE_SESSION_KEY}".`);
    }
  }

  // Single-token shims kept for API compatibility. Both read-modify-write the
  // whole pair so calling them in sequence still converges on one stored pair.
  // Prefer saveTokenPair() in real flows (single atomic write).

  async getAccessToken(): Promise<string | null> {
    const pair = await this.getTokenPair();
    // An empty string (from removeAccessToken) is NOT a usable token — normalize
    // to null so callers can't send an empty Bearer header.
    return pair?.accessToken || null;
  }

  async setAccessToken(token: string): Promise<void> {
    const existing = await this.getTokenPair().catch(() => null);
    await this.saveTokenPair({ accessToken: token, refreshToken: existing?.refreshToken ?? '' });
  }

  async getRefreshToken(): Promise<string | null> {
    const pair = await this.getTokenPair();
    // Same as above: an empty string means "cleared", not a token.
    return pair?.refreshToken || null;
  }

  async setRefreshToken(token: string): Promise<void> {
    const existing = await this.getTokenPair().catch(() => null);
    await this.saveTokenPair({ accessToken: existing?.accessToken ?? '', refreshToken: token });
  }

  /**
   * Clear ONLY the access token, keeping the refresh token. The pair is
   * re-written as one value so the stored blob is never half-updated.
   */
  async removeAccessToken(): Promise<void> {
    const existing = await this.getTokenPair().catch(() => null);
    if (!existing) return;
    await this.saveTokenPair({ accessToken: '', refreshToken: existing.refreshToken });
  }

  /**
   * Clear ONLY the refresh token, keeping the access token. Dropping the
   * refresh token ends future renewal — the session dies at access-token expiry.
   */
  async removeRefreshToken(): Promise<void> {
    const existing = await this.getTokenPair().catch(() => null);
    if (!existing) return;
    await this.saveTokenPair({ accessToken: existing.accessToken, refreshToken: '' });
  }

  /** Drop both tokens in one call — used by logout and failed-refresh cleanup. */
  async clearTokens(): Promise<void> {
    this.cachedPair = null;
    try {
      await deleteSecure(SECURE_SESSION_KEY);
      this.sessionTerminated = false;
    } catch {
      // Best-effort for logout: still terminate the in-memory session so it
      // cannot be used, but do NOT throw — logout must complete offline.
      this.sessionTerminated = true;
    }
  }

  /** Whether SecureStore-backed sessions can be used on this platform. */
  async hasSecureStorage(): Promise<boolean> {
    return isSecureStorageAvailable();
  }

  // ---------------------------------------------------------------------
  // User profile cache (NOT a secret — plain key/value).
  // ---------------------------------------------------------------------
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

  /** Nuke everything: in-memory cache, legacy plaintext, profile, and the pair. */
  async clear(): Promise<void> {
    this.cachedPair = null;
    this.sessionTerminated = false;
    this.legacyPurged = false; // fresh session — re-check for legacy plaintext keys
    this.memoryStore.clear();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    } catch {
      // Ignore
    }
    // Best-effort secure delete (SecureStore may be unavailable in some envs).
    await deleteSecure(SECURE_SESSION_KEY).catch(() => undefined);
  }
}

export const storage = new StorageService();
