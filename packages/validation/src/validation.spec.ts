import { vpaSchema, upiInitiationSchema, indianPhoneSchema } from './upi.schema';
import { TransactionCategory } from '@thassapay/types';

describe('Validation Schemas', () => {
  it('should validate valid VPA addresses', () => {
    expect(vpaSchema.safeParse('john@okaxis').success).toBe(true);
    expect(vpaSchema.safeParse('9876543210@paytm').success).toBe(true);
    expect(vpaSchema.safeParse('mess.canteen@ybl').success).toBe(true);
  });

  it('should reject invalid VPA addresses', () => {
    expect(vpaSchema.safeParse('invalid-vpa-no-at').success).toBe(false);
    expect(vpaSchema.safeParse('@nobank').success).toBe(false);
  });

  it('should validate Indian mobile numbers', () => {
    expect(indianPhoneSchema.safeParse('9876543210').success).toBe(true);
    expect(indianPhoneSchema.safeParse('+919876543210').success).toBe(true);
    expect(indianPhoneSchema.safeParse('12345').success).toBe(false);
  });

  it('should validate complete UPI initiation payload', () => {
    const valid = upiInitiationSchema.safeParse({
      vpa: 'canteen@okicici',
      payeeName: 'Hostel Canteen',
      amountPaise: 15000,
      note: 'Tea and maggi',
      category: TransactionCategory.CANTEEN_SNACKS,
    });
    expect(valid.success).toBe(true);
  });

  it('should enforce UPI single transaction limit (max 1,00,000 INR)', () => {
    const invalid = upiInitiationSchema.safeParse({
      vpa: 'vendor@ybl',
      payeeName: 'Vendor',
      amountPaise: 20000000, // 200,000 INR
      category: TransactionCategory.OTHER,
    });
    expect(invalid.success).toBe(false);
  });
});
