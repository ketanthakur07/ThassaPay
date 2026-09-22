/**
 * Money value object for ThassaPay.
 * STRICT FINANCIAL RULE: All financial calculations are represented internally as integer paise (BigInt).
 * Floating-point representation is NEVER used for storage or calculation.
 */
export class Money {
  private readonly paiseAmount: bigint;

  private constructor(paise: bigint) {
    this.paiseAmount = paise;
  }

  /**
   * Create a Money object directly from integer paise.
   */
  public static fromPaise(paise: bigint | number): Money {
    const BigPaise = typeof paise === 'number' ? BigInt(Math.round(paise)) : paise;
    return new Money(BigPaise);
  }

  /**
   * Create a Money object from Rupees (string or number).
   * Parses decimals safely without floating-point drift.
   */
  public static fromRupees(rupees: number | string): Money {
    if (typeof rupees === 'number') {
      if (!Number.isFinite(rupees)) {
        throw new Error('Invalid rupee amount: must be a finite number');
      }
      return Money.fromDecimalString(rupees.toFixed(2));
    }
    return Money.fromDecimalString(rupees);
  }

  /**
   * Create a Money object from a decimal string (e.g., "150", "150.5", "150.50").
   */
  public static fromDecimalString(amountStr: string): Money {
    const trimmed = amountStr.trim();
    if (!trimmed || isNaN(Number(trimmed))) {
      throw new Error(`Invalid monetary string: "${amountStr}"`);
    }

    const isNegative = trimmed.startsWith('-');
    const cleanStr = isNegative ? trimmed.slice(1) : trimmed;
    const parts = cleanStr.split('.');

    if (parts.length > 2) {
      throw new Error(`Invalid decimal format: "${amountStr}"`);
    }

    const wholePart = BigInt(parts[0] || '0');
    let decimalPart = parts[1] || '0';

    if (decimalPart.length === 1) {
      decimalPart += '0';
    } else if (decimalPart.length > 2) {
      // Round to 2 decimal places
      const thirdDigit = parseInt(decimalPart[2], 10);
      decimalPart = decimalPart.slice(0, 2);
      if (thirdDigit >= 5) {
        let decimalNum = parseInt(decimalPart, 10) + 1;
        if (decimalNum >= 100) {
          // Carry over
          return new Money(
            (isNegative ? -1n : 1n) * ((wholePart + 1n) * 100n)
          );
        }
        decimalPart = decimalNum.toString().padStart(2, '0');
      }
    }

    const totalPaise = wholePart * 100n + BigInt(decimalPart);
    return new Money(isNegative ? -totalPaise : totalPaise);
  }

  /**
   * Zero Money instance
   */
  public static zero(): Money {
    return new Money(0n);
  }

  /**
   * Get internal amount in paise as BigInt.
   */
  public toPaise(): bigint {
    return this.paiseAmount;
  }

  /**
   * Get amount in paise as number (safe for smaller amounts).
   */
  public toPaiseNumber(): number {
    return Number(this.paiseAmount);
  }

  /**
   * Get amount in Rupees as floating point number.
   * NOTE: Use only for display, not financial calculations!
   */
  public toRupees(): number {
    return Number(this.paiseAmount) / 100;
  }

  /**
   * Format as string (e.g., "150.50" or "₹150.50").
   */
  public toFormattedString(options: { includeSymbol?: boolean } = {}): string {
    const isNeg = this.paiseAmount < 0n;
    const absPaise = isNeg ? -this.paiseAmount : this.paiseAmount;
    const rupees = absPaise / 100n;
    const paise = absPaise % 100n;

    const formattedPaise = paise.toString().padStart(2, '0');
    const formattedRupees = rupees.toLocaleString('en-IN');
    const formattedAmount = `${formattedRupees}.${formattedPaise}`;

    const prefix = options.includeSymbol ? '₹' : '';
    return isNeg ? `-${prefix}${formattedAmount}` : `${prefix}${formattedAmount}`;
  }

  /**
   * Add another Money instance.
   */
  public add(other: Money): Money {
    return new Money(this.paiseAmount + other.paiseAmount);
  }

  /**
   * Subtract another Money instance.
   */
  public subtract(other: Money): Money {
    return new Money(this.paiseAmount - other.paiseAmount);
  }

  /**
   * Multiply by a scalar factor (e.g. split percentage or multiplier).
   */
  public multiply(factor: number): Money {
    const roundedPaise = BigInt(Math.round(Number(this.paiseAmount) * factor));
    return new Money(roundedPaise);
  }

  /**
   * Split money into equal parts without losing paise.
   */
  public split(parts: number): Money[] {
    if (parts <= 0 || !Number.isInteger(parts)) {
      throw new Error('Split parts must be a positive integer');
    }

    const basePaise = this.paiseAmount / BigInt(parts);
    let remainder = this.paiseAmount % BigInt(parts);

    const result: Money[] = [];
    for (let i = 0; i < parts; i++) {
      let partPaise = basePaise;
      if (remainder > 0n) {
        partPaise += 1n;
        remainder -= 1n;
      } else if (remainder < 0n) {
        partPaise -= 1n;
        remainder += 1n;
      }
      result.push(new Money(partPaise));
    }
    return result;
  }

  public equals(other: Money): boolean {
    return this.paiseAmount === other.paiseAmount;
  }

  public isGreaterThan(other: Money): boolean {
    return this.paiseAmount > other.paiseAmount;
  }

  public isLessThan(other: Money): boolean {
    return this.paiseAmount < other.paiseAmount;
  }

  public isZero(): boolean {
    return this.paiseAmount === 0n;
  }

  public isNegative(): boolean {
    return this.paiseAmount < 0n;
  }

  public isPositive(): boolean {
    return this.paiseAmount > 0n;
  }
}
