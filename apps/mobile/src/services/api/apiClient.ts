import { config } from '../../constants/config';
import { storage } from '../storage';
import { PaymentStatus, RoastTone, RoastIntensity } from '@thassapay/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** User profile as returned by /v1/users/me and /v1/auth/otp/verify. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  hostelBlock?: string | null;
  roomNo?: string | null;
  createdAt?: string;
  college?: { id: string; name: string; domain: string };
}

/** Expense as returned by POST/PUT /v1/expenses (list items share this shape). */
export interface ExpenseRecord {
  id: string;
  categoryId: string;
  amountPaise: number;
  paymentMethod: 'UPI' | 'CASH' | 'CARD' | 'OTHER';
  source: 'MANUAL' | 'UPI';
  description?: string | null;
  expenseDate: string;
  deletedAt?: string | null;
  correctedFromId?: string | null;
  paymentAttemptId?: string | null;
  category?: { id: string; name: string; icon?: string | null };
}

/** Budget as returned by /v1/budgets (amountPaise is an exact JSON number). */
export interface BudgetRecord {
  id?: string;
  month: string;
  amountPaise: number;
}

/** Narrow an unknown thrown value to a message without asserting `any`. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

/** The access/refresh pair returned by OTP verify and by /auth/refresh. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Statuses that mean the SERVER definitively rejected our credentials (as
 * opposed to being unreachable, timing out, rate-limiting or failing with a
 * 5xx). Only these may destroy a local session.
 *
 * - 401/403: the refresh token was unknown, consumed, revoked or expired.
 * - 400: the stored token itself is malformed — no request shape could redeem
 *   it, so the session is unrecoverable (the server answers 400 only on DTO
 *   validation of the fixed {refreshToken} body).
 */
const SESSION_REJECTION_STATUSES = new Set([400, 401, 403]);

/** True only for a definitive credential rejection — never for transient failures. */
export function isSessionRejection(error: unknown): boolean {
  return error instanceof ApiError && SESSION_REJECTION_STATUSES.has(error.status);
}

/**
 * Notified when the session is definitively dead (refresh rejected by the
 * server) so AuthContext can drop the user back to the login screen.
 */
type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();
export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}
function emitSessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

/** Endpoints that must never trigger an auto-refresh (they ARE the session). */
const NO_AUTO_REFRESH_ENDPOINTS = [
  '/v1/auth/refresh',
  '/v1/auth/logout',
  '/v1/auth/logout-all',
  '/v1/auth/otp/request',
  '/v1/auth/otp/verify',
];

/**
 * Single-flight refresh: concurrent 401s share ONE in-flight refresh instead of
 * stampeding /auth/refresh (which would revoke the family via reuse detection).
 */
let refreshInFlight: Promise<string> | null = null;

async function runRefresh(): Promise<string> {
  const refreshToken = await storage.getRefreshToken();
  if (!refreshToken) {
    // Nothing to refresh with — the session is already over.
    await clearLocalSession();
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Ambiguous (network/tunnel) failure. Do NOT log the user out for a bad
    // connection — surface the error and let the caller fail without clearing
    // a session that may still be perfectly valid.
    throw new ApiError(0, 'Network vanished while refreshing the session.');
  }

  if (!response.ok) {
    if (SESSION_REJECTION_STATUSES.has(response.status)) {
      // Definitive rejection: the refresh token was invalid, expired, rotated
      // or revoked. This session is dead — clear it and send the user to login.
      await clearLocalSession();
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }
    // Transient server-side failure (429 rate limit, 5xx outage, bad gateway).
    // The refresh token is very likely still valid server-side, so destroying
    // the local session here would log the user out for a server hiccup — while
    // leaving the server-side family alive until its 30-day TTL. Surface the
    // real status and keep the session.
    throw new ApiError(
      response.status,
      'Session renewal failed on the server. Please try again.',
    );
  }

  const pair = (await response.json()) as TokenPair;
  // Persist the ROTATED pair atomically. If the secure write fails we must not
  // keep going: the old refresh token was already consumed server-side, so an
  // unpersisted successor would silently kill the session on next launch.
  try {
    await storage.saveTokenPair(pair);
  } catch {
    await clearLocalSession();
    throw new ApiError(
      503,
      'Could not securely save the renewed session. Please sign in again.',
    );
  }
  return pair.accessToken;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Clear tokens + cached profile and tell AuthContext to return to login. */
async function clearLocalSession(): Promise<void> {
  await storage.clearTokens();
  await storage.removeUserSession();
  emitSessionExpired();
}

interface RequestOptions {
  /** Skip auto-refresh/retry (used by the session endpoints themselves). */
  skipAutoRefresh?: boolean;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  reqOpts: RequestOptions = {},
  _isRetry = false,
): Promise<T> {
  const token = await storage.getAccessToken();
  const url = `${config.apiUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.apiTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      // Timeouts are AMBIGUOUS — the request may have been applied server-side.
      // Never auto-retried: retrying a payment blindly could duplicate it.
      throw new ApiError(408, 'Network request timed out. Backend took too long to answer.');
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, errorMessage(error, 'Network vanished. Money has not necessarily vanished.'), error);
  }
  clearTimeout(timeoutId);

  const autoRefreshable =
    response.status === 401 &&
    !_isRetry &&
    !!token &&
    !reqOpts.skipAutoRefresh &&
    !NO_AUTO_REFRESH_ENDPOINTS.some((e) => endpoint.startsWith(e));

  if (autoRefreshable) {
    // The access token was rejected. Do ONE single-flight refresh, then retry
    // the original request exactly once. If the retry also 401s, `_isRetry`
    // stops us looping and the error below is thrown.
    try {
      await refreshAccessToken();
    } catch (err) {
      // A DEFINITIVE rejection keeps the documented session-expired contract;
      // anything transient (network/timeout/429/5xx) is rethrown as it is, so
      // callers — notably AuthContext's bootstrap — can tell "the session is
      // dead" from "the server was unreachable" instead of wiping a valid
      // persisted session on a bad connection.
      if (isSessionRejection(err)) {
        throw new ApiError(401, 'Session expired. Please sign in again.');
      }
      if (err instanceof ApiError) throw err;
      throw new ApiError(0, errorMessage(err, 'Network vanished while refreshing the session.'));
    }
    return request<T>(endpoint, options, reqOpts, true);
  }

  if (!response.ok) {
    let errData: unknown = {};
    try {
      errData = await response.json();
    } catch {
      // fallback
    }
    const msg =
      (errData && typeof errData === 'object' && 'message' in errData
        ? (errData as { message?: unknown }).message
        : undefined) || `API error (${response.status}): ${response.statusText}`;
    throw new ApiError(
      response.status,
      Array.isArray(msg) ? msg.map(String).join(', ') : String(msg),
      errData,
    );
  }

  return (await response.json()) as T;
}

export const apiClient = {
  // 1. Auth
  auth: {
    requestOtp: (phoneNumber: string) =>
      request<{ message: string; devOtp?: string }>('/v1/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      }, { skipAutoRefresh: true }),

    verifyOtp: (phoneNumber: string, otp: string) =>
      request<TokenPair & { user: UserProfile }>('/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, otp }),
      }, { skipAutoRefresh: true }),

    /** Rotate the session. Skip auto-refresh — this IS the refresh path. */
    refresh: (refreshToken: string) =>
      request<TokenPair>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }, { skipAutoRefresh: true }),

    /** Revoke this device's session server-side. Always safe to call. */
    logout: (refreshToken: string) =>
      request<{ success: boolean }>('/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }, { skipAutoRefresh: true }),

    /** Revoke every session for this account (all devices). */
    logoutAll: () =>
      request<{ success: boolean; revokedSessions: number }>('/v1/auth/logout-all', {
        method: 'POST',
      }, { skipAutoRefresh: true }),
  },

  // 2. Users
  users: {
    getMe: () => request<UserProfile>('/v1/users/me'),
    updateProfile: (data: {
      name?: string;
      hostelBlock?: string;
      roomNo?: string;
      preferredRoastTone?: RoastTone;
    }) =>
      request<UserProfile>('/v1/users/me', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // 3. Categories
  categories: {
    getAll: () => request<Array<{ id: string; name: string; icon: string; isDefault: boolean }>>('/v1/categories'),
  },

  // 4. Expenses
  expenses: {
    create: (data: {
      categoryId: string;
      amountPaise: number;
      paymentMethod: 'UPI' | 'CASH' | 'CARD' | 'OTHER';
      description?: string;
      expenseDate?: string;
      paymentAttemptId?: string;
    }) =>
      request<ExpenseRecord>('/v1/expenses', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    list: (params?: { month?: string; categoryId?: string; limit?: number; offset?: number }) => {
      const q = new URLSearchParams();
      if (params?.month) q.append('month', params.month);
      if (params?.categoryId) q.append('categoryId', params.categoryId);
      if (params?.limit) q.append('limit', String(params.limit));
      if (params?.offset) q.append('offset', String(params.offset));
      const queryStr = q.toString() ? `?${q.toString()}` : '';
      return request<ExpenseRecord[]>(`/v1/expenses${queryStr}`);
    },

    delete: (id: string) =>
      request<{ success: boolean }>(`/v1/expenses/${id}`, {
        method: 'DELETE',
      }),

    correct: (id: string, data: {
      categoryId: string;
      amountPaise: number;
      paymentMethod: 'UPI' | 'CASH' | 'CARD' | 'OTHER';
      description?: string;
      expenseDate?: string;
    }) =>
      request<ExpenseRecord>(`/v1/expenses/${id}/correct`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // 5. Budgets
  budgets: {
    get: (month: string) => request<BudgetRecord>(`/v1/budgets?month=${month}`),
    set: (month: string, amountPaise: number) =>
      request<BudgetRecord>('/v1/budgets', {
        method: 'POST',
        body: JSON.stringify({ month, amountPaise }),
      }),
  },

  // 6. Analytics
  analytics: {
    getSummary: (month?: string) => {
      const query = month ? `?month=${month}` : '';
      return request<{
        month: string;
        totalSpentPaise: number;
        budgetLimitPaise: number;
        damageScore: number;
        categoryBreakdown: Array<{ categoryId: string; categoryName: string; amountPaise: number }>;
        transactionCount: number;
      }>(`/v1/analytics/summary${query}`);
    },
  },

  // 7. Roast Engine
  roasts: {
    generate: (payload: {
      amountPaise: number;
      categoryName: string;
      monthlySpendPaise: number;
      monthlyBudgetPaise?: number;
      tone?: RoastTone;
    }) =>
      request<{
        roastText: string;
        toneUsed: RoastTone;
        intensity: RoastIntensity;
        damageScore: number;
      }>('/v1/roast/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  // 8. Payments
  payments: {
    create: (data: {
      upiId: string;
      amount: string;
      idempotencyKey: string;
      categoryId: string;
      description?: string;
    }) =>
      request<{
        id: string;
        status: PaymentStatus;
        amountPaise: number;
        upiId: string;
      }>('/v1/payments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /**
     * Audit fix (P0): contract was { status: 'USER_RETURNED' } — a field the
     * backend never defined — so every real return fell into FAILED. The
     * backend expects an explicit outcome enum.
     */
    reportReturn: (id: string, outcome: 'app_returned_ok' | 'user_cancelled' | 'app_returned_error', referenceId?: string) =>
      request<{
        id: string;
        status: PaymentStatus;
      }>(`/v1/payments/${id}/return`, {
        method: 'POST',
        body: JSON.stringify({ outcome, referenceId }),
      }),

    /**
     * Audit addition (P0): move an AWAITING_CONFIRMATION attempt into
     * NEEDS_REVIEW immediately so the user can answer the verification
     * question without waiting for the reconciliation sweep.
     */
    review: (id: string) =>
      request<{ id: string; status: PaymentStatus }>(`/v1/payments/${id}/review`, {
        method: 'POST',
      }),

    confirm: (id: string, data: {
      didSucceed: boolean;
      categoryId: string;
      description?: string;
    }) =>
      request<{ id: string; status: PaymentStatus }>(`/v1/payments/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    /**
     * Audit addition (Step 20): used on app restart to restore the truth for a
     * payment whose result screen was lost (app killed mid-flow). The backend
     * state machine — not client memory — decides what actually happened.
     */
    get: (id: string) =>
      request<{
        id: string;
        status: PaymentStatus;
        amountPaise: number;
        upiId: string;
        expenseId: string | null;
      }>(`/v1/payments/${id}`, { method: 'GET' }),
  },
};
