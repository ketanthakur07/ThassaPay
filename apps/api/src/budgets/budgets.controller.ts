import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { SetBudgetRequestDto } from '../expenses/expenses.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('v1/budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  /**
   * Audit fix (P1): month/amount were unvalidated — arbitrary strings went
   * into the DB unique key and negative budgets were accepted. Now validated,
   * and money arrives as an exact integer-paise string.
   */
  @Post()
  async setBudget(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: SetBudgetRequestDto,
  ) {
    return this.budgetsService.setMonthlyBudget(user.id, body.month, body.amountPaise);
  }

  @Get()
  async getBudget(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month: string,
  ) {
    const currentMonth = month || new Date().toISOString().slice(0, 7);
    return this.budgetsService.getMonthlyBudget(user.id, currentMonth);
  }
}
