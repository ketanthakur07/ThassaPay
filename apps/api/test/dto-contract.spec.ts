import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  CreatePaymentDto,
  ReportPaymentReturnDto,
} from '../src/payments/dto/create-payment.dto';
import {
  CreateExpenseRequestDto,
  SetBudgetRequestDto,
} from '../src/expenses/expenses.dto';

/**
 * Audit (Step 19/22): contract tests between the mobile payloads (as written in
 * apps/mobile/src/**) and the API DTOs (as validated by the global ValidationPipe).
 * A DTO that rejects a payload the app really sends is a P0 integration break —
 * the unit tests on each side stay green while the product silently fails.
 */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true, transform: true };

async function errors(obj: object): Promise<string> {
  const errs = await validate(obj as any, PIPE_OPTIONS);
  return errs.map((e) => Object.values(e.constraints || {}).join('|')).join('; ');
}

const CATEGORY_ID = '6d568754-bd00-478a-8f0b-b0056b9cb8c7';

describe('API DTO contract vs mobile payloads', () => {
  it('accepts the idempotencyKey PayScreen actually generates (pay_<ts>_<rand>)', async () => {
    const dto = Object.assign(new CreatePaymentDto(), {
      idempotencyKey: `pay_${Date.now()}_abc1234`,
      amount: '250.50',
      upiId: 'someone@okhdfc',
      categoryId: CATEGORY_ID,
    });
    expect(await errors(dto)).toBe('');
  });

  it('accepts amountPaise as a NUMBER (AddExpenseScreen / ProfileScreen send numbers)', async () => {
    const expense = Object.assign(new CreateExpenseRequestDto(), {
      categoryId: CATEGORY_ID,
      amountPaise: 123450,
      paymentMethod: 'UPI',
      expenseDate: '2026-10-07',
    });
    expect(await errors(expense)).toBe('');

    const budget = Object.assign(new SetBudgetRequestDto(), {
      month: '2026-10',
      amountPaise: 50000,
    });
    expect(await errors(budget)).toBe('');
  });

  it('also accepts the exact integer-paise STRING form', async () => {
    const expense = Object.assign(new CreateExpenseRequestDto(), {
      categoryId: CATEGORY_ID,
      amountPaise: '123450',
      paymentMethod: 'UPI',
    });
    expect(await errors(expense)).toBe('');
  });

  it('rejects negative and non-integer money at the edge (two layers deep)', async () => {
    const accepted: string[] = [];
    for (const bad of ['12.5', 'abc', 12.5, '', null, undefined, '1e5', ' 100', '100 ', '-100', -100]) {
      const expense = Object.assign(new CreateExpenseRequestDto(), {
        categoryId: CATEGORY_ID,
        amountPaise: bad,
        paymentMethod: 'UPI',
      });
      if ((await errors(expense)) === '') accepted.push(String(bad));
    }
    expect(accepted).toEqual([]);
  });

  it('rejects a negative integer in BOTH wire forms (DTO is the first guard)', async () => {
    // @Matches used to allow a leading '-', so '-100' reached the service. The
    // service still rejects <= 0 (defence in depth), but the edge now rejects
    // first so a bad value never becomes a DB round-trip.
    for (const bad of ['-100', -100]) {
      const expense = Object.assign(new CreateExpenseRequestDto(), {
        categoryId: CATEGORY_ID,
        amountPaise: bad,
        paymentMethod: 'UPI',
      });
      expect(await errors(expense)).not.toBe('');
    }
    const budget = Object.assign(new SetBudgetRequestDto(), { month: '2026-10', amountPaise: -1 });
    expect(await errors(budget)).not.toBe('');
  });

  it('accepts the return outcome PaymentResultScreen sends', async () => {
    for (const outcome of ['app_returned_ok', 'user_cancelled', 'app_returned_error']) {
      const dto = Object.assign(new ReportPaymentReturnDto(), { outcome });
      expect(await errors(dto)).toBe('');
    }
  });

  it('rejects a body without `outcome` (the legacy { status: "USER_RETURNED" } contract)', async () => {
    const dto = Object.assign(new ReportPaymentReturnDto(), {
      status: 'USER_RETURNED',
    });
    expect(await errors(dto)).not.toBe('');
  });

  it('rejects smuggled extra fields (ValidationPipe forbidNonWhitelisted)', async () => {
    const dto = Object.assign(new CreatePaymentDto(), {
      idempotencyKey: CATEGORY_ID,
      amount: '10',
      upiId: 'someone@okhdfc',
      categoryId: CATEGORY_ID,
      status: 'SUCCESS',
    });
    expect(await errors(dto)).not.toBe('');
  });
});
