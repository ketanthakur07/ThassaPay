import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreatePaymentDto {
  /**
   * Audit fix (P0): this was `@IsUUID()`, but PayScreen generates
   * `pay_<timestamp>_<rand>` — so EVERY payment creation from the app was
   * rejected with 400 by the ValidationPipe before it reached the state
   * machine (the endpoint was unreachable in real use). The key is an
   * opaque client-generated string, bounded and character-restricted so it
   * cannot carry payload data; the DB still enforces uniqueness.
   */
  @Matches(/^[A-Za-z0-9_-]{8,128}$/, {
    message: 'idempotencyKey must be an opaque client key of 8-128 URL-safe characters',
  })
  idempotencyKey!: string; // client-generated once per payment attempt, resent on retry

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a valid rupee amount, e.g. "250" or "250.50"' })
  amount!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/, { message: 'upiId must look like a valid VPA' })
  upiId!: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

/**
 * Reported by the client after the UPI app returns control. This is NOT
 * trusted as ground truth on its own — it only moves the attempt into
 * AWAITING_CONFIRMATION (if the client claims it went fine) or FAILED/CANCELLED
 * (if the client says it definitely didn't happen). It can never set SUCCESS.
 */
export class ReportPaymentReturnDto {
  /**
   * Audit fix (P0): the mobile client sends { status: 'USER_RETURNED' } (no
   * `outcome` field), so the unvalidated union default pushed every real
   * return into FAILED. An explicit enum is validated here, and the DTO is
   * now decorated so the global ValidationPipe can enforce it.
   */
  @IsIn(['app_returned_ok', 'user_cancelled', 'app_returned_error'])
  outcome!: 'app_returned_ok' | 'user_cancelled' | 'app_returned_error';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  referenceId?: string;
}
