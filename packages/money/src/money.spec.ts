import { Money } from './money';

describe('Money Value Object', () => {
  it('should create Money from paise', () => {
    const money = Money.fromPaise(15050n);
    expect(money.toPaise()).toBe(15050n);
    expect(money.toRupees()).toBe(150.5);
  });

  it('should create Money from string rupees safely without floating point drift', () => {
    const m1 = Money.fromDecimalString('10.01');
    const m2 = Money.fromDecimalString('20.02');
    const sum = m1.add(m2);
    expect(sum.toPaise()).toBe(3003n);
    expect(sum.toFormattedString()).toBe('30.03');
  });

  it('should format money correctly with Indian currency symbol', () => {
    const money = Money.fromDecimalString('12345.67');
    expect(money.toFormattedString({ includeSymbol: true })).toBe('₹12,345.67');
  });

  it('should correctly handle negative numbers', () => {
    const money = Money.fromDecimalString('-50.25');
    expect(money.toPaise()).toBe(-5025n);
    expect(money.toFormattedString({ includeSymbol: true })).toBe('-₹50.25');
    expect(money.isNegative()).toBe(true);
  });

  it('should split money equally without losing remainder paise', () => {
    const total = Money.fromDecimalString('100.00'); // 10000 paise split 3 ways: 3334, 3333, 3333
    const parts = total.split(3);
    expect(parts.length).toBe(3);
    expect(parts[0].toPaise()).toBe(3334n);
    expect(parts[1].toPaise()).toBe(3333n);
    expect(parts[2].toPaise()).toBe(3333n);

    const reconstructed = parts.reduce((acc, p) => acc.add(p), Money.zero());
    expect(reconstructed.equals(total)).toBe(true);
  });
});
