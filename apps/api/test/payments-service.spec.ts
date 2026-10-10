import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Audit (Steps 10, 11, 13): service-level payment behaviour.
 *
 * The state machine file is covered exhaustively in
 * payment-state-machine.spec.ts; what is under test HERE is what the service
 * actually writes to the DB under retries, races and cross-user access:
 *   - idempotency (same key twice, concurrent duplicates)
 *   - no client-controlled path to SUCCESS
 *   - exactly one expense per SUCCESS, never for FAILED/CANCELLED/NEEDS_REVIEW
 *   - ownership: User A can never touch User B's attempt
 */
type Row = {
  id: string;
  userId: string;
  idempotencyKey: string;
  amountPaise: bigint;
  upiId: string;
  referenceId: string | null;
  status: PaymentStatus;
  initiatedAt: Date;
  awaitingSince: Date | null;
  completedAt: Date | null;
  failureReason: string | null;
};

const attempts = new Map<string, Row>(); // keyed by id
const events: Array<{ paymentAttemptId: string; fromStatus?: PaymentStatus; toStatus: PaymentStatus; reason?: string }> = [];
const expenses: Array<{ id: string; paymentAttemptId?: string; amountPaise: bigint; userId: string }> = [];

function findById(id: string): Row | undefined {
  return attempts.get(id);
}

function findByKey(key: string): Row | undefined {
  for (const row of attempts.values()) if (row.idempotencyKey === key) return row;
  return undefined;
}

const prisma: any = {
  paymentAttempt: {
    findUnique: async (args: any) =>
      args.where.id ? findById(args.where.id) : findByKey(args.where.idempotencyKey),
    create: async (args: any) => {
      if (findByKey(args.data.idempotencyKey)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.20.0',
        });
      }
      const row: Row = {
        id: `att-${attempts.size + 1}`,
        referenceId: null,
        initiatedAt: new Date(),
        awaitingSince: null,
        completedAt: null,
        failureReason: null,
        ...args.data,
      };
      attempts.set(row.id, row);
      return row;
    },
    // Optimistic lock: only mutates when the stored status matches the read one.
    updateMany: async (args: any) => {
      const row = findById(args.where.id);
      if (!row || row.status !== args.where.status) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  },
  paymentEvent: {
    create: async (args: any) => {
      events.push(args.data);
      return args.data;
    },
  },
  expense: {
    create: async (args: any) => {
      if (
        args.data.paymentAttemptId &&
        expenses.some((e) => e.paymentAttemptId === args.data.paymentAttemptId)
      ) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.20.0',
        });
      }
      const row = { id: `exp-${expenses.length + 1}`, ...args.data };
      expenses.push(row);
      return row;
    },
    findUnique: async (args: any) =>
      expenses.find((e) => e.paymentAttemptId === args.where.paymentAttemptId) ?? null,
  },
  $transaction: async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
};

const CATEGORY = '6d568754-bd00-478a-8f0b-b0056b9cb8c7';

function service(): PaymentsService {
  return new PaymentsService(prisma);
}

function seed(userId = 'user-a', key = 'idem-key-0001', amountPaise = 15000n): Row {
  const row: Row = {
    id: `seed-${attempts.size + 1}`,
    userId,
    idempotencyKey: key,
    amountPaise,
    upiId: 'canteen@okaxis',
    referenceId: null,
    status: PaymentStatus.INITIATED,
    initiatedAt: new Date(),
    awaitingSince: null,
    completedAt: null,
    failureReason: null,
  };
  attempts.set(row.id, row);
  return row;
}

beforeEach(() => {
  attempts.clear();
  events.length = 0;
  expenses.length = 0;
});

describe('idempotency (Step 11)', () => {
  const dto = { idempotencyKey: 'idem-key-0001', amount: '150.00', upiId: 'canteen@okaxis', categoryId: CATEGORY };

  it('creates exactly one attempt for a repeated request', async () => {
    const first = await service().createPaymentAttempt('user-a', dto);
    const second = await service().createPaymentAttempt('user-a', dto);
    expect(second.id).toBe(first.id);
    expect(attempts.size).toBe(1);
    expect(events.filter((e) => e.reason === 'created')).toHaveLength(1);
  });

  it('returns the original attempt when the same key is sent with a different payload', async () => {
    const first = await service().createPaymentAttempt('user-a', dto);
    const second = await service().createPaymentAttempt('user-a', {
      ...dto,
      amount: '999.99',
      upiId: 'someone@okbiz',
    });
    expect(second.id).toBe(first.id);
    expect(second.amountPaise).toBe(15000n); // original wins, no silent overwrite
    expect(attempts.size).toBe(1);
  });

  it('returns the existing attempt when two parallel requests race on the unique key', async () => {
    // Simulate the interleaving: the row exists (winner committed) but our
    // pre-check read a snapshot from before it — create() then hits P2002.
    const winner = seed('user-a', 'idem-key-race');
    const spy = jest.spyOn(prisma.paymentAttempt, 'findUnique');
    spy.mockResolvedValueOnce(null).mockImplementation(async (args: any) =>
      args.where.id ? findById(args.where.id) : findByKey(args.where.idempotencyKey),
    );

    const result = await service().createPaymentAttempt('user-a', {
      ...dto,
      idempotencyKey: 'idem-key-race',
    });
    expect(result.id).toBe(winner.id);
    expect(attempts.size).toBe(1); // no duplicate row
    spy.mockRestore();
  });

  it('never lets a second user reuse an idempotency key', async () => {
    await service().createPaymentAttempt('user-a', dto);
    await expect(service().createPaymentAttempt('user-b', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(attempts.size).toBe(1);
  });

  it('rejects a zero-amount payment before it reaches the DB', async () => {
    await expect(
      service().createPaymentAttempt('user-a', { ...dto, amount: '0' }),
    ).rejects.toThrow(/Amount must be positive/);
    expect(attempts.size).toBe(0);
  });
});

describe('client cannot manufacture success (Step 10)', () => {
  it('reportReturn never yields SUCCESS for any outcome', async () => {
    for (const outcome of ['app_returned_ok', 'user_cancelled', 'app_returned_error'] as const) {
      attempts.clear();
      const row = seed();
      const res = await service().reportReturn('user-a', row.id, { outcome });
      expect(res.status).not.toBe(PaymentStatus.SUCCESS);
    }
  });

  it('app_returned_ok moves INITIATED -> AWAITING_CONFIRMATION', async () => {
    const row = seed();
    const res = await service().reportReturn('user-a', row.id, { outcome: 'app_returned_ok' });
    expect(res.status).toBe(PaymentStatus.AWAITING_CONFIRMATION);
    expect(res.awaitingSince).toBeInstanceOf(Date);
  });

  it('replaying the same return report is a no-op (no duplicate events)', async () => {
    const row = seed();
    await service().reportReturn('user-a', row.id, { outcome: 'app_returned_ok' });
    const countAfterFirst = events.length;
    const replay = await service().reportReturn('user-a', row.id, { outcome: 'app_returned_ok' });
    expect(replay.status).toBe(PaymentStatus.AWAITING_CONFIRMATION);
    expect(events.length).toBe(countAfterFirst); // retry did not append a second event
  });

  it('reviewNow moves AWAITING -> NEEDS_REVIEW and is idempotent on retry', async () => {
    const row = seed();
    await service().reportReturn('user-a', row.id, { outcome: 'app_returned_ok' });
    const first = await service().reviewNow('user-a', row.id);
    expect(first.status).toBe(PaymentStatus.NEEDS_REVIEW);
    const countAfterFirst = events.length;
    const retry = await service().reviewNow('user-a', row.id);
    expect(retry.status).toBe(PaymentStatus.NEEDS_REVIEW);
    expect(events.length).toBe(countAfterFirst);
  });

  it('confirm is refused unless the attempt is in NEEDS_REVIEW', async () => {
    const row = seed(); // INITIATED
    await expect(
      service().userConfirm('user-a', row.id, true, CATEGORY),
    ).rejects.toThrow(BadRequestException);
    expect(expenses).toHaveLength(0);
  });

  it('INITIATED -> SUCCESS and FAILED -> SUCCESS are unreachable through the service', async () => {
    const initiated = seed();
    await expect(
      service().userConfirm('user-a', initiated.id, true, CATEGORY),
    ).rejects.toThrow(BadRequestException);

    const failed = seed('user-a', 'idem-key-failed');
    failed.status = PaymentStatus.FAILED;
    await expect(
      service().userConfirm('user-a', failed.id, true, CATEGORY),
    ).rejects.toThrow(BadRequestException);
    expect(expenses).toHaveLength(0);
  });
});

describe('expense integrity (Step 13)', () => {
  async function moveToReview(row: Row) {
    await service().reportReturn('user-a', row.id, { outcome: 'app_returned_ok' });
    await service().reviewNow('user-a', row.id);
  }

  it('creates exactly one expense on a confirmed SUCCESS', async () => {
    const row = seed();
    await moveToReview(row);
    const res = await service().userConfirm('user-a', row.id, true, CATEGORY, 'Mess lunch');
    expect(res.status).toBe(PaymentStatus.SUCCESS);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountPaise).toBe(row.amountPaise);
    expect(expenses[0].paymentAttemptId).toBe(row.id);
    expect(expenses[0].userId).toBe('user-a');
  });

  it('a second confirm after SUCCESS cannot create a second expense', async () => {
    const row = seed();
    await moveToReview(row);
    await service().userConfirm('user-a', row.id, true, CATEGORY);
    await expect(service().userConfirm('user-a', row.id, true, CATEGORY)).rejects.toThrow(
      BadRequestException,
    );
    expect(expenses).toHaveLength(1);
  });

  it('a denied confirmation (didSucceed=false) creates no expense', async () => {
    const row = seed();
    await moveToReview(row);
    const res = await service().userConfirm('user-a', row.id, false, CATEGORY);
    expect(res.status).toBe(PaymentStatus.FAILED);
    expect(expenses).toHaveLength(0);
  });

  it('NEEDS_REVIEW / FAILED / CANCELLED attempts never hold an expense', async () => {
    const review = seed();
    await moveToReview(review);
    expect(expenses).toHaveLength(0);

    const cancelled = seed('user-a', 'idem-key-cancelled');
    cancelled.status = PaymentStatus.CANCELLED;
    await service().reportReturn('user-a', cancelled.id, { outcome: 'user_cancelled' as any }).catch(() => undefined);
    expect(expenses).toHaveLength(0);
  });

  it('a racing confirm loses cleanly: conflict, no duplicate expense, no duplicate event', async () => {
    const row = seed();
    await moveToReview(row);
    const eventCount = events.length;

    // Simulate another writer moving the row between our read and our write.
    const spy = jest.spyOn(prisma.paymentAttempt, 'updateMany').mockResolvedValueOnce({ count: 0 });
    await expect(service().userConfirm('user-a', row.id, true, CATEGORY)).rejects.toThrow(
      ConflictException,
    );
    spy.mockRestore();

    expect(expenses).toHaveLength(0);
    expect(events.length).toBe(eventCount); // no phantom payment_event row
    expect(findById(row.id)!.status).toBe(PaymentStatus.NEEDS_REVIEW);
  });

  it('exposes the created expense through the authoritative status lookup', async () => {
    const row = seed();
    await moveToReview(row);
    await service().userConfirm('user-a', row.id, true, CATEGORY);
    const lookup = await service().getOwnedAttemptPublic('user-a', row.id);
    expect(lookup.status).toBe(PaymentStatus.SUCCESS);
    expect(lookup.expenseId).toBeTruthy();
  });
});

describe('ownership (Step 9 / 22)', () => {
  it('User B cannot read, review or confirm User A\u2019s attempt', async () => {
    const row = seed('user-a');
    await expect(service().getOwnedAttemptPublic('user-b', row.id)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service().reviewNow('user-b', row.id)).rejects.toThrow(NotFoundException);
    await expect(service().userConfirm('user-b', row.id, true, CATEGORY)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service().reportReturn('user-b', row.id, { outcome: 'app_returned_ok' })).rejects.toThrow(
      NotFoundException,
    );
    expect(expenses).toHaveLength(0);
  });

  it('a non-existent attempt id is a 404, not a 500', async () => {
    await expect(service().getOwnedAttemptPublic('user-a', 'missing-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});
