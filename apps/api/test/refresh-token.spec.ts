import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RefreshTokenService,
  REFRESH_TOKEN_TTL_MS,
  hashRefreshToken,
} from '../src/auth/refresh-token.service';

/**
 * Refresh-token lifecycle (Steps 3-6 of the refresh-token task).
 *
 * The Prisma layer is mocked with an in-memory store that faithfully reproduces
 * the two semantics the service depends on:
 *   1. `tokenHash` is UNIQUE (create throws on collision).
 *   2. `updateMany` honours the WHERE filter atomically and returns `{ count }`
 *      — this is what makes rotation safe under concurrency, so the mock must
 *      apply the filter or the concurrency tests would prove nothing.
 */
type Row = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  previousSessionId: string | null;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
};

const rows = new Map<string, Row>(); // keyed by id

function matches(row: Row, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.familyId !== undefined && row.familyId !== where.familyId) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
  // NULL-match semantics used by the service's conditional consume.
  if (where.consumedAt === null && row.consumedAt !== null) return false;
  if (where.revokedAt === null && row.revokedAt !== null) return false;
  return true;
}

const prisma: any = {
  refreshSession: {
    findUnique: async (args: any) => {
      for (const row of rows.values()) {
        if (matches(row, args.where)) return { ...row };
      }
      return null;
    },
    create: async (args: any) => {
      const d = args.data;
      // Enforce the unique tokenHash constraint like the real DB would.
      for (const row of rows.values()) {
        if (row.tokenHash === d.tokenHash) {
          throw Object.assign(new Error('Unique constraint failed on tokenHash'), { code: 'P2002' });
        }
      }
      const row: Row = {
        id: randomUUID(),
        previousSessionId: null,
        issuedAt: new Date(),
        consumedAt: null,
        revokedAt: null,
        revokedReason: null,
        ...d,
      };
      rows.set(row.id, row);
      return { ...row };
    },
    updateMany: async (args: any) => {
      let count = 0;
      for (const row of rows.values()) {
        if (matches(row, args.where)) {
          Object.assign(row, args.data);
          count++;
        }
      }
      return { count };
    },
  },
  $transaction: async (fn: any) => fn(prisma),
};

const USER_A = 'user-a';
const USER_B = 'user-b';

function service(): RefreshTokenService {
  return new RefreshTokenService(prisma);
}

beforeEach(() => {
  rows.clear();
});

describe('issue + valid refresh', () => {
  it('issues a high-entropy opaque token and stores only its hash', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url, 256-bit
    expect(issued.token.length).toBeGreaterThanOrEqual(43);

    const stored = [...rows.values()][0];
    expect(stored.tokenHash).toBe(hashRefreshToken(issued.token));
    // The raw token must never appear anywhere in the persisted row.
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it('issues two distinct tokens for two logins', async () => {
    const svc = service();
    const a = await svc.issueForUser(USER_A);
    const b = await svc.issueForUser(USER_A);
    expect(a.token).not.toBe(b.token);
    expect(a.familyId).not.toBe(b.familyId);
  });

  it('rotates a valid token into a successor in the same family', async () => {
    const svc = service();
    const first = await svc.issueForUser(USER_A);
    const second = await svc.rotate(first.token);

    expect(second.token).not.toBe(first.token);
    expect(second.familyId).toBe(first.familyId);
    expect(second.userId).toBe(USER_A);
    // The chain is recorded for forensics.
    const successorRow = [...rows.values()].find((r) => r.tokenHash === hashRefreshToken(second.token))!;
    expect(successorRow.previousSessionId).toBeTruthy();
  });

  it('the old token is consumed after rotation and cannot be reused', async () => {
    const svc = service();
    const first = await svc.issueForUser(USER_A);
    await svc.rotate(first.token);
    await expect(svc.rotate(first.token)).rejects.toThrow(UnauthorizedException);
  });
});

describe('expiry, invalid, revoked', () => {
  it('rejects an expired refresh token with the generic error', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);
    // Force-expire the stored row.
    const row = [...rows.values()][0];
    row.expiresAt = new Date(Date.now() - 1000);

    await expect(svc.rotate(issued.token)).rejects.toThrow('Invalid or expired session');
  });

  it('rejects an unknown/garbage token', async () => {
    const svc = service();
    await expect(svc.rotate('not-a-real-token')).rejects.toThrow('Invalid or expired session');
    await expect(svc.rotate('')).rejects.toThrow('Invalid or expired session');
  });

  it('rejects an already-revoked token', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);
    await svc.revokeByToken(issued.token, USER_A);

    await expect(svc.rotate(issued.token)).rejects.toThrow('Invalid or expired session');
  });

  it('uses the SAME generic message for every failure mode (no oracle)', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);
    const row = [...rows.values()][0];
    row.expiresAt = new Date(Date.now() - 1000);

    const messages = new Set<string>();
    for (const fn of [
      () => svc.rotate('never-existed'),
      () => svc.rotate(issued.token), // now expired
    ]) {
      await fn().catch((e: Error) => messages.add(e.message));
    }
    expect(messages.size).toBe(1);
    expect([...messages][0]).toBe('Invalid or expired session');
  });
});

describe('reuse detection (rotation leak)', () => {
  it('revokes the whole family when a consumed token is replayed', async () => {
    const svc = service();
    const t1 = await svc.issueForUser(USER_A);
    const t2 = await svc.rotate(t1.token); // t1 now consumed
    const t3 = await svc.rotate(t2.token); // t2 now consumed

    // Attacker replays the already-rotated t1 -> burn the family.
    await expect(svc.rotate(t1.token)).rejects.toThrow('Invalid or expired session');

    const family = [...rows.values()].filter((r) => r.familyId === t1.familyId);
    expect(family.every((r) => r.revokedAt !== null)).toBe(true);
    expect(family.every((r) => r.revokedReason === 'reuse_detected')).toBe(true);

    // The newest legitimate token is now dead too — that is the point.
    await expect(svc.rotate(t3.token)).rejects.toThrow('Invalid or expired session');
  });

  it('reuse detection does not touch OTHER families', async () => {
    const svc = service();
    const a1 = await svc.issueForUser(USER_A);
    const b1 = await svc.issueForUser(USER_B);
    await svc.rotate(a1.token);

    await expect(svc.rotate(a1.token)).rejects.toThrow('Invalid or expired session'); // A burned

    const bRow = [...rows.values()].find((r) => r.familyId === b1.familyId)!;
    expect(bRow.revokedAt).toBeNull(); // B unaffected
    await expect(svc.rotate(b1.token)).resolves.toBeDefined();
  });
});

describe('logout + revocation policy', () => {
  it('logout revokes only that session family', async () => {
    const svc = service();
    const deviceA = await svc.issueForUser(USER_A);
    const deviceB = await svc.issueForUser(USER_A); // second device

    await svc.revokeByToken(deviceA.token, USER_A);

    await expect(svc.rotate(deviceA.token)).rejects.toThrow('Invalid or expired session');
    // The other device keeps working.
    await expect(svc.rotate(deviceB.token)).resolves.toBeDefined();
  });

  it('logout-all revokes every session for the user', async () => {
    const svc = service();
    const d1 = await svc.issueForUser(USER_A);
    const d2 = await svc.issueForUser(USER_A);
    const otherUser = await svc.issueForUser(USER_B);

    const revoked = await svc.revokeAllForUser(USER_A);
    expect(revoked).toBe(2);

    await expect(svc.rotate(d1.token)).rejects.toThrow('Invalid or expired session');
    await expect(svc.rotate(d2.token)).rejects.toThrow('Invalid or expired session');
    // Another user's sessions are untouched.
    await expect(svc.rotate(otherUser.token)).resolves.toBeDefined();
  });

  it('a user cannot revoke (or touch) another user’s session', async () => {
    const svc = service();
    const victim = await svc.issueForUser(USER_A);
    // Attacker (USER_B) presents the victim's token at logout with B's identity.
    await svc.revokeByToken(victim.token, USER_B);

    // Ownership mismatch = silent no-op: the victim's session still works.
    const victimRow = [...rows.values()].find((r) => r.familyId === victim.familyId)!;
    expect(victimRow.revokedAt).toBeNull();
    await expect(svc.rotate(victim.token)).resolves.toBeDefined();
  });

  it('logout is idempotent and reveals nothing for an unknown token', async () => {
    const svc = service();
    await expect(svc.revokeByToken('who-dat', USER_A)).resolves.toBeUndefined();
  });
});

describe('concurrency', () => {
  it('two concurrent refreshes with the same token produce exactly ONE successor', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);

    // Fire both rotations before either resolves. The conditional UPDATE
    // (consumedAt IS NULL) is the gate: only one can win.
    const results = await Promise.allSettled([svc.rotate(issued.token), svc.rotate(issued.token)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);

    // Exactly one live (unconsumed, unrevoked) token remains for the family.
    const live = [...rows.values()].filter(
      (r) => r.familyId === issued.familyId && !r.consumedAt && !r.revokedAt,
    );
    expect(live).toHaveLength(1);
  });

  it('N concurrent refreshes with the same token still mint exactly one successor', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => svc.rotate(issued.token)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const live = [...rows.values()].filter(
      (r) => r.familyId === issued.familyId && !r.consumedAt && !r.revokedAt,
    );
    expect(live).toHaveLength(1);
  });

  it('a lost race does NOT revoke the family (benign double-refresh)', async () => {
    const svc = service();
    const issued = await svc.issueForUser(USER_A);

    await Promise.allSettled([svc.rotate(issued.token), svc.rotate(issued.token)]);

    // The winner's token must still be usable — a race is not reuse.
    const winner = [...rows.values()].find(
      (r) => r.familyId === issued.familyId && !r.consumedAt && !r.revokedAt,
    )!;
    expect(winner.revokedAt).toBeNull();
  });
});

describe('expiry window', () => {
  it('a rotated successor gets a fresh full TTL (sliding window)', async () => {
    const svc = service();
    const t1 = await svc.issueForUser(USER_A);
    const t2 = await svc.rotate(t1.token);

    const row = [...rows.values()].find((r) => r.tokenHash === hashRefreshToken(t2.token))!;
    const expected = row.issuedAt.getTime() + REFRESH_TOKEN_TTL_MS;
    expect(row.expiresAt.getTime()).toBeCloseTo(expected, -3);
    expect(REFRESH_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
