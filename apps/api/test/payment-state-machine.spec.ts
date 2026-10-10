import {
  assertValidTransition,
  InvalidPaymentTransitionError,
  CLIENT_TRIGGERABLE,
} from '../src/payments/payment-state-machine';
import { PaymentStatus } from '@prisma/client';

/**
 * Audit (Phase 4, Step 10): exhaustive transition matrix. Every (from, to)
 * pair is asserted against the state machine so an accidental edit to
 * ALLOWED_TRANSITIONS cannot silently reintroduce INITIATED -> SUCCESS.
 */
const ALL: PaymentStatus[] = [
  'INITIATED',
  'AWAITING_CONFIRMATION',
  'NEEDS_REVIEW',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
];

/**
 * Audit (Step 10) matrix — mirrors the spec:
 *   INITIATED -> AWAITING_CONFIRMATION / CANCELLED / FAILED   ALLOWED
 *   AWAITING_CONFIRMATION -> SUCCESS / FAILED / NEEDS_REVIEW / CANCELLED  ALLOWED
 *   NEEDS_REVIEW -> SUCCESS / FAILED                            ALLOWED
 *   INITIATED -> SUCCESS, FAILED -> SUCCESS, CANCELLED -> SUCCESS  MUST FAIL
 * CANCELLED from AWAITING_CONFIRMATION exists so a retried/differing return
 * report cannot strand the attempt; CANCELLED is terminal, so it can never
 * manufacture SUCCESS.
 */
const LEGAL: Record<PaymentStatus, PaymentStatus[]> = {
  INITIATED: ['AWAITING_CONFIRMATION', 'CANCELLED', 'FAILED'],
  AWAITING_CONFIRMATION: ['SUCCESS', 'FAILED', 'NEEDS_REVIEW', 'CANCELLED'],
  NEEDS_REVIEW: ['SUCCESS', 'FAILED'],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
};

describe('payment state machine — full transition matrix', () => {
  it.each(ALL.flatMap((from) => ALL.map((to) => ({ from, to }))))(
    '$from -> $to',
    ({ from, to }) => {
      const legal = LEGAL[from].includes(to);
      if (legal) {
        expect(() => assertValidTransition(from, to)).not.toThrow();
      } else {
        expect(() => assertValidTransition(from, to)).toThrow(InvalidPaymentTransitionError);
      }
    },
  );

  it('never allows INITIATED -> SUCCESS directly — the core financial invariant', () => {
    expect(() => assertValidTransition('INITIATED', 'SUCCESS')).toThrow(InvalidPaymentTransitionError);
  });

  it('never allows terminal states to transition anywhere', () => {
    for (const terminal of ['SUCCESS', 'FAILED', 'CANCELLED'] as PaymentStatus[]) {
      for (const to of ALL) {
        expect(() => assertValidTransition(terminal, to)).toThrow(InvalidPaymentTransitionError);
      }
    }
  });

  it('restricts what unauthenticated client input can trigger', () => {
    // A client may move an attempt to AWAITING_CONFIRMATION (claim of return)
    // or CANCELLED, but SUCCESS/FAILED/NEEDS_REVIEW need verification flow.
    expect(CLIENT_TRIGGERABLE).toEqual(['AWAITING_CONFIRMATION', 'CANCELLED']);
    expect(CLIENT_TRIGGERABLE).not.toContain('SUCCESS');
    expect(CLIENT_TRIGGERABLE).not.toContain('NEEDS_REVIEW');
  });

  it('keeps every terminal state terminal — no edge out of SUCCESS/FAILED/CANCELLED', () => {
    for (const terminal of ['SUCCESS', 'FAILED', 'CANCELLED'] as PaymentStatus[]) {
      expect(LEGAL[terminal]).toEqual([]);
    }
  });
});
