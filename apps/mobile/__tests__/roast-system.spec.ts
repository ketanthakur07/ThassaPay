import { apiClient } from '../src/services/api/apiClient';
import { RoastTone, RoastIntensity } from '@thassapay/types';

describe('Mobile Roast System Integration', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('should request and receive roast payload from backend Roast Engine', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        roastText: 'Another ₹450 gone on midnight delivery.',
        toneUsed: RoastTone.BRUTAL,
        intensity: RoastIntensity.SPICY,
        damageScore: 75,
      }),
    });

    const res = await apiClient.roasts.generate({
      amountPaise: 45000,
      categoryName: 'FOOD_SWIGGY_ZOMATO',
      monthlySpendPaise: 750000,
      monthlyBudgetPaise: 1000000,
      tone: RoastTone.BRUTAL,
    });

    expect(res.roastText).toBe('Another ₹450 gone on midnight delivery.');
    expect(res.toneUsed).toBe(RoastTone.BRUTAL);
    expect(res.intensity).toBe(RoastIntensity.SPICY);
    expect(res.damageScore).toBe(75);
  });
});
