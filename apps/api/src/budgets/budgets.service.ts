import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async setMonthlyBudget(userId: string, month: string, amountPaise: number | bigint) {
    const BigAmount = BigInt(amountPaise);

    const budget = await this.prisma.budget.upsert({
      where: {
        userId_month: { userId, month },
      },
      update: {
        amountPaise: BigAmount,
      },
      create: {
        userId,
        month,
        amountPaise: BigAmount,
      },
    });

    return {
      ...budget,
      amountPaise: Number(budget.amountPaise),
    };
  }

  async getMonthlyBudget(userId: string, month: string) {
    const budget = await this.prisma.budget.findUnique({
      where: {
        userId_month: { userId, month },
      },
    });

    if (!budget) {
      return { month, amountPaise: 0 };
    }

    return {
      ...budget,
      amountPaise: Number(budget.amountPaise),
    };
  }
}
