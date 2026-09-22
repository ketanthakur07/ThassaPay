import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Verifies the access token and attaches req.user. Access tokens are short-lived
 * (15 min); refresh happens via /auth/refresh using a rotated refresh token — see
 * auth.service.ts. Never extend access-token lifetime as a fix for UX friction;
 * fix it in the refresh flow instead.
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
      req.user = { id: payload.sub, collegeId: payload.collegeId };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
