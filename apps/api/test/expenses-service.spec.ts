import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService } from '../src/expenses/expenses.service';

/**
 * Audit (Step 13): expense integrity — sign guards, soft delete (never a hard
 * delete), correction history, and user scoping on every read/write.
 */
const rows: any[] = [];
const audits: any[] = [];

const prisma: any = {
  expense: {
    create: jest.fn(async (args: any) => {
      const row = {
        id: `exp-${rows.length + 1}`,
        deletedAt: null,
        correctedFromId: null,
        category: { id: args.data.categoryId, name: 'Food' },
        ...args.data,
      };
      rows.push(row);
      return row;
    }),
    findFirst: jest.fn(async (args: any) => {
      const where = args.where;
      return (
        rows.find(
          (r) =>
            r.id === where.id &&
            r.userId === where.userId &&
            (where.deletedAt === null ? r.deletedAt === null : true),
        ) ?? null
      );
    }),
    findMany: jest.fn(async (args: any) => {
      const where = args.where;
      return rows.filter((r) => {
        if (r.userId !== where.userId) return false;
        if (where.deletedAt === null && r.deletedAt !== null) return false;
        return true;
      });
    }),
    update: jest.fn(async (args: any) => {
      const row = rows.find((r) => r.id === args.where.id);
      Object.assign(row, args.data);
      return row;
    }),
  },
  auditLog: {
    create: jest.fn(async (args: any) => {
      audits.push(args.data);
      return args.data;
    }),
  },
};

const CATEGORY = '6d568754-bd00-478a-8f0b-b0056b9cb8c7';
const service = () => new ExpensesService(prisma);

beforeEach(() => {
  rows.length = 0;
  audits.length = 0;
  jest.clearAllMocks();
});

describe('amount guards (Step 7 / 13)', () => {
  it('rejects zero and negative amounts for both string and number wire forms', async () => {
    for (const bad of ['0', '-100', 0, -100]) {
      await expect(
        service().create('user-a', {
          categoryId: CATEGORY,
          amountPaise: bad,
          paymentMethod: 'UPI',
        }),
      ).rejects.toThrow(BadRequestException);
    }
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('rejects an unparseable amount instead of coercing it', async () => {
    await expect(
      service().create('user-a', {
        categoryId: CATEGORY,
        amountPaise: '12.5',
        paymentMethod: 'UPI',
      }),
    ).rejects.toThrow();
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid expenseDate', async () => {
    await expect(
      service().create('user-a', {
        categoryId: CATEGORY,
        amountPaise: '15000',
        paymentMethod: 'UPI',
        expenseDate: 'not-a-date',
      }),
    ).rejects.toThrow(/Invalid expenseDate/);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('accepts a valid amount and stores it as exact BigInt paise', async () => {
    const res = await service().create('user-a', {
      categoryId: CATEGORY,
      amountPaise: '99999',
      paymentMethod: 'UPI',
    });
    expect(res.amountPaise).toBe(99999n);
    expect(res.source).toBe('MANUAL');
  });

  it('marks an expense as UPI-sourced when it carries a payment attempt', async () => {
    const res = await service().create('user-a', {
      categoryId: CATEGORY,
      amountPaise: 15000,
      paymentMethod: 'UPI',
      paymentAttemptId: 'att-1',
    });
    expect(res.source).toBe('UPI');
    expect(res.paymentAttemptId).toBe('att-1');
  });
});

describe('ownership and soft delete', () => {
  it('scopes every read to the requesting user', async () => {
    await service().create('user-a', { categoryId: CATEGORY, amountPaise: '100', paymentMethod: 'CASH' });
    const mine = await service().findAllForUser('user-a', {});
    const theirs = await service().findAllForUser('user-b', {});
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(prisma.expense.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-b' }) }),
    );
  });

  it("returns 404 when another user's expense is targeted", async () => {
    await service().create('user-a', { categoryId: CATEGORY, amountPaise: '100', paymentMethod: 'CASH' });
    const id = rows[0].id;
    await expect(service().softDelete('user-b', id)).rejects.toThrow(NotFoundException);
    await expect(
      service().correctExpense('user-b', id, {
        categoryId: CATEGORY,
        amountPaise: '100',
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(rows[0].deletedAt).toBeNull(); // untouched
  });

  it('soft-deletes (sets deletedAt) and writes an audit log — never a hard delete', async () => {
    await service().create('user-a', { categoryId: CATEGORY, amountPaise: '25000', paymentMethod: 'CASH' });
    const id = rows[0].id;
    const res = await service().softDelete('user-a', id);

    expect(res).toEqual({ success: true });
    expect(prisma.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(prisma.expense.delete).toBeUndefined(); // no hard-delete API used at all
    expect(rows[0].deletedAt).toBeInstanceOf(Date);
    expect(audits[0]).toMatchObject({ action: 'expense.soft_deleted', targetId: id });
  });

  it('hides soft-deleted expenses from listings', async () => {
    await service().create('user-a', { categoryId: CATEGORY, amountPaise: '100', paymentMethod: 'CASH' });
    await service().softDelete('user-a', rows[0].id);
    expect(await service().findAllForUser('user-a', {})).toHaveLength(0);
  });

  it('correction keeps history: original is soft-deleted, new row points back', async () => {
    await service().create('user-a', { categoryId: CATEGORY, amountPaise: '25000', paymentMethod: 'CASH' });
    const originalId = rows[0].id;

    const corrected = await service().correctExpense('user-a', originalId, {
      categoryId: CATEGORY,
      amountPaise: '26000',
      paymentMethod: 'CASH',
    });

    // correctExpense() answers with an exact number (JSON contract), matching list/analytics.
    expect(corrected.amountPaise).toBe(26000);
    expect(rows[0].deletedAt).toBeInstanceOf(Date); // original preserved, not deleted
    expect(corrected.correctedFromId).toBe(originalId);
    expect(audits.some((a) => a.action === 'expense.corrected')).toBe(true);
    expect(await service().findAllForUser('user-a', {})).toHaveLength(1); // only the live one
  });

  it('rejects a correction to a non-positive amount before any write', async () => {
    await service().create('user-a', { categoryId: CATEGORY, amountPaise: '100', paymentMethod: 'CASH' });
    const originalId = rows[0].id;
    const writesBefore = prisma.expense.update.mock.calls.length;
    await expect(
      service().correctExpense('user-a', originalId, {
        categoryId: CATEGORY,
        amountPaise: '-500',
        paymentMethod: 'CASH',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.expense.update.mock.calls.length).toBe(writesBefore); // original untouched
    expect(rows[0].deletedAt).toBeNull();
  });
});
