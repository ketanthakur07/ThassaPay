import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsPaiseAmount } from '../common/validation/paise-amount.decorator';

/**
 * Audit addition (P0/P1): the expenses controller previously accepted the raw
 * service interface — the global ValidationPipe had nothing to validate, so
 * negative/zero amounts, garbage categoryIds and invalid dates reached the
 * service. Money is accepted as an exact integer paise value in either wire
 * form the client uses (number or string) and converted to BigInt in the
 * service.
 */
export class CreateExpenseRequestDto {
  @IsUUID()
  categoryId!: string;

  @IsPaiseAmount()
  amountPaise!: number | string;

  @IsIn(['UPI', 'CASH', 'CARD', 'OTHER'])
  paymentMethod!: 'UPI' | 'CASH' | 'CARD' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  expenseDate?: string;
}

export class SetBudgetRequestDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  @IsNotEmpty()
  month!: string;

  @IsPaiseAmount()
  amountPaise!: number | string;
}
