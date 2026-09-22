import { apiClient } from '../src/services/api/apiClient';
import { vpaSchema } from '@thassapay/validation';
import { PaymentStatus } from '@thassapay/types';

describe('Payment Initiation & Verification Flow', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  it('should validate standard UPI VPAs before initiating payment', () => {
    expect(vpaSchema.safeParse('mess.canteen@okaxis').success).toBe(true);
    expect(vpaSchema.safeParse('9876543210@paytm').success).toBe(true);
    expect(vpaSchema.safeParse('invalid-vpa').success).toBe(false);
  });

  it('should create payment attempt with client-generated idempotency key', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'pay_att_123',
        upiUri: 'upi://pay?pa=canteen@okaxis&am=150.00&cu=INR',
        status: PaymentStatus.INITIATED,
        amountPaise: 15000,
        upiId: 'canteen@okaxis',
      }),
    });

    const res = await apiClient.payments.create({
      upiId: 'canteen@okaxis',
      amountPaise: 15000,
      idempotencyKey: 'idem_key_unique_test',
    });

    expect(res.id).toBe('pay_att_123');
    expect(res.status).toBe(PaymentStatus.INITIATED);
    expect(res.upiUri).toContain('canteen@okaxis');
  });

  it('should support NEEDS_REVIEW return state and user confirmation via backend', async () => {
    // 1. Report return from UPI app
    (global as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pay_att_123',
        status: 'AWAITING_CONFIRMATION',
      }),
    });

    const returnRes = await apiClient.payments.reportReturn('pay_att_123', {
      status: 'USER_RETURNED',
    });
    expect(returnRes.status).toBe('AWAITING_CONFIRMATION');

    // 2. User confirms payment in NEEDS_REVIEW screen
    (global as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pay_att_123',
        status: 'SUCCESS',
        expense: { id: 'exp_1', amountPaise: 15000 },
      }),
    });

    const confirmRes = await apiClient.payments.confirm('pay_att_123', {
      didSucceed: true,
      categoryId: 'cat_food',
      description: 'UPI Payment',
    });

    expect(confirmRes.status).toBe('SUCCESS');
    expect(confirmRes.expense.amountPaise).toBe(15000);
  });
});
