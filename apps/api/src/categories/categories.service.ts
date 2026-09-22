import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const DEFAULT_CATEGORIES = [
  { name: 'FOOD_MESS', icon: '🍲' },
  { name: 'FOOD_SWIGGY_ZOMATO', icon: '🛵' },
  { name: 'CANTEEN_SNACKS', icon: '☕' },
  { name: 'ALCOHOL_PARTY', icon: '🍺' },
  { name: 'RENT_DEPOSIT', icon: '🏠' },
  { name: 'UTILITIES_WIFI', icon: '📶' },
  { name: 'ACADEMICS_BOOKS', icon: '📚' },
  { name: 'RECHARGE_DATA', icon: '📱' },
  { name: 'TRAVEL_AUTO_CAB', icon: '🛺' },
  { name: 'SHOPPING', icon: '🛍️' },
  { name: 'BORROW_LEND', icon: '🤝' },
  { name: 'OTHER', icon: '💸' },
];

@Injectable()
export class CategoriesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultCategories();
  }

  async seedDefaultCategories() {
    for (const cat of DEFAULT_CATEGORIES) {
      const existing = await this.prisma.category.findFirst({
        where: { name: cat.name },
      });
      if (!existing) {
        await this.prisma.category.create({
          data: {
            name: cat.name,
            icon: cat.icon,
            isDefault: true,
          },
        });
      }
    }
  }

  async findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
