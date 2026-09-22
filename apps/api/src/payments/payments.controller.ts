import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PaymentRateLimitGuard } from '../common/guards/payment-rate-limit.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, ReportPaymentReturnDto } from './dto/create-payment.dto';

@Controller('v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @UseGuards(PaymentRateLimitGuard)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePaymentDto) {
    return this.payments.createPaymentAttempt(user.id, dto);
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
    @Body() body: { didSucceed: boolean; categoryId: string; description?: string },
  ) {
    return this.payments.userConfirm(user.id, id, body.didSucceed, body.categoryId, body.description);
  }
}
