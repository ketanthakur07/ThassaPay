import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMonthlySummary(userId: string, monthStr?: string) {
    const month = monthStr || new Date().toISOString().slice(0, 7);
    const [year, m] = month.split('-').map(Number);

    const startDate = new Date(year, m - 1, 1);
    const endDate = new Date(year, m, 0, 23, 59, 59, 999);

    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        deletedAt: null,
        expenseDate: { gte: startDate, lte: endDate },
      },
      include: { category: true },
    });

    const budget = await this.prisma.budget.findUnique({
      where: { userId_month: { userId, month } },
    });

    let totalSpentPaise = 0n;
    const categoryBreakdownMap = new Map<string, { categoryId: string; categoryName: string; amountPaise: bigint }>();

    for (const exp of expenses) {
      totalSpentPaise += exp.amountPaise;
      const existing = categoryBreakdownMap.get(exp.categoryId) || {
        categoryId: exp.categoryId,
        categoryName: exp.category.name,
        amountPaise: 0n,
      };
      existing.amountPaise += exp.amountPaise;
      categoryBreakdownMap.set(exp.categoryId, existing);
    }

    const budgetLimitPaise = budget ? budget.amountPaise : 0n;
    let damageScore = 0;

    if (budgetLimitPaise > 0n) {
      const percentage = (Number(totalSpentPaise) / Number(budgetLimitPaise)) * 100;
      damageScore = Math.min(100, Math.round(percentage));
    } else if (totalSpentPaise > 0n) {
      damageScore = 50; // default moderate score when no budget set but spending exists
    }

    const categoryBreakdown = Array.from(categoryBreakdownMap.values()).map((c) => ({
      ...c,
      amountPaise: Number(c.amountPaise),
    }));

    return {
      month,
      totalSpentPaise: Number(totalSpentPaise),
      budgetLimitPaise: Number(budgetLimitPaise),
      damageScore,
      categoryBreakdown,
      transactionCount: expenses.length,
    };
  }
}
