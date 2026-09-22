import { Injectable } from '@nestjs/common';
import { RoastTone, RoastIntensity } from '@thassapay/types';

export interface GenerateRoastInput {
  amountPaise: number;
  categoryName: string;
  monthlySpendPaise: number;
  monthlyBudgetPaise?: number;
  tone?: RoastTone;
}

const ROAST_TEMPLATES: Record<string, Record<RoastTone, string[]>> = {
  FOOD_SWIGGY_ZOMATO: {
    [RoastTone.BRUTAL]: [
      'Another ₹{amount} gone on midnight delivery. Your mess fee was already paid, but you chose cold biryani and delivery fees.',
      '₹{amount} for late-night delivery? Your bank account is screaming, but your tastebuds said YOLO.',
    ],
    [RoastTone.SARDONIC]: [
      'Ah yes, paying ₹{amount} for food delivery when mess food is free. Peak hostel economics.',
      '₹{amount} on Zomato. Next week you will be begging for extra maggi packets.',
    ],
    [RoastTone.GENTLE]: [
      'Treating yourself is nice, but ₹{amount} adds up quickly! Maybe mess food tomorrow?',
    ],
    [RoastTone.DISAPPOINTED_PARENT]: [
      'We sent money for books and hostel fees, not ₹{amount} on Zomato every night.',
    ],
    [RoastTone.FINANCIAL_GURU]: [
      'Spending ₹{amount} per day on delivery equals ₹{yearly} a year. That is a laptop upgrade.',
    ],
  },
  ALCOHOL_PARTY: {
    [RoastTone.BRUTAL]: [
      '₹{amount} on party supplies? Your GPA and bank balance are competing for the lowest number.',
      'Congratulations on spending ₹{amount} to buy tomorrow morning’s headache.',
    ],
    [RoastTone.SARDONIC]: [
      '₹{amount} for weekend party. Monday morning breakfast will be tap water and regret.',
    ],
    [RoastTone.GENTLE]: [
      'Have fun, but keep an eye on your budget! ₹{amount} is quite a chunk of your monthly allowance.',
    ],
    [RoastTone.DISAPPOINTED_PARENT]: [
      'Is this why you asked for an extra ₹2000 allowance yesterday?',
    ],
    [RoastTone.FINANCIAL_GURU]: [
      'Liquidity depleted by ₹{amount}. Reallocate funds to emergency reserves immediately.',
    ],
  },
  DEFAULT: {
    [RoastTone.BRUTAL]: [
      '₹{amount} spent. At this rate, end of the month will be survival mode on borrowed mess coupons.',
    ],
    [RoastTone.SARDONIC]: [
      'Another ₹{amount} out the door. The damage is real.',
    ],
    [RoastTone.GENTLE]: [
      'Tracked ₹{amount} expense. Stay mindful of your monthly goal!',
    ],
    [RoastTone.DISAPPOINTED_PARENT]: [
      'Do you even keep track of where ₹{amount} goes every week?',
    ],
    [RoastTone.FINANCIAL_GURU]: [
      'Capital outflow of ₹{amount} recorded. Budget status monitored.',
    ],
  },
};

@Injectable()
export class RoastEngineService {
  generateRoast(input: GenerateRoastInput) {
    const rupees = (input.amountPaise / 100).toFixed(2);
    const yearly = ((input.amountPaise / 100) * 365).toFixed(0);
    const tone = input.tone || RoastTone.BRUTAL;

    const categoryKey = ROAST_TEMPLATES[input.categoryName] ? input.categoryName : 'DEFAULT';
    const toneTemplates = ROAST_TEMPLATES[categoryKey][tone] || ROAST_TEMPLATES.DEFAULT[tone];

    const randomIndex = Math.floor(Math.random() * toneTemplates.length);
    const template = toneTemplates[randomIndex];

    const roastText = template.replace(/\{amount\}/g, rupees).replace(/\{yearly\}/g, yearly);

    // Calculate damage score (0 - 100)
    let damageScore = 20;
    if (input.monthlyBudgetPaise && input.monthlyBudgetPaise > 0) {
      const percentUsed = (input.monthlySpendPaise / input.monthlyBudgetPaise) * 100;
      damageScore = Math.min(100, Math.round(percentUsed));
    }

    let intensity = RoastIntensity.MILD;
    if (damageScore > 80) {
      intensity = RoastIntensity.NUCLEAR;
    } else if (damageScore > 50) {
      intensity = RoastIntensity.SPICY;
    }

    return {
      roastText,
      toneUsed: tone,
      intensity,
      damageScore,
    };
  }
}
