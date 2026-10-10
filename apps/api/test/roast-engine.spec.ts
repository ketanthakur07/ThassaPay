import { RoastEngineService } from '../src/roast-engine/roast-engine.service';
import { RoastTone, RoastIntensity } from '@thassapay/types';
import { BadRequestException } from '@nestjs/common';

describe('RoastEngineService', () => {
  let service: RoastEngineService;

  beforeEach(() => {
    service = new RoastEngineService();
  });

  it('should generate a brutal roast for Swiggy food delivery', () => {
    const result = service.generateRoast({
      amountPaise: 45000, // ₹450
      categoryName: 'FOOD_SWIGGY_ZOMATO',
      monthlySpendPaise: 800000,
      monthlyBudgetPaise: 1000000,
      tone: RoastTone.BRUTAL,
    });

    expect(result.roastText).toContain('450.00');
    expect(result.toneUsed).toBe(RoastTone.BRUTAL);
    expect(result.damageScore).toBe(80);
    expect(result.intensity).toBe(RoastIntensity.SPICY);
  });

  it('should trigger nuclear intensity when spend exceeds budget', () => {
    const result = service.generateRoast({
      amountPaise: 200000, // ₹2000
      categoryName: 'ALCOHOL_PARTY',
      monthlySpendPaise: 1200000,
      monthlyBudgetPaise: 1000000,
      tone: RoastTone.SARDONIC,
    });

    expect(result.damageScore).toBe(100);
    expect(result.intensity).toBe(RoastIntensity.NUCLEAR);
  });

  // ---- Audit additions (Phase 4, Step 9) ----

  it('rejects garbage amounts instead of emitting a ₹NaN roast', () => {
    expect(() =>
      service.generateRoast({
        amountPaise: undefined as unknown as number,
        categoryName: 'DEFAULT',
        monthlySpendPaise: 0,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.generateRoast({
        amountPaise: NaN,
        categoryName: 'DEFAULT',
        monthlySpendPaise: 0,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      service.generateRoast({
        amountPaise: '100' as unknown as number,
        categoryName: 'DEFAULT',
        monthlySpendPaise: 0,
      }),
    ).toThrow(BadRequestException);
  });

  it.each([
    [0, RoastIntensity.MILD], // damageScore default 20
    [40, RoastIntensity.MILD],
    [49.99, RoastIntensity.MILD],
    [50, RoastIntensity.MILD], // 50 is not > 50 — documented boundary
    [51, RoastIntensity.SPICY],
    [80, RoastIntensity.SPICY], // 80 is not > 80 — documented boundary
    [81, RoastIntensity.NUCLEAR],
  ])('maps %p%% budget usage to %p intensity', (pct, expected) => {
    const budget = 100_000; // ₹1000 in paise
    const result = service.generateRoast({
      amountPaise: 1000,
      categoryName: 'DEFAULT',
      monthlySpendPaise: Math.round((pct / 100) * budget),
      monthlyBudgetPaise: budget,
    });
    expect(result.intensity).toBe(expected);
  });

  it('handles every supported tone without crashing and echoes it back', () => {
    for (const tone of Object.values(RoastTone)) {
      const result = service.generateRoast({
        amountPaise: 5000,
        categoryName: 'FOOD_SWIGGY_ZOMATO',
        monthlySpendPaise: 1000,
        tone,
      });
      expect(result.toneUsed).toBe(tone);
      expect(result.roastText).not.toContain('NaN');
      expect(result.roastText).toContain('50.00');
    }
  });

  it('falls back to DEFAULT templates for unknown categories', () => {
    const result = service.generateRoast({
      amountPaise: 2500,
      categoryName: 'TOTALLY_UNKNOWN_CATEGORY',
      monthlySpendPaise: 0,
    });
    expect(result.roastText).toContain('25.00');
  });

  it('never produces NaN or undefined money text for any finite input', () => {
    for (const paise of [1, 99, 100, 99999, 123456789]) {
      const result = service.generateRoast({
        amountPaise: paise,
        categoryName: 'DEFAULT',
        monthlySpendPaise: 0,
      });
      expect(result.roastText).not.toContain('NaN');
      expect(result.roastText).not.toContain('undefined');
    }
  });
});
