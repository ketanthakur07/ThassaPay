import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import './common/bigint-json'; // ensures BigInt money serialization in every entry point
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
  providers: [
    // Audit fix (P1): ThrottlerModule was configured but never enforced —
    // without APP_GUARD the global 100 req/60s limit was dead configuration and
    // every endpoint (OTP request especially) was effectively unthrottled.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
