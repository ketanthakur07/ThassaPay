import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ExpensesService, CreateExpenseDto } from './expenses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('v1/expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateExpenseDto) {
    const res = await this.expensesService.create(user.id, dto);
    return { ...res, amountPaise: Number(res.amountPaise) };
  }

  @Get()
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Query('month') month?: string,
    @Query('categoryId') categoryId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.expensesService.findAllForUser(user.id, {
      month,
      categoryId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
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
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.correctExpense(user.id, id, dto);
  }
}
