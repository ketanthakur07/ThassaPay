import { PaymentStatus } from '@prisma/client';

/**
 * Explicit allowed transitions. Anything not listed here is rejected.
 * This is what stops "the client says success" from silently becoming truth.
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  INITIATED: ['AWAITING_CONFIRMATION', 'CANCELLED', 'FAILED'],
  AWAITING_CONFIRMATION: ['SUCCESS', 'FAILED', 'NEEDS_REVIEW'],
  NEEDS_REVIEW: ['SUCCESS', 'FAILED'], // only via explicit user confirmation
  SUCCESS: [], // terminal
  FAILED: [], // terminal
  CANCELLED: [], // terminal
};

export class InvalidPaymentTransitionError extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Illegal payment transition: ${from} -> ${to}`);
  }
}

export function assertValidTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidPaymentTransitionError(from, to);
  }
}

/** Only these transitions are allowed to originate from unauthenticated/client input. */
export const CLIENT_TRIGGERABLE: PaymentStatus[] = ['AWAITING_CONFIRMATION', 'CANCELLED'];
