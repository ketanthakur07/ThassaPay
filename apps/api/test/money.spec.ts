import { Money } from '../src/common/money/money';

describe('Money', () => {
  it('parses whole rupees correctly', () => {
    expect(Money.fromRupees('250').toPaise()).toBe(250_00n);
  });

  it('parses paise correctly', () => {
    expect(Money.fromRupees('250.50').toPaise()).toBe(250_50n);
  });

  it('rejects malformed amounts', () => {
    expect(() => Money.fromRupees('250.5.5')).toThrow();
    expect(() => Money.fromRupees('abc')).toThrow();
  });

  it('never loses precision the way float math would', () => {
    // The classic 0.1 + 0.2 float trap, done in paise instead
    const a = Money.fromRupees('0.10');
    const b = Money.fromRupees('0.20');
    expect(a.add(b).toPaise()).toBe(30n);
  });

  it('formats for display', () => {
    expect(Money.fromPaise(250_50n).toDisplayString()).toBe('₹250.50');
  });
});
