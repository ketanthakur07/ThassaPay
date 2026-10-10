import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { RoastEngineService } from '../src/roast-engine/roast-engine.service';
import { RoastEngineModule } from '../src/roast-engine/roast-engine.module';
import { SharedJwtModule } from '../src/common/shared-jwt.module';
import { RoastTone } from '@thassapay/types';

/**
 * Audit (Step 14): the Roast Engine is entertainment. It must never be a
 * financial authority, so it must have no way to read or write money state.
 *
 * Proven structurally (not just behaviourally):
 *   - the service takes NO constructor dependencies (arity 0) => no Prisma,
 *     no Redis, no access to Expense/PaymentAttempt/Budget
 *   - the module provides only the roast service and imports only the JWT
 *     module (no PrismaService anywhere in its graph)
 *   - a roast failure throws before returning anything and writes nothing
 */
describe('Roast Engine isolation (Step 14)', () => {
  it('has no constructor dependencies — it cannot reach the database', () => {
    expect(RoastEngineService.length).toBe(0);
    const ctor = RoastEngineService as unknown as { prototype: object };
    expect(ctor.prototype).toBeDefined();
  });

  it('module graph contains no Prisma (or other financial) provider', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', RoastEngineModule) ?? [];
    const imports: unknown[] = Reflect.getMetadata('imports', RoastEngineModule) ?? [];

    expect(providers).toEqual([RoastEngineService]);
    expect(imports).toEqual([SharedJwtModule]);
    expect(JSON.stringify(providers)).not.toMatch(/Prisma|Payment|Expense|Budget/i);
    expect(JSON.stringify(imports)).not.toMatch(/Prisma|Payment|Expense|Budget/i);
  });

  it('a garbage input throws instead of returning a nonsense money claim', () => {
    const service = new RoastEngineService();
    const badInputs: Array<Record<string, unknown>> = [
      { amountPaise: NaN },
      { amountPaise: Infinity },
      { amountPaise: '1500' },
      { amountPaise: 1500, monthlySpendPaise: undefined },
      { amountPaise: 1500, monthlySpendPaise: 1500, monthlyBudgetPaise: 'oops' },
    ];
    for (const extra of badInputs) {
      const input = {
        ...extra,
        categoryName: 'FOOD_SWIGGY_ZOMATO',
        tone: RoastTone.BRUTAL,
      } as unknown as Parameters<RoastEngineService['generateRoast']>[0];
      expect(() => service.generateRoast(input)).toThrow(BadRequestException);
    }
  });

  it('never emits NaN / undefined in its text for any finite amount', () => {
    const service = new RoastEngineService();
    for (const amountPaise of [1, 99, 100, 99999, 123456789]) {
      const res = service.generateRoast({
        amountPaise,
        categoryName: 'DEFAULT',
        monthlySpendPaise: amountPaise,
        tone: RoastTone.GENTLE,
      });
      expect(res.roastText).not.toMatch(/NaN|undefined|null/);
      expect(Number.isFinite(res.damageScore)).toBe(true);
    }
  });

  it('is pure: calling it repeatedly returns the same result and throws nothing', () => {
    const service = new RoastEngineService();
    const input = {
      amountPaise: 25000,
      categoryName: 'CANTEEN_SNACKS',
      monthlySpendPaise: 60000,
      monthlyBudgetPaise: 100000,
      tone: RoastTone.BRUTAL,
    };
    const a = service.generateRoast(input);
    const b = service.generateRoast(input);
    expect(b).toEqual(a);
    expect(a.damageScore).toBe(60); // 60000/100000 — purely derived from inputs
  });
});
