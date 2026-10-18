import {
  paymentIntentKey,
  completePaymentIntent,
} from '../src/services/paymentIdempotency';

/**
 * Regression coverage for the payment-idempotency contract.
 *
 * Bug fixed in this branch: PayScreen minted a NEW key on every button press,
 * so a user-driven retry after an ambiguous failure (timeout / server error)
 * reached POST /v1/payments with a fresh key — defeating server-side dedupe
 * and allowing a duplicate PaymentAttempt for the same payment.
 */

const INTENT = {
  upiId: 'canteen@okaxis',
  amount: '150.00',
  categoryId: 'cat-1',
  description: 'lunch',
};

beforeEach(() => {
  completePaymentIntent(); // each test starts with no active intent
});

describe('payment idempotency keys', () => {
  it('reuses the SAME key while the payment intent is unchanged (retries dedupe)', () => {
    const first = paymentIntentKey(INTENT);
    // Simulates pressing "Pay" again after a timeout/failed response.
    const retry = paymentIntentKey({ ...INTENT });
    const retry2 = paymentIntentKey({ ...INTENT });

    expect(retry).toBe(first);
    expect(retry2).toBe(first);
    expect(first).toMatch(/^pay_\d+_[a-z0-9]+$/);
  });

  it('mints a NEW key when the amount changes (never reuse across payments)', () => {
    const first = paymentIntentKey(INTENT);
    const changed = paymentIntentKey({ ...INTENT, amount: '200.00' });
    expect(changed).not.toBe(first);
  });

  it('mints a NEW key when the payee, category or note changes', () => {
    const first = paymentIntentKey(INTENT);
    expect(paymentIntentKey({ ...INTENT, upiId: 'other@okaxis' })).not.toBe(first);
    expect(paymentIntentKey({ ...INTENT, categoryId: 'cat-2' })).not.toBe(first);
    expect(paymentIntentKey({ ...INTENT, description: 'dinner' })).not.toBe(first);
    expect(paymentIntentKey({ ...INTENT, description: undefined })).not.toBe(first);
  });

  it('mints a NEW key after the payment is completed', () => {
    const first = paymentIntentKey(INTENT);
    completePaymentIntent(); // backend accepted the attempt
    const next = paymentIntentKey({ ...INTENT });
    expect(next).not.toBe(first);
  });

  it('keeps reusing across failures but resets when the intent changes back', () => {
    const a = paymentIntentKey(INTENT);
    const b = paymentIntentKey({ ...INTENT, amount: '200.00' }); // user edited amount
    expect(b).not.toBe(a);
    const aAgain = paymentIntentKey(INTENT); // user reverted the edit
    expect(aAgain).not.toBe(a); // never resurrect an older key
  });

  it('generated keys are distinct across regenerations', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(paymentIntentKey({ ...INTENT, amount: `${i}.00` }));
    }
    expect(keys.size).toBe(50);
  });
});
