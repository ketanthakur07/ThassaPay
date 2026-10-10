import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Verifies the access token and attaches req.user. Access tokens are short-lived
 * (15 min).
 *
 * Audit note (Step 9): the original doc comment referenced a rotated refresh
 * token flow at /auth/refresh — that endpoint, the refresh token and the
 * logout/revocation path DO NOT EXIST in this codebase (users.refreshTokenHash
 * is always null). Today a 15-minute token simply expires and the user logs in
 * again. Never extend access-token lifetime as a fix for UX friction; implement
 * the refresh flow described in docs/SECURITY.md instead.
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
