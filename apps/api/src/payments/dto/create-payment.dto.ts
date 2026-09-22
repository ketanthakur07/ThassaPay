import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
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

  @IsString()
  description?: string;
}

/**
 * Reported by the client after the UPI app returns control. This is NOT
 * trusted as ground truth on its own — it only moves the attempt into
 * AWAITING_CONFIRMATION (if the client claims it went fine) or FAILED/CANCELLED
 * (if the client says it definitely didn't happen). It can never set SUCCESS.
 */
export class ReportPaymentReturnDto {
  @IsString()
  outcome!: 'app_returned_ok' | 'user_cancelled' | 'app_returned_error';

  referenceId?: string;
}
