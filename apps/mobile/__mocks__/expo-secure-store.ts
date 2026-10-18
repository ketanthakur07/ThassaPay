/**
 * Test double for expo-secure-store.
 *
 * Wired via `moduleNameMapper` in apps/mobile/package.json so the node-based
 * Jest environment never loads the real native module. It reproduces the two
 * behaviours the storage layer depends on:
 *   1. a per-key store (setItem/getItem/delete),
 *   2. `isAvailableAsync()` plus injectable failures, so tests can exercise
 *      "SecureStore unavailable" and read/write/delete failure paths.
 *
 * Token values are held only in an in-memory Map — nothing is written to disk.
 *
 * The Map (and control state) are hung off globalThis so they SURVIVE a
 * jest.resetModules(). That matters for "app restart" tests: a cold
 * StorageService must still see the persisted pair, exactly as a real device
 * keeps its Keychain/Keystore entry across process launches.
 */

/** Which operations should throw when their failure flag is set. */
type FailFlags = { get: boolean; set: boolean; delete: boolean };

type SecureStoreState = {
  store: Map<string, string>;
  available: boolean;
  fail: FailFlags;
  calls: { get: number; set: number; delete: number };
};

const GLOBAL_KEY = '__THASSAPAY_SECURE_STORE_DOUBLE__';

// Reuse existing state across module resets; create it on first load.
const g = globalThis as unknown as Record<string, SecureStoreState | undefined>;
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = {
    store: new Map<string, string>(),
    available: true,
    fail: { get: false, set: false, delete: false },
    calls: { get: 0, set: 0, delete: 0 },
  };
}
const state = g[GLOBAL_KEY] as SecureStoreState;

/** Test controls. Mutate in a test; call __resetSecureStore() in beforeEach. */
export const __secureStoreControl = {
  /** When false, isAvailableAsync() resolves false -> storage layer must throw. */
  get available() {
    return state.available;
  },
  set available(v: boolean) {
    state.available = v;
  },
  /** Inject failures for a single operation. */
  fail: state.fail,
  /** Spy counts, so tests can assert "no insecure fallback" / call counts. */
  calls: state.calls,
  /** Underlying value map, for direct inspection (never logged). */
  store: state.store,
};

export function __resetSecureStore(): void {
  state.store.clear();
  state.available = true;
  state.fail.get = false;
  state.fail.set = false;
  state.fail.delete = false;
  state.calls.get = 0;
  state.calls.set = 0;
  state.calls.delete = 0;
}

export const KeychainAccessible = {
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
  ALWAYS: 'ALWAYS',
  ALWAYS_THIS_DEVICE_ONLY: 'ALWAYS_THIS_DEVICE_ONLY',
};

export async function isAvailableAsync(): Promise<boolean> {
  return __secureStoreControl.available;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  state.calls.set += 1;
  if (state.fail.set) {
    throw new Error(`secure-store write failure for ${key}`);
  }
  state.store.set(key, value);
}

export async function getItemAsync(key: string): Promise<string | null> {
  state.calls.get += 1;
  if (state.fail.get) {
    throw new Error(`secure-store read failure for ${key}`);
  }
  return state.store.has(key) ? (state.store.get(key) as string) : null;
}

export async function deleteItemAsync(key: string): Promise<void> {
  state.calls.delete += 1;
  if (state.fail.delete) {
    throw new Error(`secure-store delete failure for ${key}`);
  }
  state.store.delete(key);
}
