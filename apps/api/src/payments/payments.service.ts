import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentAttempt, PaymentStatus } from '@prisma/client';
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
    if (amount.isNegative()) {
      throw new BadRequestException('Amount must be positive');
    }

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        userId,
        idempotencyKey: dto.idempotencyKey,
        amountPaise: amount.toPaise(),
        upiId: dto.upiId,
        status: PaymentStatus.INITIATED,
      },
    });

    await this.prisma.paymentEvent.create({
      data: {
        paymentAttemptId: attempt.id,
        toStatus: PaymentStatus.INITIATED,
        reason: 'created',
      },
    });

    return attempt;
    // categoryId/description from the DTO are held by the client and sent again
    // when the expense is finalized on SUCCESS — see finalizeAsSuccess() below.
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
    assertValidTransition(attempt.status, to);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: to,
          referenceId: referenceId ?? attempt.referenceId,
          awaitingSince: to === PaymentStatus.AWAITING_CONFIRMATION ? new Date() : attempt.awaitingSince,
          completedAt: ['SUCCESS', 'FAILED', 'CANCELLED'].includes(to) ? new Date() : null,
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentAttemptId: attempt.id,
          fromStatus: attempt.status,
          toStatus: to,
          reason,
        },
      });
      return updated;
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

  private async getOwnedAttempt(userId: string, attemptId: string): Promise<PaymentAttempt> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundException('Payment attempt not found');
    }
    return attempt;
  }
}
