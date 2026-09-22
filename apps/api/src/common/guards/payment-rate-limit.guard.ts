import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Per-USER rate limiting on payment creation, separate from any global rate
 * limiter. A single compromised account shouldn't be able to spam payment
 * attempts even if the global limiter is nowhere near tripped.
 */
@Injectable()
export class PaymentRateLimitGuard implements CanActivate {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private readonly MAX_ATTEMPTS = 10;
  private readonly WINDOW_SECONDS = 60;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) return true; // JwtAuthGuard should already reject this, this is defense-in-depth

    const key = `ratelimit:payments:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, this.WINDOW_SECONDS);
    }
    if (count > this.MAX_ATTEMPTS) {
      throw new HttpException('Too many payment attempts, slow down.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
