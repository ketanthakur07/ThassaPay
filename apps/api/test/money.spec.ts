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
    expect(() => Money.fromRupees('-5')).toThrow(); // negative is never a valid payment amount
    expect(() => Money.fromRupees('')).toThrow();
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

/**
 * Audit (Phase 4, Step 4): money boundary matrix from the pre-launch spec.
 * The stored representation is BigInt paise; these are the classic
 * floating-point traps that must never drift into stored values.
 */
describe('Money — financial boundary matrix', () => {
  it.each([
    ['0.01', 1n],
    ['0.10', 10n],
    ['0.99', 99n],
    ['1.01', 101n],
    ['999.99', 99999n],
    ['250.50', 25050n],
    ['0', 0n],
  ])('parses ₹%s exactly as %s paise', (rupees, expectedPaise) => {
    expect(Money.fromRupees(rupees).toPaise()).toBe(expectedPaise);
  });

  it('handles large values without float drift (beyond Number safe rupees)', () => {
    const big = Money.fromRupees('99999999999.99');
    expect(big.toPaise()).toBe(9999999999999n);
  });

  it('addition and subtraction stay exact at paise granularity', () => {
    const a = Money.fromRupees('0.01');
    const b = Money.fromRupees('0.02');
    const c = Money.fromRupees('0.03');
    expect(a.add(b).toPaise()).toBe(c.toPaise());
    expect(c.subtract(b).toPaise()).toBe(a.toPaise());
  });

  it('comparison operators are paise-exact', () => {
    expect(Money.fromRupees('0.10').toPaise() > Money.fromRupees('0.09').toPaise()).toBe(true);
    expect(Money.fromRupees('1.00').toPaise() < Money.fromRupees('1.01').toPaise()).toBe(true);
  });

  it('serializes paise as exact numbers up to the safe-integer boundary', () => {
    // The BigInt.prototype.toJSON guard is installed by main.ts at API boot,
    // not in library tests — simulate the contract via a wrapper object.
    const asJsonable = (v: bigint) => ({
      toJSON() {
        const n = Number(v);
        if (!Number.isSafeInteger(n)) {
          throw new Error('Money value exceeds safe integer range for serialization');
        }
        return n;
      },
    });
    const safeMax = BigInt(Number.MAX_SAFE_INTEGER);
    expect(JSON.parse(JSON.stringify(asJsonable(safeMax)))).toBe(Number.MAX_SAFE_INTEGER);
    // The guard must refuse unsafe values rather than silently round.
    const unsafe = safeMax + 1n;
    expect(() => JSON.stringify(asJsonable(unsafe))).toThrow();
  });
});
