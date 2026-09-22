/**
 * The ONLY place currency parsing/formatting happens. Everywhere else in the
 * codebase, money is a BigInt of paise and nothing touches it with +, -, *, /
 * directly without going through here. This is what prevents float-rounding
 * bugs from ever reaching a user's balance.
 */
export class Money {
  private constructor(private readonly paise: bigint) {}

  static fromPaise(paise: bigint | number): Money {
    return new Money(BigInt(paise));
  }

  /** Parses a user-facing rupee string/number ("250", "250.50") into Money. */
  static fromRupees(rupees: string | number): Money {
    const str = typeof rupees === 'number' ? rupees.toString() : rupees;
    if (!/^\d+(\.\d{1,2})?$/.test(str)) {
      throw new Error(`Invalid rupee amount: "${str}"`);
    }
    const [whole, fraction = ''] = str.split('.');
    const paddedFraction = fraction.padEnd(2, '0');
    const paise = BigInt(whole) * 100n + BigInt(paddedFraction || '0');
    return new Money(paise);
  }

  add(other: Money): Money {
    return new Money(this.paise + other.paise);
  }

  subtract(other: Money): Money {
    return new Money(this.paise - other.paise);
  }

  isNegative(): boolean {
    return this.paise < 0n;
  }

  toPaise(): bigint {
    return this.paise;
  }

  /** Formatted for display only, e.g. "₹250.50" */
  toDisplayString(): string {
    const negative = this.paise < 0n;
    const abs = negative ? -this.paise : this.paise;
    const rupees = abs / 100n;
    const paise = abs % 100n;
    const sign = negative ? '-' : '';
    return `${sign}₹${rupees}.${paise.toString().padStart(2, '0')}`;
  }
}
