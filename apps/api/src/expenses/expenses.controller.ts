import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ExpensesService, CreateExpenseDto } from './expenses.service';
import { CreateExpenseRequestDto } from './expenses.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('v1/expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateExpenseRequestDto) {
    // Audit: amountPaise arrives as a validated integer (number or string) —
    // BigInt() converts exactly, and the service rejects <= 0.
    const serviceDto: CreateExpenseDto = {
      categoryId: dto.categoryId,
      amountPaise: dto.amountPaise,
      paymentMethod: dto.paymentMethod,
      description: dto.description,
      expenseDate: dto.expenseDate,
    };
    // Return the raw row: main.ts installs BigInt.toJSON, so paise serialise
    // as an exact JSON number — same contract as every other endpoint (list,
    // analytics, budgets). The previous `.toString()` made this one endpoint
    // answer a string where the mobile client declares a number.
    return this.expensesService.create(user.id, serviceDto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('categoryId') categoryId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const offsetNum = offset ? parseInt(offset, 10) : undefined;
    return this.expensesService.findAllForUser(user.id, {
      month,
      categoryId,
      limit: Number.isFinite(limitNum) ? limitNum : undefined,
      offset: Number.isFinite(offsetNum) ? offsetNum : undefined,
    });
  }

  @Delete(':id')
  async delete(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.expensesService.softDelete(user.id, id);
  }

  @Put(':id/correct')
  async correct(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: CreateExpenseRequestDto,
  ) {
    const serviceDto: CreateExpenseDto = {
      categoryId: dto.categoryId,
      amountPaise: dto.amountPaise,
      paymentMethod: dto.paymentMethod,
      description: dto.description,
      expenseDate: dto.expenseDate,
    };
    // Raw row — BigInt.toJSON keeps the wire format consistent (see create()).
    return this.expensesService.correctExpense(user.id, id, serviceDto);
  }
}
