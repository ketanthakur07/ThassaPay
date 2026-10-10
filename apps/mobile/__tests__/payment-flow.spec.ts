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
        status: PaymentStatus.INITIATED,
        amountPaise: 15000,
        upiId: 'canteen@okaxis',
      }),
    });

    const res = await apiClient.payments.create({
      upiId: 'canteen@okaxis',
      amount: '150.00',
      idempotencyKey: 'idem_key_unique_test',
      categoryId: 'cat_food',
      description: 'Mess lunch',
    });

    // The app builds the UPI URI itself — the backend never returns one.
    expect(res.id).toBe('pay_att_123');
    expect(res.status).toBe(PaymentStatus.INITIATED);
    expect(res.upiId).toBe('canteen@okaxis');

    // Contract: the request body must carry what the API DTO validates.
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      upiId: 'canteen@okaxis',
      amount: '150.00',
      idempotencyKey: 'idem_key_unique_test',
      categoryId: 'cat_food',
      description: 'Mess lunch',
    });
    // idempotencyKey must satisfy the API's opaque-key rule (8-128 URL-safe chars)
    expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('should report the return using the outcome enum the API validates', async () => {
    (global as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'pay_att_123', status: 'AWAITING_CONFIRMATION' }),
    });

    const returnRes = await apiClient.payments.reportReturn('pay_att_123', 'app_returned_ok');
    expect(returnRes.status).toBe('AWAITING_CONFIRMATION');

    const sent = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    expect(sent).toEqual({ outcome: 'app_returned_ok', referenceId: undefined });
    // The legacy { status: 'USER_RETURNED' } contract must never come back.
    expect(Object.keys(sent)).not.toContain('status');
  });

  it('should move an attempt into NEEDS_REVIEW without waiting for the sweep', async () => {
    (global as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'pay_att_123', status: 'NEEDS_REVIEW' }),
    });

    const res = await apiClient.payments.review('pay_att_123');
    expect(res.status).toBe(PaymentStatus.NEEDS_REVIEW);
    expect((global as any).fetch.mock.calls[0][0]).toContain('/v1/payments/pay_att_123/review');
  });

  it('should confirm payment and expose the created expense id from the authoritative lookup', async () => {
    // 1. User answers "yes, it went through" on the review screen.
    (global as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'pay_att_123', status: 'SUCCESS' }),
    });

    const confirmRes = await apiClient.payments.confirm('pay_att_123', {
      didSucceed: true,
      categoryId: 'cat_food',
      description: 'UPI Payment',
    });
    expect(confirmRes.status).toBe('SUCCESS');

    // 2. The API does NOT inline the expense in the confirm response; the
    //    authoritative status endpoint returns it (recovery path after restart).
    (global as any).fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'pay_att_123',
        status: 'SUCCESS',
        amountPaise: 15000,
        upiId: 'canteen@okaxis',
        expenseId: 'exp_1',
      }),
    });

    const lookup = await apiClient.payments.get('pay_att_123');
    expect(lookup.status).toBe(PaymentStatus.SUCCESS);
    expect(lookup.expenseId).toBe('exp_1');
  });

  it('never infers SUCCESS client-side when the backend is unreachable', async () => {
    // Both the return report and the status lookup fail (offline).
    (global as any).fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'));

    await expect(
      apiClient.payments.reportReturn('pay_att_123', 'app_returned_ok'),
    ).rejects.toThrow('network down');
    await expect(apiClient.payments.get('pay_att_123')).rejects.toThrow('network down');
    // No local status was invented — PaymentResultScreen stays in NEEDS_REVIEW.
  });
});
