import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Verifies the access token and attaches req.user. Access tokens are short-lived
 * (15 min) and are NOT revoked on logout — they stay valid until expiry, which
 * is why the lifetime must stay short.
 *
 * Token renewal lives in the refresh flow: POST /v1/auth/refresh rotates an
 * opaque refresh token (see auth/refresh-token.service.ts and
 * docs/SECURITY.md "Refresh Tokens"). Logout revokes the refresh session
 * server-side, but cannot invalidate an already-issued access JWT. Never extend
 * access-token lifetime as a UX fix — the refresh flow handles renewal.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = await this.jwt.verifyAsync(token);
      // Audit fix (P1): a correctly-signed token without a subject (or with an
      // empty one) must not authenticate as "user id undefined", which would
      // otherwise reach services as an unmatched owner id.
      if (typeof payload?.sub !== 'string' || payload.sub.length === 0) {
        throw new UnauthorizedException('Invalid token subject');
      }
      req.user = { id: payload.sub, collegeId: payload.collegeId };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
