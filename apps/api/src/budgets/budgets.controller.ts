import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('v1/budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  async setBudget(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: { month: string; amountPaise: number },
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
