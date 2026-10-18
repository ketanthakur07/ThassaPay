import * as SecureStore from 'expo-secure-store';

/**
 * Secure storage adapter (Phase 5).
 *
 * This is the ONLY place authentication tokens may be persisted. It wraps
 * expo-secure-store (Keychain on iOS, Keystore/EncryptedSharedPreferences on
 * Android) with three hard rules:
 *
 *  1. NO INSECURE FALLBACK. If SecureStore is unavailable — or we are on web,
 *     where SecureStore is not a secure persistence mechanism — every write and
 *     read THROWS. We never downgrade to localStorage/AsyncStorage, because a
 *     silent downgrade would hand an attacker a plaintext refresh token while
 *     the app believes it is protected.
 *  2. EXPLICIT FAILURE. Every operation is try/caught and re-thrown as
 *     SecureStorageError so callers must handle storage problems instead of
 *     assuming a write succeeded.
 *  3. NO SECRET LOGGING. Errors name the operation and key only. Token values
 *     and the underlying native error message are never logged (the native
 *     error can echo the value), so nothing sensitive reaches logs, analytics
 *     or crash reports.
 *
 * Platform detection is deliberately import-free: reading `window`/`document`
 * globals avoids pulling `react-native` into the node-based unit tests, which
 * run in a plain Node environment and must stay RN-free.
 */

/** Thrown for every storage failure. Message is deliberately secret-free. */
export class SecureStorageError extends Error {
  constructor(
    public readonly operation: 'read' | 'write' | 'delete' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'SecureStorageError';
  }
}

/**
 * True when running in a browser-like (web) environment.
 *
 * React Native defines `window` but NOT `document`; a real browser defines both.
 * This distinguishes web from native without importing react-native.
 */
export function isWebPlatform(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** True only where SecureStore is a real, available secure persistence layer. */
export async function isSecureStorageAvailable(): Promise<boolean> {
  // SecureStore supports Android + iOS only. Web has no secure backend here.
  if (isWebPlatform()) return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function assertAvailable(): Promise<void> {
  const available = await isSecureStorageAvailable();
  if (!available) {
    throw new SecureStorageError(
      'unavailable',
      isWebPlatform()
        ? 'Secure token storage is not available on web. Persistent sessions are disabled on this platform — use the Android or iOS app.'
        : 'Secure storage is unavailable on this device. Cannot persist an authenticated session safely.',
    );
  }
}

/** Persist a value. Throws on any failure — never falls back to insecure storage. */
export async function saveSecure(key: string, value: string): Promise<void> {
  await assertAvailable();
  try {
    // AFTER_FIRST_UNLOCK keeps the token readable while the app is backgrounded
    // mid-refresh, without exposing it on the lock screen. (v13 exports this as
    // a top-level named constant, not a KeychainAccessible enum.)
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  } catch {
    // The underlying message may echo the value — do not propagate or log it.
    throw new SecureStorageError('write', `Failed to securely save "${key}".`);
  }
}

/** Read a value. Returns null when absent; throws on storage failure. */
export async function readSecure(key: string): Promise<string | null> {
  await assertAvailable();
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    throw new SecureStorageError('read', `Failed to securely read "${key}".`);
  }
}

/** Delete a value. Throws on storage failure. */
export async function deleteSecure(key: string): Promise<void> {
  await assertAvailable();
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    throw new SecureStorageError('delete', `Failed to securely delete "${key}".`);
  }
}
