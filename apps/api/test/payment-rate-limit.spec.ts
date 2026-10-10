import { HttpException, HttpStatus, ExecutionContext } from '@nestjs/common';
import { PaymentRateLimitGuard } from '../src/common/guards/payment-rate-limit.guard';

/**
 * Audit (Step 22): payment-creation rate limiting is the defence for a
 * compromised account spamming attempts. Redis is not available in this test
 * environment, so the client is mocked — the limiter's own logic (window
 * counter, per-user key, 429) is what is under test.
 */
jest.mock('ioredis', () => {
  const counts = new Map<string, number>();
  class RedisMock {
    async incr(key: string): Promise<number> {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }
    async expire(): Promise<number> {
      return 1;
    }
  }
  return { __esModule: true, default: RedisMock, counts };
});

function ctxFor(userId?: string): ExecutionContext {
  const req: any = { user: userId ? { id: userId } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PaymentRateLimitGuard', () => {
  it('allows the documented 10 attempts per 60s per user', async () => {
    const guard = new PaymentRateLimitGuard();
    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(ctxFor('user-rate-a'))).resolves.toBe(true);
    }
  });

  it('rejects the 11th attempt with 429', async () => {
    const guard = new PaymentRateLimitGuard();
    for (let i = 0; i < 10; i++) await guard.canActivate(ctxFor('user-rate-b'));
    try {
      await guard.canActivate(ctxFor('user-rate-b'));
      fail('expected the 11th attempt to be rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((err as HttpException).message).toMatch(/slow down/i);
    }
  });

  it('is per-user: one noisy account cannot lock out another', async () => {
    const guard = new PaymentRateLimitGuard();
    for (let i = 0; i < 11; i++) await guard.canActivate(ctxFor('user-rate-c')).catch(() => undefined);
    await expect(guard.canActivate(ctxFor('user-rate-d'))).resolves.toBe(true);
  });

  it('does not rate-limit requests that somehow lack a user (defence-in-depth only)', async () => {
    const guard = new PaymentRateLimitGuard();
    await expect(guard.canActivate(ctxFor(undefined))).resolves.toBe(true);
  });

  it('throws an HttpException (not a raw error) so the API answers 429', async () => {
    const guard = new PaymentRateLimitGuard();
    for (let i = 0; i < 11; i++) await guard.canActivate(ctxFor('user-rate-e')).catch(() => undefined);
    await expect(guard.canActivate(ctxFor('user-rate-e'))).rejects.toBeInstanceOf(HttpException);
  });});
