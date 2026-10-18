import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Audit addition (P1): both auth endpoints took a bare inline object type, so
 * the global ValidationPipe had nothing to validate — any body (arbitrary
 * phone strings, any OTP shape) reached the service unbounded.
 *
 * Field sets intentionally match what the mobile client sends
 * (`apiClient.auth.requestOtp` / `verifyOtp`), so `forbidNonWhitelisted`
 * cannot reject a legitimate call.
 */

/** Same rule as packages/validation INDIAN_PHONE_REGEX (Indian mobile number). */
const INDIAN_PHONE_REGEX = /^(?:\+91|91)?[6-9]\d{9}$/;

export class RequestOtpDto {
  @Matches(INDIAN_PHONE_REGEX, { message: 'Invalid Indian mobile phone number' })
  @MaxLength(14)
  phoneNumber!: string;
}

export class VerifyOtpDto {
  @Matches(INDIAN_PHONE_REGEX, { message: 'Invalid Indian mobile phone number' })
  @MaxLength(14)
  phoneNumber!: string;

  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp!: string;
}

/**
 * Refresh/logout bodies carry the opaque refresh token. It is bounded in
 * length and required so an empty body can never reach the credential store.
 */
export class RefreshTokenDto {
  @IsString()
  @MaxLength(512)
  refreshToken!: string;
}

/** Logout may optionally name the session to revoke; omit for "this one". */
export class LogoutDto {
  @IsString()
  @MaxLength(512)
  refreshToken!: string;
}
