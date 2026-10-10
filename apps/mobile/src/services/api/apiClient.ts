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

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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

    return await response.json();
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, 'Network request timed out. Backend took too long to answer.');
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, errorMessage(error, 'Network vanished. Money has not necessarily vanished.'), error);
  }
}

export const apiClient = {
  // 1. Auth
  auth: {
    requestOtp: (phoneNumber: string) =>
      request<{ message: string; devOtp?: string }>('/v1/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      }),

    verifyOtp: (phoneNumber: string, otp: string) =>
      request<{ accessToken: string; user: UserProfile }>('/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, otp }),
      }),
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
