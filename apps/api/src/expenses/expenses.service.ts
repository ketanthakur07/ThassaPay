import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ExpenseSource, PaymentMethod } from '@prisma/client';

export interface CreateExpenseDto {
  categoryId: string;
  /** Integer paise as number, bigint, or exact string (from validated JSON). */
  amountPaise: number | bigint | string;
  paymentMethod: PaymentMethod;
  description?: string;
  expenseDate?: string;
  paymentAttemptId?: string;
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateExpenseDto) {
    // Audit fix (P0): negative and zero amounts were accepted and stored,
    // silently corrupting budgets/analytics. Reject before anything is written.
    const amountPaise = BigInt(dto.amountPaise);
    if (amountPaise <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    const expenseDate = dto.expenseDate ? new Date(dto.expenseDate) : new Date();
    if (isNaN(expenseDate.getTime())) {
      throw new BadRequestException('Invalid expenseDate');
    }

    return this.prisma.expense.create({
      data: {
        userId,
        categoryId: dto.categoryId,
        amountPaise,
        paymentMethod: dto.paymentMethod,
        source: dto.paymentAttemptId ? ExpenseSource.UPI : ExpenseSource.MANUAL,
        description: dto.description,
        expenseDate,
        paymentAttemptId: dto.paymentAttemptId,
      },
      include: {
        category: true,
      },
    });
  }

  async findAllForUser(
    userId: string,
    query: { month?: string; categoryId?: string; limit?: number; offset?: number },
  ) {
    const where: {
      userId: string;
      deletedAt: null;
      categoryId?: string;
      expenseDate?: { gte: Date; lte: Date };
    } = { userId, deletedAt: null };

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.month) {
      // month format: "YYYY-MM"
      const [year, month] = query.month.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      where.expenseDate = { gte: startDate, lte: endDate };
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      take: query.limit || 50,
      skip: query.offset || 0,
      include: { category: true },
    });

    return expenses.map((e) => ({
      ...e,
      amountPaise: Number(e.amountPaise), // Convert BigInt to number for JSON response
    }));
  }

  async softDelete(userId: string, expenseId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, userId, deletedAt: null },
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    await this.prisma.expense.update({
      where: { id: expenseId },
      data: { deletedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        actorType: 'user',
        action: 'expense.soft_deleted',
        targetType: 'expense',
        targetId: expenseId,
        metadata: { amountPaise: Number(expense.amountPaise) },
      },
    });

    return { success: true };
  }

  async correctExpense(userId: string, expenseId: string, newDto: CreateExpenseDto) {
    const original = await this.prisma.expense.findFirst({
      where: { id: expenseId, userId, deletedAt: null },
    });

    if (!original) {
      throw new NotFoundException('Original expense not found');
    }

    // Same financial-identity guard as create(): a correction is still a write.
    const newAmountPaise = BigInt(newDto.amountPaise);
    if (newAmountPaise <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    // Soft delete original
    await this.prisma.expense.update({
      where: { id: expenseId },
      data: { deletedAt: new Date() },
    });

    // Create new corrected expense
    const newExpense = await this.prisma.expense.create({
      data: {
        userId,
        categoryId: newDto.categoryId,
        amountPaise: newAmountPaise,
        paymentMethod: newDto.paymentMethod,
        source: original.source,
        description: newDto.description || original.description,
        expenseDate: newDto.expenseDate ? new Date(newDto.expenseDate) : original.expenseDate,
        correctedFromId: original.id,
      },
      include: { category: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        actorType: 'user',
        action: 'expense.corrected',
        targetType: 'expense',
        targetId: newExpense.id,
        metadata: {
          originalId: original.id,
          oldAmount: Number(original.amountPaise),
          newAmount: Number(newExpense.amountPaise),
        },
      },
    });

    return {
      ...newExpense,
      amountPaise: Number(newExpense.amountPaise),
    };
  }
}
