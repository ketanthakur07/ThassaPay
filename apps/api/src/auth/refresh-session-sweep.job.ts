import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';

/**
 * Cleanup for `refresh_sessions`.
 *
 * Before this job existed, every login and every rotation inserted a row that
 * NOTHING ever deleted (the schema's `@@index([expiresAt]) // expiry sweeps`
 * comment promised a sweep that was never written). The table grew without
 * bound.
 *
 * Why the deletion rule is FAMILY-scoped, not row-scoped:
 *
 *  A naive `DELETE ... WHERE expiresAt < now` would silently WEAKEN security.
 *  A consumed-but-unexpired row is not redeemable, yet it is load-bearing:
 *  replaying its token is exactly what reuse detection needs to see in order
 *  to burn the family (that is how a leaked old token forces the attacker's
 *  copy of the CURRENT token to die too). Deleting rows the moment they expire
 *  would turn those replays into "unknown token" 401s that burn NOTHING, and a
 *  family in active rotation (sliding 30-day window) could live forever while
 *  its consumed ancestors vanish — leaving the live token unprotectable.
 *
 * Therefore a row is deletable ONLY when every token in its family is past
 * expiry plus a retention grace: at that point no member can be redeemed, and
 * burning the family would be a no-op, so the rows have zero remaining security
 * value. The grace window exists for incident forensics (who revoked what,
 * when, and why) and never affects redemption semantics — an expired token is
 * rejected either way.
 *
 * Concurrency: the delete is a single idempotent statement; overlapping runs
 * (two replicas, a retry) simply race to delete disjoint/empty sets. Batching
 * bounds lock duration on very large backlogs.
 */

/** Forensic retention: keep dead families this long after their last expiry. */
export const DEAD_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Max rows deleted per statement — keeps each DELETE's lock window short. */
export const SWEEP_BATCH_SIZE = 1000;

/** Safety valve: a huge backlog drains over several daily runs, not one. */
export const MAX_BATCHES_PER_RUN = 50;

/**
 * A family is dead once its NEWEST token expired before this cutoff. Rows with
 * `expiresAt >= cutoff` are still within the retention grace (or redeemable).
 */
export function sweepCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - DEAD_SESSION_RETENTION_MS);
}

/**
 * Delete one batch of rows from families with no redeemable (or grace-period)
 * token left. Returns the number of rows deleted.
 *
 * The NOT EXISTS guard is the security invariant: a candidate row s is deleted
 * only if NO row in s.familyId has expiresAt >= cutoff. It deliberately does
 * not filter on consumedAt/revokedAt — a consumed-but-unexpired token must keep
 * its whole family alive so a replay can still trigger reuse detection.
 *
 * Exported separately from the cron class so the exact SQL runs against a real
 * Postgres in live verification, not only against a mocked client in jest.
 */
export function deleteDeadFamilySessions(
  client: Pick<PrismaService, '$executeRaw'>,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  return client.$executeRaw`
    DELETE FROM "refresh_sessions"
    WHERE "id" IN (
      SELECT s."id"
      FROM "refresh_sessions" s
      WHERE NOT EXISTS (
        SELECT 1
        FROM "refresh_sessions" live
        WHERE live."familyId" = s."familyId"
          AND live."expiresAt" >= ${cutoff}
      )
      ORDER BY s."id"
      LIMIT ${batchSize}
    )
  `;
}

@Injectable()
export class RefreshSessionSweepJob {
  private readonly logger = new Logger(RefreshSessionSweepJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily at 03:17 — off-peak; the exact minute avoids top-of-hour stampedes. */
  @Cron('17 3 * * *')
  async sweep(now: Date = new Date()): Promise<number> {
    const cutoff = sweepCutoff(now);
    let total = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const deleted = await deleteDeadFamilySessions(this.prisma, cutoff, SWEEP_BATCH_SIZE);
      total += deleted;
      if (deleted < SWEEP_BATCH_SIZE) break; // backlog drained
    }

    if (total > 0) {
      this.logger.log(
        `Refresh-session sweep deleted ${total} row(s) from fully-expired families (cutoff ${cutoff.toISOString()})`,
      );
    }
    return total;
  }
}
