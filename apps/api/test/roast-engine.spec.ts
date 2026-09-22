import { RoastEngineService } from '../src/roast-engine/roast-engine.service';
import { RoastTone, RoastIntensity } from '@thassapay/types';

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
});
