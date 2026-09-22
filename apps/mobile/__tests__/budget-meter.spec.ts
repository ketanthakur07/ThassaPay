import { getBudgetStatusColor, colors } from '../src/theme/colors';
import { Money } from '@thassapay/money';

describe('Budget Damage Meter & Threshold States', () => {
  it('should return budgetNormal green when spending is under 50%', () => {
    const color = getBudgetStatusColor(35);
    expect(color).toBe(colors.budgetNormal);
  });

  it('should return budgetCaution amber when spending is between 50% and 74%', () => {
    const color = getBudgetStatusColor(60);
    expect(color).toBe(colors.budgetCaution);
  });

  it('should return budgetWarning orange when spending is between 75% and 89%', () => {
    const color = getBudgetStatusColor(80);
    expect(color).toBe(colors.budgetWarning);
  });

  it('should return budgetCritical red when spending is between 90% and 99%', () => {
    const color = getBudgetStatusColor(95);
    expect(color).toBe(colors.budgetCritical);
  });

  it('should return budgetExceeded dark crimson when spending is 100% or greater', () => {
    const color = getBudgetStatusColor(115);
    expect(color).toBe(colors.budgetExceeded);
  });

  it('should format exact remaining rupee balance without losing paise', () => {
    const budget = Money.fromRupees('10000.00'); // 1,000,000 paise
    const spent = Money.fromRupees('7240.50'); // 724,050 paise
    const remaining = budget.subtract(spent);

    expect(remaining.toPaise()).toBe(275950n);
    expect(remaining.toFormattedString({ includeSymbol: true })).toBe('₹2,759.50');
  });
});
