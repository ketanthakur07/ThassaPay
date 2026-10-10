import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Audit: accepts an integer-paise string (exact) — a negative or zero budget is rejected. */
  async setMonthlyBudget(userId: string, month: string, amountPaise: number | bigint | string) {
    const BigAmount = BigInt(amountPaise);
    if (BigAmount <= 0n) {
      throw new BadRequestException('Budget must be greater than zero');
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }

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
