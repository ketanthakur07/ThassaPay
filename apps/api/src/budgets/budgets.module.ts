import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, PrismaService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
