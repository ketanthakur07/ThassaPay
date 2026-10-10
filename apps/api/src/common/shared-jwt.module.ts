import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * Single source of truth for JWT signing/verification across all modules.
 *
 * Audit fix (P0): JwtAuthGuard injects JwtService, so every module whose
 * controllers use the guard must be able to resolve it. Previously only
 * AuthModule and PaymentsModule registered JwtModule — with DIFFERENT
 * secrets — so the API could not boot, and tokens issued by AuthModule
 * would not verify in the payments context even if it had.
 *
 * Secret resolution order (matches .env.example):
 *   JWT_ACCESS_SECRET -> JWT_SECRET -> explicit dev fallback.
 * The dev fallback keeps local/test bootable; CI/staging/prod must set
 * JWT_ACCESS_SECRET. Expiry stays 15m (short-lived access tokens).
 */
export const DEV_JWT_FALLBACK_SECRET = 'thassapay-dev-super-secret-key-2026';

/**
 * Audit fix (P1): the fallback above is a literal in public source. If
 * production ever boots without JWT_ACCESS_SECRET/JWT_SECRET set, the API
 * happily signs AND verifies tokens with a secret everyone can read — i.e.
 * anyone can forge a token for any user. Refuse to start instead.
 */
export function resolveJwtSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    // Compromised-secret remediation: this literal was committed to the public
    // repo, so every token ever signed with it must be treated as forged. The
    // only invalidation mechanism available today (no refresh/denylist) is
    // secret rotation — so production must never accept the old value, even if
    // an operator copies it into JWT_ACCESS_SECRET from an old .env or doc.
    if (!secret) {
      throw new Error(
        'JWT_ACCESS_SECRET (or JWT_SECRET) must be set in production — refusing to boot with a known dev secret.',
      );
    }
    if (secret === DEV_JWT_FALLBACK_SECRET) {
      throw new Error(
        'JWT_ACCESS_SECRET is the compromised dev fallback secret — rotate it before booting production.',
      );
    }
    if (secret.length < 32) {
      throw new Error(
        'JWT_ACCESS_SECRET must be at least 32 characters in production — refusing a guessable signing key.',
      );
    }
  }

  return secret || DEV_JWT_FALLBACK_SECRET;
}

@Module({
  imports: [
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  exports: [JwtModule],
})
export class SharedJwtModule {}
