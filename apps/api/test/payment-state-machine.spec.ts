import { assertValidTransition, InvalidPaymentTransitionError } from '../src/payments/payment-state-machine';

describe('payment state machine', () => {
  it('allows INITIATED -> AWAITING_CONFIRMATION', () => {
    expect(() => assertValidTransition('INITIATED', 'AWAITING_CONFIRMATION')).not.toThrow();
  });

  it('allows AWAITING_CONFIRMATION -> NEEDS_REVIEW (sweep timeout)', () => {
    expect(() => assertValidTransition('AWAITING_CONFIRMATION', 'NEEDS_REVIEW')).not.toThrow();
  });

  it('allows NEEDS_REVIEW -> SUCCESS (user confirms)', () => {
    expect(() => assertValidTransition('NEEDS_REVIEW', 'SUCCESS')).not.toThrow();
  });

  it('rejects INITIATED -> SUCCESS directly — this is the whole point', () => {
    expect(() => assertValidTransition('INITIATED', 'SUCCESS')).toThrow(InvalidPaymentTransitionError);
  });

  it('rejects any transition out of a terminal state', () => {
    expect(() => assertValidTransition('SUCCESS', 'FAILED')).toThrow(InvalidPaymentTransitionError);
    expect(() => assertValidTransition('FAILED', 'SUCCESS')).toThrow(InvalidPaymentTransitionError);
    expect(() => assertValidTransition('CANCELLED', 'INITIATED')).toThrow(InvalidPaymentTransitionError);
  });
});
