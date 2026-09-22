# ThassaPay — Roast Engine

## What the Roast Engine Is

The Roast Engine is a **pure function** that takes a computed spending summary and returns a contextual roast string. It is the feature that makes ThassaPay feel like ThassaPay — not a boring expense tracker, but your broke hostel friend with access to your credit card statement.

```typescript
roast(summary: SpendingSummary, mode: RoastMode): string
```

That's it. One input. One output. No database. No side effects. No financial state changes.

---

## What the Roast Engine Is NOT

- Not a financial rule engine
- Not allowed to read from the database
- Not allowed to write to the database
- Not allowed to create, modify, or delete any financial record
- Not allowed to override, discount, or correct any expense
- Not allowed to make payments
- Not allowed to set budgets

Any code review that finds the Roast Engine touching financial state is an immediate blocker.

---

## Input: SpendingSummary

```typescript
interface SpendingSummary {
  // Budget
  budgetPaise: bigint;
  spentPaise: bigint;
  remainingPaise: bigint;
  budgetUsedPercent: number;   // 0–100+
  
  // Time
  monthYear: string;           // "2026-09"
  daysElapsed: number;
  daysRemaining: number;
  projectedMonthEndPaise: bigint;
  
  // Categories (sorted by spend, descending)
  categories: Array<{
    name: string;
    amountPaise: bigint;
    percentOfTotal: number;
    transactionCount: number;
  }>;
  
  // Patterns
  topCategoryName: string;
  topCategoryPercent: number;
  foodTransactionsTodayCount: number;  // food = category named 'Food' or 'Snacks'
  consecutiveZeroExpenseDays: number;
  singleLargestExpensePaise: bigint;
  singleLargestExpensePercentOfBudget: number;
}
```

---

## Roast Modes

Users can choose their roast intensity in Settings. Each level changes the vocabulary and tone.

| Mode | Description | Default? |
|---|---|---|
| `mild` | Clean language, PG-13, friendly sarcasm | Yes |
| `spicy` | Hinglish, Gen-Z slang, sharper roasts | Opt-in |
| `unfiltered` | Explicit enable required; stronger language, hostel-authentic profanity | Double opt-in |

The `unfiltered` mode requires the user to explicitly toggle a separate confirmation. It is not set by default and its availability can be disabled via a server feature flag.

---

## Roast Logic Rules

Rules are evaluated in priority order. The first matching rule wins.

### Priority 1 — Budget Exhausted

```
IF budgetUsedPercent >= 100
  mild:       "Budget gone. Month still going. This is fine. 🔥"
  spicy:      "CHUD GAYE GURU 💀 Budget khatam, mahina baaki."
  unfiltered: "BHAI CHUD GAYA TU. Budget zero. Month still going. Kya karega ab?"
```

### Priority 2 — Projected to Overspend

```
IF projectedMonthEndPaise > budgetPaise * 1.2 (20% over)
  mild:       "At this rate you'll overshoot your budget by ₹{overrun}. Slow down."
  spicy:      "Projection dekh. ₹{overrun} extra jaayega iss mahine. Calculator khol bhai."
  unfiltered: "MC projection dekha? ₹{overrun} blow karega. Paisa aata kahan se hai tere ko?"
```

### Priority 3 — Critical Low (< 20% remaining, > 15 days left)

```
IF remainingPaise < budgetPaise * 0.2 AND daysRemaining > 15
  mild:       "20% budget left, 15+ days to go. This math does not math."
  spicy:      "Aadha mahina baaki, {remainingDisplay} bachi hai. Genius move."
  unfiltered: "Bhai kaun hain tum. {daysRemaining} din baaki, {remainingDisplay} hai. Kha le khud ko."
```

### Priority 4 — Single Massive Transaction (> 30% of budget)

```
IF singleLargestExpensePercentOfBudget > 30
  mild:       "One transaction ate 30% of your budget. Bold move."
  spicy:      "EK payment mein {percent}% budget? BSDK firse soch le."
  unfiltered: "EK PAYMENT MEIN {percent}% BUDGET? BHAI TU THEEK HAI? BSDK firse soch le."
```

### Priority 5 — Food Dominating Spend (> 50% of total)

```
IF topCategoryName IN ['Food', 'Snacks'] AND topCategoryPercent > 50
  mild:       "Food is {percent}% of your spending. You are basically a human stomach."
  spicy:      "Tu kha raha hai ya Swiggy ko sponsor kar raha hai? {percent}% food."
  unfiltered: "BHAI ITNA KHAATA HAI TU? {percent}% sirf khaane mein? Mess wale tujhe family maante hain."
```

### Priority 6 — Multiple Food Transactions Today (>= 3)

```
IF foodTransactionsTodayCount >= 3
  mild:       "Third food expense today. Your stomach runs on a subscription model."
  spicy:      "Canteen mein table book kar le bhai. Teesri baar aaj."
  unfiltered: "Bhai canteen wale tujhe staff samajhne lage hain. TEESRI BAAR AAJ."
```

### Priority 7 — Ghost Mode (3+ consecutive zero-expense days)

```
IF consecutiveZeroExpenseDays >= 3
  mild:       "No expenses in 3 days. Either broke or enlightened."
  spicy:      "Ghost mode on? {days} din se kuch nahi. Ya card hi nahi hai?"
  unfiltered: "BHAI {days} DIN SE KUCH NAHI? Tu theek hai? Ya ration khatam ho gaya?"
```

### Priority 8 — Looking Good

```
IF budgetUsedPercent < 60 AND daysElapsed > daysRemaining
  mild:       "More than halfway through the month and still on budget. Respect."
  spicy:      "Bhai set hai tu. Halfway done, budget intact. Proud moment."
  unfiltered: "BC tu actually budget follow kar raha hai? Bhai proud hu main."
```

### Default — All Good

```
  mild:       "Budget on track. Keep it up."
  spicy:      "Chill hai bhai, abhi toh set hai."
  unfiltered: "BC sab theek hai abhi. Enjoy kar."
```

---

## Implementation

```typescript
// apps/api/src/analytics/roast.engine.ts

export type RoastMode = 'mild' | 'spicy' | 'unfiltered';

export interface SpendingSummary { /* ... see above ... */ }

export function roast(summary: SpendingSummary, mode: RoastMode = 'mild'): string {
  const pick = (mild: string, spicy: string, unfiltered: string) =>
    mode === 'unfiltered' ? unfiltered : mode === 'spicy' ? spicy : mild;

  // Rule 1: Budget exhausted
  if (summary.budgetUsedPercent >= 100) {
    return pick(
      'Budget gone. Month still going. This is fine. 🔥',
      'CHUD GAYE GURU 💀 Budget khatam, mahina baaki.',
      'BHAI CHUD GAYA TU. Budget zero. Month still going. Kya karega ab?',
    );
  }
  // ... (all rules)
  
  return pick(
    'Budget on track. Keep it up.',
    'Chill hai bhai, abhi toh set hai.',
    'BC sab theek hai abhi. Enjoy kar.',
  );
}
```

The function is a series of `if/return` guards. No class, no state, no dependency injection. It can be unit tested with zero mocking.

---

## Testing

```typescript
// apps/api/test/roast.engine.spec.ts

describe('roast engine', () => {
  it('fires budget-exhausted rule when spent >= budget', () => {
    const result = roast(summaryWith({ budgetUsedPercent: 100 }), 'spicy');
    expect(result).toContain('CHUD GAYE GURU');
  });

  it('does NOT modify any financial state', () => {
    // The roast function returns a string.
    // No side effects possible — it takes no dependencies.
    const result = roast(anySummary, 'mild');
    expect(typeof result).toBe('string');
  });

  it('mild mode never contains profanity', () => {
    const profanity = ['bsdk', 'bc', 'chud', 'mc'];
    const result = roast(worstCaseSummary, 'mild').toLowerCase();
    profanity.forEach(word => expect(result).not.toContain(word));
  });
});
```

---

## API Endpoint

```
GET /api/v1/analytics/roast?month=2026-09
Authorization: Bearer <token>
```

**Response**:
```json
{
  "roast": "Tu kha raha hai ya Swiggy ko sponsor kar raha hai? 54% food.",
  "mode": "spicy",
  "trigger": "food_dominating",
  "context": {
    "topCategoryName": "Food",
    "topCategoryPercent": 54
  }
}
```

The `trigger` field tells the mobile app which roast rule fired — useful for showing the right illustration/meme alongside the roast text.

---

## Content Guidelines

**The roast must be**:
- Contextual — tied to actual spending data, not random
- Proportional — mild roast for mild overspend, nuclear roast for catastrophic overspend
- Hostel-authentic — written like a friend, not a bank notification
- Reversible — a good roast is funny even if the user disagrees with it

**The roast must NOT be**:
- Discriminatory toward any protected group
- Threatening or menacing
- Body-shaming in a harmful way
- Used to manipulate financial decisions (the roast informs; it does not command)
- A disguise for actual financial advice ("you should invest in X")

**The `unfiltered` mode specifically**:
- Uses hostel slang and profanity in the way actual hostel students use it — not as hate speech
- Is always opt-in with explicit confirmation
- Can be disabled via server feature flag without any client change

---

## Roast Engine + Product Personality

The Roast Engine is what makes ThassaPay feel like ThassaPay. The rest of the app (budget tracking, expense logging, analytics) could be any boring fintech app. The Roast Engine is the personality layer.

Some design principles:

1. **Roasts should be specific**: `"Tu kha raha hai ya Swiggy ko sponsor kar raha hai? 54% food."` is better than `"You spend too much on food."`
2. **Roasts should acknowledge reality**: If someone's budget is genuinely intact, the roast acknowledges it. Not every session needs to end in a dressing-down.
3. **Roasts are not punishments**: The goal is self-awareness with humor, not shame.
4. **The roast is a snapshot**: It reflects today's data. Yesterday's roast is gone.
