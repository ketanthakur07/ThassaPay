import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Audit fix (P0): the mobile client sends money as a JSON *number*
 * (`AddExpenseScreen` uses `Number(money.toPaise())`, `ProfileScreen` and
 * `AuthContext` use `budgetRupees * 100`), while the audit's new
 * `@Matches(/^-?\d+$/)` only accepts strings — so every manual expense and
 * every budget save from the app was rejected with 400 even though the unit
 * tests on both sides stayed green.
 *
 * Contract: money on the wire is a NON-NEGATIVE INTEGER number of paise.
 *   - number: must be a safe integer (no float drift, no 2^53 overflow)
 *   - string: digits only (exact, for clients that avoid JSON numbers)
 * Anything else is rejected at the edge. The service layer re-checks
 * `> 0` before writing, so zero/negative amounts cannot reach the DB.
 */
export function IsPaiseAmount(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPaiseAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'number') {
            return Number.isSafeInteger(value) && value >= 0;
          }
          if (typeof value === 'string') {
            return /^\d{1,15}$/.test(value);
          }
          return false;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a non-negative integer amount of paise (number or string)`;
        },
      },
    });
  };
}
