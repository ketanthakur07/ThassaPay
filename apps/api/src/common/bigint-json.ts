/**
 * Audit fix (P0), extracted from main.ts so it is testable and so it is active
 * for EVERY entry point (API boot, integration tests), not just `node dist/main`.
 *
 * Prisma returns BigInt for every money column. Without a `toJSON` on
 * BigInt.prototype, `JSON.stringify` throws "Do not know how to serialize a
 * BigInt" — every endpoint that returns a raw Prisma row (payments create/
 * get/review/confirm, budgets) 500s AFTER the write has committed, so the
 * client sees a failure for a payment the server actually recorded.
 *
 * Contract at the JSON boundary: paise are emitted as JSON *numbers*, which are
 * exact for every integer up to 2^53-1 (≈ ₹90 lakh crore in paise — far beyond
 * any real transaction). Beyond that we THROW instead of silently rounding:
 * a corrupted money value must never leave the API as a plausible-looking
 * float. All arithmetic inside the service layer stays on BigInt /
 * @thassapay/money; only this boundary converts.
 */
export function installBigIntJsonSerialization(): void {
  if (Object.prototype.hasOwnProperty.call(BigInt.prototype, 'toJSON')) {
    return;
  }
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint): number {
      const n = Number(this);
      if (!Number.isSafeInteger(n)) {
        throw new Error('Money value exceeds safe integer range for serialization');
      }
      return n;
    },
    writable: false,
    configurable: false,
  });
}

// Install on import (side-effect free for callers, idempotent).
installBigIntJsonSerialization();
