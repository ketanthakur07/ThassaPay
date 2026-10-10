import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { assertValidTransition } from './payment-state-machine';

/**
 * This job is the answer to "UPI Intent gives us no reliable success signal."
 * Anything sitting in AWAITING_CONFIRMATION for too long gets moved to
 * NEEDS_REVIEW and the user is asked directly. This queue's depth is also
 * the single most important operational metric in the app — a spike means
 * the UPI intent flow (or a specific UPI app) started behaving differently
 * and needs investigating, not that students are suddenly flakier.
 */
@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);
  private readonly TIMEOUT_MINUTES = 10;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.TIMEOUT_MINUTES * 60_000);

    const stale = await this.prisma.paymentAttempt.findMany({
      where: {
        status: PaymentStatus.AWAITING_CONFIRMATION,
        awaitingSince: { lt: cutoff },
      },
    });

    for (const attempt of stale) {
      assertValidTransition(attempt.status, PaymentStatus.NEEDS_REVIEW);
      // Audit fix (P1): the job must be idempotent when it runs twice (overlapping
      // sweeps, two API replicas, a retry after a crash). The WHERE clause pins
      // the status we read: if another sweep — or a user confirmation — already
      // moved the attempt, count is 0 and we write nothing, so no duplicate
      // payment_event row is ever appended. It can never create an expense:
      // this job does not touch Expense at all.
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, status: PaymentStatus.AWAITING_CONFIRMATION },
          data: { status: PaymentStatus.NEEDS_REVIEW },
        });
        if (updated.count === 0) {
          return; // already handled elsewhere — do not double-log
        }
        await tx.paymentEvent.create({
          data: {
            paymentAttemptId: attempt.id,
            fromStatus: attempt.status,
            toStatus: PaymentStatus.NEEDS_REVIEW,
            reason: 'sweep_timeout',
          },
        });
      });

      // TODO: push a notification via the (separate) notifications module —
      // "Did your ₹X payment to <upiId> go through?" — intentionally not wired
      // here to keep this job's only job as reconciliation, not delivery.
      this.logger.warn(`Payment attempt ${attempt.id} moved to NEEDS_REVIEW after timeout`);
    }

    if (stale.length > 0) {
      this.logger.log(`Reconciliation sweep moved ${stale.length} attempt(s) to NEEDS_REVIEW`);
    }
  }
}
