export enum TransactionCategory {
  FOOD_MESS = 'FOOD_MESS',
  FOOD_SWIGGY_ZOMATO = 'FOOD_SWIGGY_ZOMATO',
  CANTEEN_SNACKS = 'CANTEEN_SNACKS',
  ALCOHOL_PARTY = 'ALCOHOL_PARTY',
  RENT_DEPOSIT = 'RENT_DEPOSIT',
  UTILITIES_WIFI = 'UTILITIES_WIFI',
  ACADEMICS_BOOKS = 'ACADEMICS_BOOKS',
  RECHARGE_DATA = 'RECHARGE_DATA',
  TRAVEL_AUTO_CAB = 'TRAVEL_AUTO_CAB',
  SHOPPING = 'SHOPPING',
  BORROW_LEND = 'BORROW_LEND',
  OTHER = 'OTHER',
}

export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/**
 * Source of truth: apps/api/prisma/schema.prisma (`enum PaymentStatus`).
 *
 * Audit fix (P0): this shared enum was still the v1 list
 * (PENDING_VERIFICATION / CONFIRMED / EXPIRED / DISPUTED) while the API and
 * the migration create INITIATED / AWAITING_CONFIRMATION / SUCCESS /
 * FAILED / NEEDS_REVIEW / CANCELLED. Every status comparison in the mobile
 * app compiled against values the server can never send, and the app's
 * typecheck failed. Keep this in lockstep with the Prisma schema — a drift
 * here silently breaks the API <-> mobile contract on both sides.
 */
export enum PaymentStatus {
  INITIATED = 'INITIATED',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  CANCELLED = 'CANCELLED',
}

export enum UPIIntentApp {
  PHONEPE = 'PHONEPE',
  GPAY = 'GPAY',
  PAYTM = 'PAYTM',
  CRED = 'CRED',
  BHIM = 'BHIM',
  OTHER = 'OTHER',
}

export enum RoastTone {
  BRUTAL = 'BRUTAL',
  SARDONIC = 'SARDONIC',
  GENTLE = 'GENTLE',
  DISAPPOINTED_PARENT = 'DISAPPOINTED_PARENT',
  FINANCIAL_GURU = 'FINANCIAL_GURU',
}

export enum RoastIntensity {
  MILD = 'MILD',
  SPICY = 'SPICY',
  NUCLEAR = 'NUCLEAR',
}

export enum AccountType {
  BANK_ACCOUNT = 'BANK_ACCOUNT',
  CASH_HAND = 'CASH_HAND',
  BORROWED_DEBT = 'BORROWED_DEBT',
  OWED_CREDIT = 'OWED_CREDIT',
}

export enum BudgetPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}
