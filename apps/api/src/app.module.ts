import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PaymentsModule } from './payments/payments.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ExpensesModule } from './expenses/expenses.module';
import { BudgetsModule } from './budgets/budgets.module';
import { CategoriesModule } from './categories/categories.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RoastEngineModule } from './roast-engine/roast-engine.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // powers ReconciliationJob's @Cron
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // global rate limit, separate from per-user payment limit
    PaymentsModule,
    AuthModule,
    UsersModule,
    ExpensesModule,
    BudgetsModule,
    CategoriesModule,
    AnalyticsModule,
    RoastEngineModule,
  ],
})
export class AppModule {}
