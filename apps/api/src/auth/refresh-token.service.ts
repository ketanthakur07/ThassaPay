import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

/**
 * Refresh-token lifecycle.
 *
 * Design (see docs/SECURITY.md for the full write-up):
 *  - Token is OPAQUE: 32 random bytes (256-bit) base64url-encoded. Not a JWT —
 *    there is nothing to sign or claim, and an opaque string can only ever be
 *    redeemed at this endpoint, which is exactly the property we want.
 *  - Storage is HASH-ONLY: the DB holds sha256(token) under a unique index. A
 *    database leak therefore yields no redeemable tokens. We use a fast hash
 *    (sha256), not bcrypt/argon2, because those exist to slow down guesses of
 *    LOW-entropy secrets (passwords). A 256-bit random token has no guessable
 *    surface, so a fast collision-resistant hash is the correct tool.
 *  - ROTATION: every successful refresh consumes the presented token and mints
 *    a successor in the same family. Consumption is a CONDITIONAL UPDATE
 *    (consumedAt IS NULL AND revokedAt IS NULL), so under Postgres row locking
 *    exactly one of any number of concurrent refreshes can win — two parallel
 *    requests can never mint two valid branches.
 *  - REUSE DETECTION: presenting a token that is already consumed or revoked
 *    means it leaked (a honest client only ever holds the newest token), so the
 *    ENTIRE family is revoked and the caller gets the same generic 401.
 *  - Generic errors: every failure mode returns the identical
 *    "Invalid or expired session" so the endpoint is an oracle for nothing.
 *
 * Session policy:
 *  - One DEVICE LOGIN == one family. `logout` revokes a single family.
 *  - `logoutAll` revokes every family for the user (all devices).
 *  - Access JWTs are NOT revoked here — they stay valid until their 15-minute
 *    expiry. Refresh revocation bounds a stolen token's usefulness to <=15 min.
 */

/** Refresh tokens are valid 30 days from issue; rotation slides the window. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Generic message shared by every failure path — deliberately uninformative. */
export const GENERIC_AUTH_ERROR = 'Invalid or expired session';

export interface IssuedRefreshToken {
  /** The raw token. Returned to the client exactly once; NEVER persisted. */
  token: string;
  sessionId: string;
  familyId: string;
  expiresAt: Date;
}

/** sha256 hex of a raw refresh token — the only form ever written to the DB. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** A fresh opaque token + its family id. Used at login to open a new family. */
function mintOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

/** Minimal client surface shared by the Prisma client and a transaction client. */
type SessionClient = Pick<PrismaClient, 'refreshSession'> | Pick<Prisma.TransactionClient, 'refreshSession'>;

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a session row and return the raw token exactly once. */
  private async createSession(
    client: SessionClient,
    data: { userId: string; familyId: string; previousSessionId?: string | null },
  ): Promise<IssuedRefreshToken> {
    const { raw, hash } = mintOpaqueToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const session = await client.refreshSession.create({
      data: {
        userId: data.userId,
        familyId: data.familyId,
        tokenHash: hash,
        previousSessionId: data.previousSessionId ?? null,
        expiresAt,
      },
    });
    return { token: raw, sessionId: session.id, familyId: session.familyId, expiresAt };
  }

  /** Open a brand-new session family. Called on successful OTP verification. */
  async issueForUser(userId: string): Promise<IssuedRefreshToken> {
    const familyId = randomBytes(16).toString('base64url');
    return this.createSession(this.prisma, { userId, familyId });
  }

  /**
   * Atomically consume `rawToken` and mint its successor in the same family.
   *
   * Throws UnauthorizedException (generic) unless a successor was produced.
   */
  async rotate(rawToken: string): Promise<IssuedRefreshToken & { userId: string }> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    const existing = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });

    // Unknown token. Same generic error as every other failure.
    if (!existing) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    // Unambiguous reuse: this token was already rotated or revoked. An honest
    // client only ever holds the newest token, so an old one reappearing means
    // it leaked — burn the whole family.
    if (existing.consumedAt || existing.revokedAt) {
      await this.revokeFamily(existing.familyId, 'reuse_detected');
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    // Expired. RefreshSessionSweepJob deletes fully-expired families (past a
    // 7-day forensic grace); no family action needed here.
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    // Atomic consume + successor creation. The conditional UPDATE is the gate:
    // under concurrency only one caller can flip consumedAt from NULL, so only
    // one successor is ever minted. A loser sees count === 0 and is rejected
    // WITHOUT minting a branch and WITHOUT revoking the family (a benign
    // double-refresh from one client is indistinguishable from a raced replay,
    // and killing the family would log out a legitimate user).
    const successor = await this.prisma
      .$transaction(async (tx) => {
        const consumed = await tx.refreshSession.updateMany({
          where: { id: existing.id, consumedAt: null, revokedAt: null },
          data: { consumedAt: new Date() },
        });
        if (consumed.count === 0) {
          return null; // lost the race — no branch created
        }
        return this.createSession(tx, {
          userId: existing.userId,
          familyId: existing.familyId,
          previousSessionId: existing.id,
        });
      })
      .catch((err: unknown) => {
        // A tokenHash unique violation means a (practically impossible) hash
        // collision on mint; surface it as auth failure, not a 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new UnauthorizedException(GENERIC_AUTH_ERROR);
        }
        throw err;
      });

    if (!successor) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    return { ...successor, userId: existing.userId };
  }

  /**
   * Revoke the family behind `rawToken` (single-device logout).
   *
   * Ownership is enforced: the token's session must belong to the
   * authenticated user. A mismatch is a silent no-op (we do not leak whether a
   * token exists or whose it is), keeping logout idempotent and uninformative.
   */
  async revokeByToken(rawToken: string, authenticatedUserId: string): Promise<void> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) return;

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken) },
    });

    // Not found, or belongs to a different user: do nothing, reveal nothing.
    if (!session || session.userId !== authenticatedUserId) return;

    await this.revokeFamily(session.familyId, 'logout');
  }

  /** Revoke every live session for a user (logout from all devices). */
  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout_all' },
    });
    return res.count;
  }

  /** Mark every unrevoked session in a family as revoked. */
  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
