import { z } from 'zod';
import { indianPhoneSchema } from './upi.schema';
import { RoastTone } from '@thassapay/types';

export const requestOtpSchema = z.object({
  phoneNumber: indianPhoneSchema,
});

export const verifyOtpSchema = z.object({
  phoneNumber: indianPhoneSchema,
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50).optional(),
  hostelName: z.string().trim().max(100).optional(),
  roomNumber: z.string().trim().max(20).optional(),
  collegeName: z.string().trim().max(100).optional(),
  preferredRoastTone: z.nativeEnum(RoastTone).optional(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
