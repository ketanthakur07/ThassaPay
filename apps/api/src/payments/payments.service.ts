import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentAttempt, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Money } from '../common/money/money';
import { CreatePaymentDto, ReportPaymentReturnDto } from './dto/create-payment.dto';
import { assertValidTransition } from './payment-state-machine';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent by design: retrying with the same idempotencyKey returns the
   * existing attempt instead of creating a duplicate. This is what makes it
   * safe for a flaky mobile network to retry the request.
   */
  async createPaymentAttempt(userId: string, dto: CreatePaymentDto): Promise<PaymentAttempt> {
    const existing = await this.prisma.paymentAttempt.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new BadRequestException('Idempotency key already used by another user');
      }
      return existing;
    }

    const amount = Money.fromRupees(dto.amount);
    // Audit fix (P2): `amount` accepts "0" — a zero-amount attempt would pass
    // isNegative() and create a real DB row that can never be an honest expense.
    if (amount.toPaise() <= 0n) {
      throw new BadRequestException('Amount must be positive');
    }

    let attempt: PaymentAttempt;
    try {
      attempt = await this.prisma.paymentAttempt.create({
        data: {
          userId,
          idempotencyKey: dto.idempotencyKey,
          amountPaise: amount.toPaise(),
          upiId: dto.upiId,
          status: PaymentStatus.INITIATED,
        },
      });
    } catch (err) {
      // Audit fix (P1): the find-then-create above is a race. Two parallel
      // retries (network flap, app resend) both miss the lookup and the second
      // one hit the unique index -> P2002 -> HTTP 500 for a request that was
      // supposed to be idempotent. Honour the contract: return the existing row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.paymentAttempt.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (winner) {
          if (winner.userId !== userId) {
            throw new BadRequestException('Idempotency key already used by another user');
          }
          return winner;
        }
      }
      throw err;
    }

    await this.prisma.paymentEvent.create({
      data: {
        paymentAttemptId: attempt.id,
        toStatus: PaymentStatus.INITIATED,
        reason: 'created',
      },
    });

    return attempt;
    // categoryId/description from the DTO are held by the client and sent again
    // when the expense is finalized on SUCCESS — see finalizeAsExpense() below.
  }

  /**
   * Called when the client returns from the UPI app. This NEVER sets SUCCESS —
   * it only records what the client observed, which moves the attempt to
   * AWAITING_CONFIRMATION (best case) or FAILED/CANCELLED (client is certain it
   * didn't happen). The reconciliation sweep or explicit user confirmation is
   * what can ever produce SUCCESS.
   */
  async reportReturn(userId: string, attemptId: string, dto: ReportPaymentReturnDto) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);

    const nextStatus: PaymentStatus =
      dto.outcome === 'app_returned_ok'
        ? PaymentStatus.AWAITING_CONFIRMATION
        : dto.outcome === 'user_cancelled'
          ? PaymentStatus.CANCELLED
          : PaymentStatus.FAILED;

    return this.transition(attempt, nextStatus, 'app_callback', dto.referenceId);
  }

  /**
   * Audit fix (P0): the reconciliation sweep runs every 5 minutes, but users
   * answer the "did it go through?" question seconds after returning from the
   * UPI app. This path also moves AWAITING_CONFIRMATION -> NEEDS_REVIEW so the
   * existing userConfirm() contract applies immediately, instead of the client
   * being blocked for 10+ minutes (or forever when the sweep result was lost).
   * SUCCESS still only ever comes from an explicit user confirmation below —
   * this does not create a client-controlled INITIATED -> SUCCESS path.
   */
  async reviewNow(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    return this.transition(attempt, PaymentStatus.NEEDS_REVIEW, 'user_review_requested');
  }

  /**
   * Explicit user confirmation for an attempt the sweep job moved to
   * NEEDS_REVIEW. This is the one place a human, not a client callback,
   * gets to say "yes this went through" — and it's the only path (besides a
   * future PSP webhook) that can set SUCCESS.
   */
  async userConfirm(userId: string, attemptId: string, didSucceed: boolean, categoryId: string, description?: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== PaymentStatus.NEEDS_REVIEW) {
      throw new BadRequestException(`Attempt is not awaiting review (status=${attempt.status})`);
    }

    const updated = await this.transition(
      attempt,
      didSucceed ? PaymentStatus.SUCCESS : PaymentStatus.FAILED,
      'user_confirmed',
    );

    if (didSucceed) {
      await this.finalizeAsExpense(updated, categoryId, description);
    }
    return updated;
  }

  private async transition(
    attempt: PaymentAttempt,
    to: PaymentStatus,
    reason: string,
    referenceId?: string,
  ): Promise<PaymentAttempt> {
    // Audit fix (P1): a lost response makes the client retry the SAME
    // transition (reportReturn / review are both retried by
    // PaymentResultScreen). Re-entering the status you are already in is a
    // no-op, not an error — previously it threw InvalidPaymentTransitionError
    // and surfaced as HTTP 500 for a perfectly benign retry.
    if (attempt.status === to) {
      return attempt;
    }

    assertValidTransition(attempt.status, to);

    return this.prisma.$transaction(async (tx) => {
      // Audit fix (P0): optimistic lock. The status was read outside this
      // transaction, so two concurrent transitions (user taps confirm while the
      // sweep runs, or a double-submit) could both validate and both write.
      // The WHERE clause pins the status we validated against: count 0 means
      // someone else already moved it — abort, never stack a second write.
      const updated = await tx.paymentAttempt.updateMany({
        where: { id: attempt.id, status: attempt.status },
        data: {
          status: to,
          referenceId: referenceId ?? attempt.referenceId,
          awaitingSince: to === PaymentStatus.AWAITING_CONFIRMATION ? new Date() : attempt.awaitingSince,
          completedAt: ['SUCCESS', 'FAILED', 'CANCELLED'].includes(to) ? new Date() : null,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('Payment attempt was updated concurrently; retry with its current status');
      }
      await tx.paymentEvent.create({
        data: {
          paymentAttemptId: attempt.id,
          fromStatus: attempt.status,
          toStatus: to,
          reason,
        },
      });
      return (await tx.paymentAttempt.findUnique({ where: { id: attempt.id } }))!;
    });
  }

  /** Only ever called from a SUCCESS transition. This is the ONE place an Expense gets created from UPI. */
  private async finalizeAsExpense(attempt: PaymentAttempt, categoryId: string, description?: string) {
    await this.prisma.expense.create({
      data: {
        userId: attempt.userId,
        categoryId,
        amountPaise: attempt.amountPaise,
        paymentMethod: 'UPI',
        source: 'UPI',
        description,
        expenseDate: attempt.completedAt ?? new Date(),
        paymentAttemptId: attempt.id,
      },
    });
  }

  /** Audit addition (Step 20): authoritative status lookup for client recovery after an app restart. */
  async getOwnedAttemptPublic(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    const expense = await this.prisma.expense.findUnique({
      where: { paymentAttemptId: attempt.id },
      select: { id: true, amountPaise: true },
    });
    return { ...attempt, expenseId: expense?.id ?? null };
  }

  private async getOwnedAttempt(userId: string, attemptId: string): Promise<PaymentAttempt> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundException('Payment attempt not found');
    }
    return attempt;
  }
}
