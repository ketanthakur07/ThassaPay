import { PaymentStatus } from '@prisma/client';
import { ReconciliationJob } from '../src/payments/reconciliation.job';

/**
 * Audit (Step 12): the sweep must be idempotent and must never touch Expense.
 * Prisma is mocked so the exact query and write sequence is observable.
 */
const staleRow = {
  id: 'att-1',
  userId: 'user-a',
  idempotencyKey: 'key-1',
  amountPaise: 15000n,
  upiId: 'canteen@okaxis',
  referenceId: null,
  status: PaymentStatus.AWAITING_CONFIRMATION,
  initiatedAt: new Date(),
  awaitingSince: new Date(Date.now() - 20 * 60_000),
  completedAt: null,
  failureReason: null,
};

let rows: any[] = [];
const events: any[] = [];
const expenseWrites: any[] = [];
let lastWhere: any;

const prisma: any = {
  paymentAttempt: {
    findMany: jest.fn(async (args: any) => {
      lastWhere = args.where;
      // Honour the real query: only rows still in the swept status and older
      // than the cutoff. Return detached copies, like Prisma does — mutating a
      // shared reference would hide exactly the races this test exists for.
      const cutoff: Date = args.where.awaitingSince.lt;
      return rows
        .filter(
          (r) => r.status === args.where.status && r.awaitingSince && r.awaitingSince < cutoff,
        )
        .map((r) => ({ ...r }));
    }),
    updateMany: jest.fn(async (args: any) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row || row.status !== args.where.status) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    }),
  },
  paymentEvent: {
    create: jest.fn(async (args: any) => {
      events.push(args.data);
      return args.data;
    }),
  },
  expense: {
    create: jest.fn(async (args: any) => {
      expenseWrites.push(args.data);
      return { id: 'exp-x', ...args.data };
    }),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
};

function job(): ReconciliationJob {
  return new ReconciliationJob(prisma);
}

beforeEach(() => {
  rows = [staleRow];
  events.length = 0;
  expenseWrites.length = 0;
  jest.clearAllMocks();
  staleRow.status = PaymentStatus.AWAITING_CONFIRMATION;
  staleRow.awaitingSince = new Date(Date.now() - 20 * 60_000);
});

describe('reconciliation sweep', () => {
  it('only selects stale AWAITING_CONFIRMATION attempts', async () => {
    await job().sweep();
    expect(lastWhere).toMatchObject({ status: PaymentStatus.AWAITING_CONFIRMATION });
    expect(lastWhere.awaitingSince).toHaveProperty('lt');
    expect(lastWhere.awaitingSince.lt).toBeInstanceOf(Date);
    expect(lastWhere.awaitingSince.lt.getTime()).toBeLessThan(Date.now());
  });

  it('moves a stale attempt to NEEDS_REVIEW and appends one event', async () => {
    await job().sweep();
    expect(staleRow.status).toBe(PaymentStatus.NEEDS_REVIEW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      paymentAttemptId: staleRow.id,
      fromStatus: PaymentStatus.AWAITING_CONFIRMATION,
      toStatus: PaymentStatus.NEEDS_REVIEW,
      reason: 'sweep_timeout',
    });
  });

  it('is idempotent: a second sweep over the same rows writes nothing', async () => {
    await job().sweep();
    const afterFirst = events.length;
    await job().sweep();
    expect(events.length).toBe(afterFirst);
    expect(staleRow.status).toBe(PaymentStatus.NEEDS_REVIEW);
  });

  it('does not disturb an attempt another writer already moved (count = 0 path)', async () => {
    prisma.paymentAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    await job().sweep();
    expect(events).toHaveLength(0);
  });

  it('never creates, updates or deletes an expense', async () => {
    await job().sweep();
    await job().sweep();
    expect(expenseWrites).toHaveLength(0);
    expect(prisma.expense.update).not.toHaveBeenCalled();
    expect(prisma.expense.delete).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is stale', async () => {
    rows = [];
    await job().sweep();
    expect(events).toHaveLength(0);
    expect(prisma.paymentAttempt.updateMany).not.toHaveBeenCalled();
  });
});
