import { z } from 'zod';
import { TransactionCategory, UPIIntentApp } from '@thassapay/types';

/**
 * Standard UPI Virtual Payment Address (VPA) Regex.
 * Matches formats like: username@bank, 9876543210@ybl, hostel.canteen@okicici
 */
export const UPI_VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

/**
 * Indian 10-digit mobile number regex (with optional +91 prefix)
 */
export const INDIAN_PHONE_REGEX = /^(?:\+91|91)?[6-9]\d{9}$/;

export const vpaSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(UPI_VPA_REGEX, { message: 'Invalid UPI VPA address format (e.g. name@upi)' });

export const indianPhoneSchema = z
  .string()
  .trim()
  .regex(INDIAN_PHONE_REGEX, { message: 'Invalid Indian mobile phone number' });

export const upiInitiationSchema = z.object({
  vpa: vpaSchema,
  payeeName: z
    .string()
    .trim()
    .min(1, 'Payee name is required')
    .max(100, 'Payee name too long'),
  amountPaise: z
    .number()
    .int('Amount must be integer paise')
    .min(100, 'Minimum UPI transaction is ₹1.00 (100 paise)')
    .max(10000000, 'UPI single transaction limit is ₹1,00,000 (10000000 paise)'),
  note: z
    .string()
    .trim()
    .max(80, 'UPI note cannot exceed 80 characters')
    .optional(),
  category: z.nativeEnum(TransactionCategory, {
    errorMap: () => ({ message: 'Invalid expense category' }),
  }),
  intentApp: z.nativeEnum(UPIIntentApp).optional(),
});

export type UPIInitiationInput = z.infer<typeof upiInitiationSchema>;
