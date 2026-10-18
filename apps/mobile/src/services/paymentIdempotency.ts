/**
 * Client-side idempotency keys for payment initiation.
 *
 * The backend (payments.service.createPaymentAttempt) dedupes on
 * `idempotencyKey`: the same key returns the EXISTING attempt instead of
 * creating a duplicate. That protection only works if the key is stable
 * across retries of the *same* payment intent.
 *
 * Rules encoded here (the failure mode they prevent is a duplicate
 * PaymentAttempt — i.e. a possible double payment — after an ambiguous
 * network error such as a timeout):
 *
 *  1. UNCHANGED intent (same payee, amount, category, note) -> the SAME key,
 *     so pressing "Pay" again after a timeout/error dedupes server-side.
 *  2. CHANGED intent -> a new key, so a different payment can never be
 *     swallowed by the server's "return the existing attempt" branch
 *     (which would silently reuse the previous amount/payee).
 *  3. COMPLETED intent (`completePaymentIntent`) -> a new key, so a genuinely
 *     repeated payment is a genuinely new attempt.
 *
 * Kept as a plain module (not component state) so it survives re-renders and
 * is directly unit-testable in the node-based Jest setup.
 */

export interface PaymentIntent {
  upiId: string;
  amount: string;
  categoryId: string;
  description?: string;
}

interface ActiveIntent {
  key: string;
  signature: string;
}

let active: ActiveIntent | null = null;

/** Everything the server dedupes on: if any of these change, it is a new payment. */
function signatureOf(intent: PaymentIntent): string {
  return JSON.stringify([
    intent.upiId,
    intent.amount,
    intent.categoryId,
    intent.description ?? '',
  ]);
}

function generateKey(): string {
  // Format matches what PayScreen used before: sortable timestamp + random
  // suffix. (Predictability is harmless here: the key only dedupes the SAME
  // user's own retries and is rejected across users by the backend.)
  return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * The idempotency key for this payment attempt.
 * Reused while the intent is unchanged (retry after a failed/ambiguous
 * attempt), regenerated when the payment details change.
 */
export function paymentIntentKey(intent: PaymentIntent): string {
  const signature = signatureOf(intent);
  if (!active || active.signature !== signature) {
    active = { key: generateKey(), signature };
  }
  return active.key;
}

/** The backend accepted the attempt (or the flow was abandoned): next payment is a new one. */
export function completePaymentIntent(): void {
  active = null;
}
