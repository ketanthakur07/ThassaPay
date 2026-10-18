import { storage, TokenPair } from '../src/services/storage';
import { __secureStoreControl, __resetSecureStore } from '../__mocks__/expo-secure-store';

/**
 * Phase 5 — auth + secure persistence.
 *
 * Focus: the two behaviours specific to SecureStore integration that
 * auth-refresh.spec.ts (Phase 4) does not cover:
 *   1. login persists the pair as ONE atomic SecureStore write,
 *   2. an app restart (fresh StorageService, empty in-memory cache) restores
 *      the session from SecureStore — proving persistence, not a memory-only
 *      session.
 *
 * api-client single-flight / retry-once / idempotency-key stability are covered
 * in auth-refresh.spec.ts and remain unchanged by this phase.
 */

const SECURE_KEY = 'thassapay_auth_session';

beforeEach(async () => {
  __resetSecureStore();
  await storage.clear();
  __resetSecureStore();
});

/** Simulate an app restart: a brand-new service with a cold in-memory cache. */
async function restartApp(): Promise<typeof storage> {
  jest.resetModules();
  // Re-require so a fresh StorageService singleton is built. The SecureStore
  // double is module-level, so the persisted pair survives the "restart".
  const { storage: fresh } = await import('../src/services/storage');
  return fresh;
}

describe('login persists the pair securely', () => {
  it('verifyOtp-style save stores the pair as a single SecureStore value', async () => {
    const pair: TokenPair = { accessToken: 'login-access', refreshToken: 'login-refresh' };
    await storage.saveTokenPair(pair); // what AuthContext.verifyOtp calls

    // Exactly one secure key, containing the whole pair.
    expect(__secureStoreControl.store.size).toBe(1);
    const raw = __secureStoreControl.store.get(SECURE_KEY);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string)).toEqual(pair);
  });

  it('a failed secure write during login does NOT report a stored session', async () => {
    __secureStoreControl.fail.set = true;
    await expect(
      storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' }),
    ).rejects.toThrow();

    __secureStoreControl.fail.set = false;
    // No half-persisted session, and no in-memory session either.
    expect(__secureStoreControl.store.has(SECURE_KEY)).toBe(false);
    expect(await storage.getTokenPair()).toBeNull();
  });
});

describe('app restart restores the session from SecureStore', () => {
  it('a cold service instance reads the persisted pair back', async () => {
    await storage.saveTokenPair({ accessToken: 'a1', refreshToken: 'r1' });

    const fresh = await restartApp();
    const pair = await fresh.getTokenPair();

    expect(pair).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(await fresh.getAccessToken()).toBe('a1');
    expect(await fresh.getRefreshToken()).toBe('r1');
  });

  it('after restart with no stored pair there is no session', async () => {
    const fresh = await restartApp();
    expect(await fresh.getTokenPair()).toBeNull();
  });

  it('rotation performed before a restart survives it', async () => {
    await storage.saveTokenPair({ accessToken: 'a1', refreshToken: 'r1' });
    // Rotate, as a successful refresh would.
    await storage.saveTokenPair({ accessToken: 'a2', refreshToken: 'r2' });

    const fresh = await restartApp();
    const pair = await fresh.getTokenPair();
    // Only the newest pair is persisted — the old refresh token is gone.
    expect(pair).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(__secureStoreControl.store.get(SECURE_KEY)).not.toContain('r1');
  });
});

describe('logout clears the persisted session', () => {
  it('clearTokens wipes the SecureStore pair so a restart has no session', async () => {
    await storage.saveTokenPair({ accessToken: 'a', refreshToken: 'r' });
    await storage.clearTokens(); // logout path

    expect(__secureStoreControl.store.has(SECURE_KEY)).toBe(false);

    const fresh = await restartApp();
    expect(await fresh.getTokenPair()).toBeNull();
  });
});
