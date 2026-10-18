import { storage } from '../src/services/storage';
import {
  saveSecure,
  readSecure,
  deleteSecure,
  isSecureStorageAvailable,
  isWebPlatform,
  SecureStorageError,
} from '../src/services/secureStorage';
import { __secureStoreControl, __resetSecureStore } from '../__mocks__/expo-secure-store';

/**
 * Phase 5 — secure token storage.
 *
 * The expo-secure-store double (see __mocks__/expo-secure-store.ts) is wired
 * through moduleNameMapper, so these tests exercise the REAL storage and
 * secureStorage code against a controllable SecureStore.
 *
 * Scope note: this validates behaviour against a mocked SecureStore. It does
 * NOT substitute for a physical-device Keychain/Keystore verification, which
 * is reported separately.
 */

const SECURE_KEY = 'thassapay_auth_session';

beforeEach(async () => {
  __resetSecureStore();
  await storage.clear();
  __resetSecureStore();
});

describe('token pair persistence', () => {
  it('saves and retrieves the token pair as ONE secure value', async () => {
    await storage.saveTokenPair({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const pair = await storage.getTokenPair();
    expect(pair).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    // Exactly one SecureStore key holds the whole pair — never two half-writes.
    expect(__secureStoreControl.store.size).toBe(1);
    expect(__secureStoreControl.store.has(SECURE_KEY)).toBe(true);
  });

  it('single-token shims read from the same stored pair', async () => {
    await storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' });
    expect(await storage.getAccessToken()).toBe('a');
    expect(await storage.getRefreshToken()).toBe('r');
  });

  it('rotation replaces the whole pair (no stale refresh token left behind)', async () => {
    await storage.saveTokenPair({ accessToken: 'a1', refreshToken: 'r1' });
    await storage.saveTokenPair({ accessToken: 'a2', refreshToken: 'r2' });

    const pair = await storage.getTokenPair();
    expect(pair).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    // The stored blob contains only the new refresh token.
    expect(__secureStoreControl.store.get(SECURE_KEY)).not.toContain('r1');
  });

  it('clearTokenPair removes both tokens and returns null afterwards', async () => {
    await storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' });
    await storage.clearTokenPair();

    expect(await storage.getTokenPair()).toBeNull();
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
    expect(__secureStoreControl.store.has(SECURE_KEY)).toBe(false);
  });

  it('empty storage yields null, not a throw', async () => {
    expect(await storage.getTokenPair()).toBeNull();
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
  });

  it('a malformed stored blob is treated as no session and cleaned up', async () => {
    __secureStoreControl.store.set(SECURE_KEY, 'not-json{');
    expect(await storage.getTokenPair()).toBeNull();

    __secureStoreControl.store.set(SECURE_KEY, JSON.stringify({ accessToken: 123 }));
    // Reset the session cache so the read hits SecureStore again.
    await storage.clearTokens();
    __secureStoreControl.store.set(SECURE_KEY, JSON.stringify({ refreshToken: 'only-refresh' }));
    expect(await storage.getTokenPair()).toBeNull();
  });
});

describe('no insecure fallback on native', () => {
  it('never writes tokens to localStorage even when it exists', async () => {
    const written: Array<[string, string]> = [];
    const fakeLocalStorage = {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
      removeItem: () => undefined,
      clear: () => undefined,
    };
    (globalThis as any).localStorage = fakeLocalStorage;
    try {
      await storage.saveTokenPair({ accessToken: 'secret-access', refreshToken: 'secret-refresh' });
      // localStorage was reachable (setItem exists) but must NOT receive tokens.
      expect(written).toHaveLength(0);
      expect(__secureStoreControl.store.get(SECURE_KEY)).toContain('secret-refresh');
    } finally {
      delete (globalThis as any).localStorage;
    }
  });

  it('legacy plaintext token keys are purged without being read or migrated', async () => {
    let readKeys: string[] = [];
    const legacyStore = new Map<string, string>([
      ['thassapay_access_token', 'legacy-plaintext-access'],
      ['thassapay_refresh_token', 'legacy-plaintext-refresh'],
      ['unrelated-key', 'keep-me'],
    ]);
    (globalThis as any).localStorage = {
      getItem: (k: string) => {
        readKeys.push(k);
        return legacyStore.get(k) ?? null;
      },
      setItem: () => undefined,
      removeItem: (k: string) => {
        legacyStore.delete(k);
      },
      clear: () => legacyStore.clear(),
    };
    try {
      // Any token op triggers the purge.
      expect(await storage.getTokenPair()).toBeNull();

      expect(legacyStore.has('thassapay_access_token')).toBe(false);
      expect(legacyStore.has('thassapay_refresh_token')).toBe(false);
      expect(legacyStore.get('unrelated-key')).toBe('keep-me'); // untouched
      // The purge must never READ the legacy token values.
      expect(readKeys).toHaveLength(0);
    } finally {
      delete (globalThis as any).localStorage;
    }
  });
});

describe('failure handling (SecureStorageError)', () => {
  it('write failure throws and does NOT cache the pair as saved', async () => {
    __secureStoreControl.fail.set = true;
    await expect(
      storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' }),
    ).rejects.toThrow(SecureStorageError);

    __secureStoreControl.fail.set = false;
    // Nothing was persisted and nothing was cached from the failed write.
    expect(__secureStoreControl.store.has(SECURE_KEY)).toBe(false);
    expect(await storage.getTokenPair()).toBeNull();
  });

  it('read failure surfaces a SecureStorageError (not a silent null)', async () => {
    await storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' });
    // Force the read path to hit SecureStore, then fail it.
    await storage.clearTokens();
    __secureStoreControl.store.set(SECURE_KEY, 'garbage');
    __secureStoreControl.fail.get = true;
    await expect(storage.getTokenPair()).rejects.toThrow(SecureStorageError);
  });

  it('delete failure surfaces a SecureStorageError from clearTokenPair', async () => {
    await storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' });
    __secureStoreControl.fail.delete = true;
    await expect(storage.clearTokenPair()).rejects.toThrow(SecureStorageError);
    // The in-memory session is dropped regardless, so it cannot be used.
    __secureStoreControl.fail.delete = false;
    expect(await storage.getTokenPair()).toBeNull();
  });

  it('clearTokens (logout path) still clears the in-memory session on delete failure', async () => {
    await storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' });
    __secureStoreControl.fail.delete = true;
    // clearTokens is best-effort for logout: must NOT throw...
    await expect(storage.clearTokens()).resolves.toBeUndefined();
    // ...and the in-memory session must be gone so it cannot be reused.
    __secureStoreControl.fail.delete = false;
    expect(await storage.getTokenPair()).toBeNull();
  });

  it('SecureStore unavailable -> every token op throws (no downgrade)', async () => {
    __secureStoreControl.available = false;

    await expect(storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' })).rejects.toThrow(
      SecureStorageError,
    );
    await expect(storage.getTokenPair()).rejects.toThrow(SecureStorageError);
    await expect(saveSecure('k', 'v')).rejects.toThrow(SecureStorageError);
    await expect(readSecure('k')).rejects.toThrow(SecureStorageError);
    await expect(deleteSecure('k')).rejects.toThrow(SecureStorageError);
    expect(await isSecureStorageAvailable()).toBe(false);

    // Nothing ever reached the insecure store.
    expect(__secureStoreControl.store.size).toBe(0);
  });

  it('error messages never contain the token value', async () => {
    __secureStoreControl.fail.set = true;
    let message = '';
    try {
      await storage.saveTokenPair({
        accessToken: 'SUPER-SECRET-ACCESS',
        refreshToken: 'SUPER-SECRET-REFRESH',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      message = (err as Error).message;
    }
    expect(message).not.toContain('SUPER-SECRET');
    expect(message).not.toContain('SECRET');
    expect(message.length).toBeGreaterThan(0); // it did throw
  });
});

describe('platform gating', () => {
  it('isSecureStorageAvailable is false on web and true with SecureStore present', async () => {
    // Node test env has no `document`, so this is treated as native.
    expect(isWebPlatform()).toBe(false);
    expect(await isSecureStorageAvailable()).toBe(true);
  });

  it('web platform detection keys off a real DOM document', () => {
    const fakeDoc = { createElement: () => ({}) };
    (globalThis as any).document = fakeDoc;
    try {
      expect(isWebPlatform()).toBe(true);
    } finally {
      delete (globalThis as any).document;
    }
  });
});
