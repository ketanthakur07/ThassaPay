import {
  TransactionCategory,
  TransactionType,
  PaymentStatus,
  UPIIntentApp,
  RoastTone,
  RoastIntensity,
  BudgetPeriod,
} from './enums';

export interface UserProfile {
  id: string;
  phoneNumber: string;
  name: string;
  hostelName?: string;
  roomNumber?: string;
  collegeName?: string;
  preferredRoastTone: RoastTone;
  createdAt: string;
  updatedAt: string;
}

export interface UPIInitiationPayload {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  note?: string;
  category: TransactionCategory;
  intentApp?: UPIIntentApp;
}

export interface UPIInitiationResponse {
  initiationId: string;
  deepLink: string;
  vpa: string;
  payeeName: string;
  amountPaise: number;
  qrPayload: string;
  expiresAt: string;
}

export interface TransactionDTO {
  id: string;
  userId: string;
  amountPaise: number;
  type: TransactionType;
  category: TransactionCategory;
  payeeVpa?: string;
  payeeName?: string;
  status: PaymentStatus;
  note?: string;
  initiatedAt: string;
  confirmedAt?: string;
  roastComment?: string;
}

export interface RoastEngineRequest {
  userId: string;
  transactionAmountPaise: number;
  category: TransactionCategory;
  dailySpentSoFarPaise: number;
  monthlySpentSoFarPaise: number;
  budgetLimitPaise?: number;
  userTonePreference: RoastTone;
}

export interface RoastEngineResponse {
  roastText: string;
  toneUsed: RoastTone;
  intensity: RoastIntensity;
  damageScore: number; // 0 to 100
  memeUrl?: string;
}

export interface BudgetConfig {
  id: string;
  userId: string;
  category?: TransactionCategory;
  limitPaise: number;
  period: BudgetPeriod;
}
