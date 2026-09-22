import { config } from '../../constants/config';
import { storage } from '../storage';
import {
  TransactionCategory,
  PaymentStatus,
  RoastTone,
  RoastIntensity,
} from '@thassapay/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public data?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
      let errData: any = {};
      try {
        errData = await response.json();
      } catch {
        // fallback
      }
      const msg = errData?.message || `API error (${response.status}): ${response.statusText}`;
      throw new ApiError(response.status, Array.isArray(msg) ? msg.join(', ') : msg, errData);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ApiError(408, 'Network request timed out. Backend took too long to answer.');
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, error?.message || 'Network vanished. Money has not necessarily vanished.', error);
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
      request<{ accessToken: string; user: any }>('/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber, otp }),
      }),
  },

  // 2. Users
  users: {
    getMe: () => request<any>('/v1/users/me'),
    updateProfile: (data: {
      name?: string;
      hostelBlock?: string;
      roomNo?: string;
      preferredRoastTone?: RoastTone;
    }) =>
      request<any>('/v1/users/me', {
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
      request<any>('/v1/expenses', {
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
      return request<any[]>(`/v1/expenses${queryStr}`);
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
      request<any>(`/v1/expenses/${id}/correct`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  // 5. Budgets
  budgets: {
    get: (month: string) => request<any>(`/v1/budgets?month=${month}`),
    set: (month: string, amountPaise: number) =>
      request<any>('/v1/budgets', {
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
      amountPaise: number;
      idempotencyKey: string;
      referenceId?: string;
    }) =>
      request<{
        id: string;
        upiUri: string;
        status: PaymentStatus;
        amountPaise: number;
        upiId: string;
      }>('/v1/payments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    reportReturn: (id: string, data: {
      status?: string;
      responseCode?: string;
      referenceId?: string;
    }) =>
      request<{
        id: string;
        status: PaymentStatus;
        message?: string;
      }>(`/v1/payments/${id}/return`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    confirm: (id: string, data: {
      didSucceed: boolean;
      categoryId: string;
      description?: string;
    }) =>
      request<any>(`/v1/payments/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
};
