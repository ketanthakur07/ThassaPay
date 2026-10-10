import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PaymentRateLimitGuard } from '../common/guards/payment-rate-limit.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, ReportPaymentReturnDto } from './dto/create-payment.dto';

/**
 * Audit fix (P0/P1): the confirm body was previously an untyped inline object,
 * so `didSucceed` and `categoryId` arrived unvalidated — a malformed request
 * could create an expense with an arbitrary categoryId FK violation (500) or
 * coerce "truthy" strings into a SUCCESS. class-validator now enforces the
 * contract before it reaches the state machine.
 */
export class ConfirmPaymentDto {
  @IsBoolean()
  didSucceed!: boolean;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

@Controller('v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @UseGuards(PaymentRateLimitGuard)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePaymentDto) {
    return this.payments.createPaymentAttempt(user.id, dto);
  }

  /**
   * Audit addition (P0): explicit entry into the NEEDS_REVIEW flow. The mobile
   * client calls this right after the UPI app returns, so the user can answer
   * the verification question immediately instead of waiting for the 10-minute
   * reconciliation sweep. It cannot set SUCCESS — only /confirm can, after the
   * user explicitly answers.
   */
  @Post(':id/review')
  review(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.payments.reviewNow(user.id, id);
  }

  /**
   * Audit addition (Step 20): lets a client recover the authoritative status of
   * an attempt after an app restart/crash mid-payment. Ownership is enforced
   * in the service — a user can only ever read their own attempts.
   */
  @Get(':id')
  get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.payments.getOwnedAttemptPublic(user.id, id);
  }

  @Post(':id/return')
  reportReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ReportPaymentReturnDto,
  ) {
    return this.payments.reportReturn(user.id, id, dto);
  }

  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.payments.userConfirm(user.id, id, dto.didSucceed, dto.categoryId, dto.description);
  }
}
