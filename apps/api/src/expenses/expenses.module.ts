import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaService } from '../common/prisma.service';
import { SharedJwtModule } from '../common/shared-jwt.module';

@Module({
  imports: [SharedJwtModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, PrismaService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
