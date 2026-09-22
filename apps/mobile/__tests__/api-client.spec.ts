import { apiClient, ApiError } from '../src/services/api/apiClient';
import { storage } from '../src/services/storage';

describe('Mobile API Client & Auth Handling', () => {
  beforeEach(async () => {
    await storage.clear();
    // Reset global fetch mock
    (global as any).fetch = jest.fn();
  });

  it('should inject Bearer token into headers when token exists in storage', async () => {
    await storage.setAccessToken('mock_jwt_access_token_123');

    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'usr_1', name: 'Ketan' }),
    });

    await apiClient.users.getMe();

    expect((global as any).fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/users/me'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock_jwt_access_token_123',
        }),
      }),
    );
  });

  it('should throw typed ApiError with backend message on HTTP 400 error', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ message: 'Invalid OTP code' }),
    });

    await expect(apiClient.auth.verifyOtp('9876543210', '000000')).rejects.toThrow(
      ApiError,
    );

    try {
      await apiClient.auth.verifyOtp('9876543210', '000000');
    } catch (err: any) {
      expect(err.status).toBe(400);
      expect(err.message).toBe('Invalid OTP code');
    }
  });

  it('should handle network timeout gracefully with helpful hostel error', async () => {
    (global as any).fetch = jest.fn().mockImplementation(() => {
      const err: any = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    await expect(apiClient.analytics.getSummary()).rejects.toThrow(
      'Network request timed out. Backend took too long to answer.',
    );
  });
});
