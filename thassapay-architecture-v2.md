# ThassaPay — Architecture v3

### Real-Money Architecture + Roast Engine

The original architecture correctly separated **payment from expense**, isolated UPI behind an adapter, and treated uncertain UPI outcomes carefully.

This revision keeps those foundations and adds a core ThassaPay product feature:

> **ThassaPay tracks your money. ThassaPay also judges your financial decisions.**

The roast system is intentionally separated from payment correctness. A roast can react to a payment, but it can never decide whether a payment succeeded, create financial records, modify balances, or interfere with the payment flow.

---

# 1. Core Problem

UPI Intent does not provide ThassaPay with a universally authoritative confirmation that money actually moved.

The application can launch Google Pay, PhonePe, Paytm, or another UPI application and regain control later. The result returned to ThassaPay may be missing, delayed, incomplete, or unreliable.

Therefore ThassaPay must be designed around three principles:

1. **The backend never trusts client-reported success alone.**
2. **Payment state is modeled as a state machine with explicit transitions.**
3. **Financial records are separate from the UI roast/personality layer.**

A user may see:

> **"BSDK FIRSE SOCH LE 💀"**

before a large payment, but that message has no authority over whether the payment succeeds.

---

# 2. High-Level Architecture

```text
                         ┌───────────────────────────┐
                         │          ThassaPay         │
                         │    React Native + Expo     │
                         └─────────────┬─────────────┘
                                       │
                                  HTTPS / API
                                       │
                                       ▼
                  ┌────────────────────────────────────┐
                  │             NestJS API               │
                  ├────────────────────────────────────┤
                  │ Authentication                      │
                  │ Users                               │
                  │ Expenses                            │
                  │ Budgets                             │
                  │ Payments                            │
                  │ Analytics                           │
                  │ Notifications                       │
                  │ Roast Engine                        │
                  │ Admin / RBAC                         │
                  └───────────────┬────────────────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   ▼                             ▼
          ┌─────────────────┐           ┌─────────────────┐
          │   PostgreSQL    │           │      Redis      │
          │                 │           │                 │
          │ Users           │           │ BullMQ          │
          │ Expenses        │           │ Rate limits     │
          │ Payments        │           │ Cache           │
          │ Events          │           │ Scheduled jobs  │
          │ Budgets         │           └─────────────────┘
          │ Roast events    │
          └─────────────────┘
                   │
                   │
       ┌───────────┴─────────────────────┐
       ▼                                 ▼
┌───────────────────────┐       ┌────────────────────────┐
│    Payment System     │       │     Roast Engine       │
│                       │       │                        │
│ UPI Intent Adapter    │       │ Trigger Detection      │
│ Payment State Machine │       │ Context Analysis       │
│ Reconciliation        │       │ Roast Selection        │
│ Payment Events        │       │ Cooldowns              │
└──────────┬────────────┘       │ User Roast Settings   │
           │                    └────────────┬───────────┘
           ▼                                 ▼
   Google Pay / PhonePe                Roast shown in UI
   Paytm / Other UPI Apps
```

---

# 3. Payment State Machine

```text
INITIATED
    │
    │ User opens UPI app
    ▼
AWAITING_CONFIRMATION
    │
    ├───────────────┬─────────────────┐
    ▼               ▼                 ▼
 SUCCESS          FAILED        TIMEOUT / UNKNOWN
    │               │                 │
    ▼               ▼                 ▼
Expense         No Expense       NEEDS_REVIEW
Created                              │
                                     │
                              User confirms
                                     │
                              ┌──────┴──────┐
                              ▼             ▼
                           SUCCESS        FAILED
                              │             │
                              ▼             ▼
                           Expense       No Expense
                           created
```

### Rules

Only `SUCCESS` creates/finalizes an expense.

`FAILED`, `CANCELLED`, `AWAITING_CONFIRMATION`, and `NEEDS_REVIEW` must not create a finalized expense.

The reconciliation process periodically checks unresolved payment attempts.

When an attempt becomes `NEEDS_REVIEW`, the user receives something like:

> **Did the ₹250 payment to canteen@upi actually go through?**

Actions:

```text
[ YES, I PAID ]
[ NO, IT FAILED ]
```

Every payment-state transition is recorded in an append-only `payment_events` table.

---

# 4. Idempotency

Every payment attempt receives a unique UUID.

```text
Client
   │
   │ Idempotency-Key: UUID
   ▼
Backend
   │
   ├── Key does not exist
   │       ↓
   │   Create payment attempt
   │
   └── Key already exists
           ↓
      Return existing attempt
```

This prevents duplicate payment attempts caused by:

* double taps
* network retries
* app retries
* request timeouts
* unstable mobile connections

The same principle should be applied to other client-triggered money-changing operations.

---

# 5. Money Representation

Money is stored as **integer paise**.

```text
₹250.75

        ↓

25075 paise
```

Database:

```text
amount_paise BIGINT
```

The application must not perform financial calculations using floating-point values.

A single `Money` abstraction handles:

```text
parse ₹ input → paise
paise → formatted ₹ output
addition
subtraction
comparison
percentage calculations
```

No other part of the codebase should implement its own money conversion.

---

# 6. Database Architecture

## USERS

```text
id
college_id
name
email
phone
hostel_block
room_no
created_at
updated_at
deleted_at
```

## CATEGORIES

```text
id
name
icon
is_default
created_at
```

Examples:

```text
FOOD
LAUNDRY
GYM
TRAVEL
SHOPPING
COLLEGE
SUBSCRIPTIONS
ENTERTAINMENT
OTHER
```

## BUDGETS

```text
id
user_id
month
amount_paise
created_at
updated_at
```

## EXPENSES

```text
id
user_id
category_id
amount_paise
payment_method
description
expense_date
status
payment_attempt_id
corrected_from_id
deleted_at
created_at
updated_at
```

## PAYMENT_ATTEMPTS

```text
id
user_id
amount_paise
upi_id
idempotency_key
reference_id
status
initiated_at
completed_at
failure_reason
created_at
updated_at
```

`idempotency_key` must be unique.

## PAYMENT_EVENTS

```text
id
payment_attempt_id
from_status
to_status
event_type
metadata
created_at
```

This table is append-only.

## AUDIT_LOGS

```text
id
actor_id
actor_type
action
entity_type
entity_id
metadata
created_at
```

Money-relevant administrative actions must be auditable.

---

# 7. Roast Engine

## Purpose

The **Roast Engine** is the personality layer of ThassaPay.

It observes financial events and selects an appropriate reaction.

It should **never modify financial state**.

```text
Financial Event
      │
      ▼
Roast Engine
      │
      ├── Analyze amount
      ├── Analyze category
      ├── Analyze time
      ├── Analyze frequency
      ├── Analyze budget
      ├── Analyze history
      └── Analyze context
              │
              ▼
        Trigger Matcher
              │
              ▼
        Roast Selection
              │
              ▼
       UI / Notification
```

---

# 8. Roast Triggers

ThassaPay should support contextual triggers rather than random jokes.

## Balance triggers

```text
BALANCE_LOW
BALANCE_CRITICAL
BALANCE_ZERO
BUDGET_50
BUDGET_75
BUDGET_90
BUDGET_100
BUDGET_EXCEEDED
```

Examples:

> **"Chud gaye guru 💀"**

> **"Bhai bas ₹87 bache hain. Ab hawa kha."**

> **"Budget khatam. Month nahi."**

> **"Paise aaye the. Tumne jaane diya."**

---

## Large-payment triggers

A large payment should be calculated relative to the user's spending pattern rather than using only a fixed amount.

Example:

```text
Average transaction = ₹180
Current transaction = ₹2,400
```

The system detects an unusually large payment.

Potential roast:

> **"BSDK FIRSE SOCH LE."**

> **"₹2,400??? Bhai confirm kar le, shaadi toh nahi kar raha?"**

> **"Itna paisa kis confidence mein uda raha hai?"**

> **"Bro saw his balance and chose violence."**

---

## Repeated spending

```text
FOOD_3_TIMES_TODAY
FOOD_5_TIMES_TODAY
SHOPPING_REPEAT
MULTIPLE_PAYMENTS_SHORT_WINDOW
```

Example:

```text
12:10 PM → ₹180 Food
2:40 PM  → ₹240 Food
7:20 PM  → ₹320 Food
11:45 PM → ₹280 Food
```

Roast:

> **"Bhai tu kha raha hai ya Swiggy ko sponsor kar raha hai?"**

---

# 9. Category-Specific Roasts

## Food

> **"Mess mein kya problem hai bhai?"**

> **"Pet full. Bank empty. Classic."**

> **"Again? Bhai digestive system ko bhi semester break de."**

> **"Mess fee bhi di hai btw 💀"**

## Gym

> **"₹800 paid. Attendance loading..."**

> **"Membership active. You? Debatable."**

> **"Bro bought DLC for a body he hasn't used."**

## Laundry

> **"Kapde dhul gaye, paise bhi."**

> **"At least something got washed this week."**

## Shopping

> **"Need tha? Ya dopamine ka monthly recharge?"**

> **"Drip acquired. Budget deceased."**

## Travel

> **"Destination reached. Financial stability did not."**

## Subscription

> **"Another company successfully finessed you."**

---

# 10. Time-Based Roasts

The Roast Engine should also understand time.

## Late night

```text
TIME > 23:00
CATEGORY = FOOD
```

Potential responses:

> **"11:47 PM — academic comeback cancelled."**

> **"Bhai so ja. Swiggy ko bhi sona hai."**

## Extremely late

```text
TIME > 01:00
```

> **"Raat ke 1 baje ₹340 ki biryani. Priorities immaculate."**

---

# 11. Roast Escalation

The system should classify roast intensity.

```text
LEVEL 0
Normal
    ↓
LEVEL 1
Suspicious
    ↓
LEVEL 2
Roast
    ↓
LEVEL 3
Savage
    ↓
LEVEL 4
Critical
```

Example:

```text
₹200
"Reasonable."

₹1,000
"Hmm. Interesting decision."

₹3,000
"Bhai seriously?"

₹5,000
"BSDK FIRSE SOCH LE."

₹0 balance
"CHUD GAYE GURU 💀"
```

---

# 12. Roast Personalization

The Roast Engine should use the user's own historical behavior.

Example:

Last month:

```text
Food = ₹1,800
```

This month:

```text
Food = ₹3,100
```

Roast:

> **"Food spending up 72%. Bro has discovered hunger."**

Another example:

```text
Gym subscription = ₹1,000
Gym visits = 3
```

Roast:

> **"₹333 per workout. Premium membership fr."**

The system should favor **contextual jokes over random jokes**.

---

# 13. Roast Cooldowns

The app should not become annoying.

Each trigger gets a cooldown.

Example:

```text
BALANCE_ZERO
→ maximum once per balance event

FOOD_REPEAT
→ maximum once every 3 hours

BIG_PAYMENT
→ once per qualifying transaction

BUDGET_90
→ once per threshold crossing
```

This prevents:

```text
₹0
"CHUD GAYE GURU"

reload app
"CHUD GAYE GURU"

open expense page
"CHUD GAYE GURU"

notification
"CHUD GAYE GURU"
```

Nobody wants that.

---

# 14. Roast Preferences

Settings:

```text
Roast Mode

[ ON ]

Intensity
○ Light
○ Normal
● Savage

Language
☑ English
☑ Hinglish

Profanity
☑ Allow

Notifications
☑ Roast notifications
☐ Roasts on every transaction
```

Default mode should be **Normal**, with stronger language available as an opt-in setting.

---

# 15. Roast Database

Roasts should be stored separately from application logic.

## ROAST_TEMPLATES

```text
id
trigger_type
category
severity
text
language
is_active
cooldown_seconds
created_at
updated_at
```

Example:

```text
id: 41
trigger: BALANCE_ZERO
severity: CRITICAL
text: "Chud gaye guru 💀"
language: HINGLISH
```

Another:

```text
id: 82
trigger: LARGE_PAYMENT
category: FOOD
severity: SAVAGE
text: "BSDK firse soch le."
language: HINGLISH
```

This allows new jokes to be added without changing backend business logic.

---

# 16. Roast Events

Every displayed roast can optionally be recorded.

## ROAST_EVENTS

```text
id
user_id
trigger_type
expense_id
roast_template_id
context_snapshot
displayed_at
```

This allows ThassaPay to understand:

* which roasts are being shown
* which triggers happen most often
* which jokes repeat
* whether cooldowns are functioning
* which roast categories are most active

Roast analytics must remain separate from financial ledger truth.

---

# 17. Important Architecture Rule

The Roast Engine is **downstream of financial events**.

Correct:

```text
Payment
   ↓
Payment State Machine
   ↓
Expense Ledger
   ↓
Analytics
   ↓
Roast Engine
```

Incorrect:

```text
Payment
   ↓
Roast Engine
   ↓
"Funny response"
   ↓
Payment status
```

The roast engine must never be able to:

* approve a payment
* reject a payment
* mark payment success
* modify an expense
* modify balance
* modify transaction status

---

# 18. Expense Tracking UI

Instead of a traditional finance-app interface:

### Financial Damage

```text
SEPTEMBER

₹7,240
TOTAL DAMAGE

₹2,760
STILL ALIVE
```

Categories:

```text
🍔 Food          ₹2,840
🛍️ Shopping      ₹1,420
🏋️ Gym             ₹800
🚕 Travel           ₹620
🧺 Laundry          ₹410
```

Example transaction:

```text
₹349
Food
Swiggy
11:48 PM

"Could've eaten at mess btw."
```

---

# 19. Monthly Post-Mortem

Rename the monthly report:

## THE POST-MORTEM

```text
September

Allowance       ₹10,000
Total Damage     ₹9,740
Remaining          ₹260

TOP CRIME
Food — ₹3,120

MOST SUSPICIOUS
₹2,499 at 1:26 AM

MOST REPEATED
Food × 27

WALLET STATUS
"₹260 left. Welcome to hard mode."
```

---

# 20. Special Easter Eggs

Rare event-driven easter eggs:

```text
₹0.00
→ "CHUD GAYE GURU."

₹69
→ "Nice."

₹420
→ "No comment."

₹666
→ "Bro summoned something."

1 rupee transaction
→ "Financial discipline final boss."

69th transaction
→ "Nice."

420th transaction
→ "We need to talk."

5 payments in 10 minutes
→ "Bro is conducting economic activity."

Payment at 3:33 AM
→ "Brother what are we doing."
```

These should be low-frequency and never interfere with real finance information.

---

# 21. Authentication

```text
Google OAuth
      ↓
College-domain verification
      ↓
Access Token
      ↓
Refresh Token
      ↓
ThassaPay API
```

Refresh tokens should rotate.

Users should only be able to access their own financial records.

---

# 22. Security

```text
Mobile App
    │
    │ HTTPS
    ▼
API
    │
    ├── Authentication
    ├── Authorization
    ├── Validation
    ├── Rate Limiting
    └── Payment-specific rate limiting
            │
            ▼
       Application
            │
            ▼
       PostgreSQL
```

Requirements:

* no UPI PIN storage
* no bank-password storage
* no secrets committed to Git
* encrypted sensitive fields where appropriate
* RBAC for admin
* immutable payment/audit history
* structured logs
* error tracking
* rate limiting
* staging environment
* database migrations through CI/CD

---

# 23. Operational Architecture

```text
                     GitHub
                        │
                        ▼
                     CI/CD
                  ┌─────┴─────┐
                  ▼           ▼
              Staging      Production
                  │           │
                  ▼           ▼
             Test DB       Prod DB
```

Supporting infrastructure:

```text
Sentry
  ↓
Error Tracking

JSON Logs
  ↓
Application Monitoring

Redis + BullMQ
  ↓
Reconciliation Jobs
Roast Cooldowns
Scheduled Tasks
Notifications
```

Metrics should include:

```text
payment_success_rate
payment_failure_rate
needs_review_count
payment_latency
api_error_rate
roast_trigger_count
```

The `NEEDS_REVIEW` queue is particularly important because a sudden increase can indicate a problem in the payment flow.

---

# 24. API Structure

```text
/auth
    POST /login
    POST /refresh
    POST /logout

/users
    GET /me
    PATCH /me

/expenses
    GET /
    POST /
    GET /:id
    PATCH /:id
    POST /:id/correct

/budgets
    GET /current
    POST /
    PATCH /:id

/categories
    GET /

/payments
    POST /create
    GET /:id
    POST /:id/review

/analytics
    GET /summary
    GET /categories
    GET /trend

/roasts
    GET /current
    GET /history
    PATCH /settings

/admin
    GET /users
    GET /audit-logs
    GET /payments
```

---

# 25. Project Structure

```text
thassapay/
│
├── apps/
│   │
│   ├── mobile/
│   │   ├── app/
│   │   │   ├── login/
│   │   │   ├── dashboard/
│   │   │   ├── expenses/
│   │   │   ├── pay/
│   │   │   ├── budgets/
│   │   │   ├── analytics/
│   │   │   ├── roast/
│   │   │   └── settings/
│   │   │
│   │   ├── components/
│   │   ├── services/
│   │   ├── store/
│   │   └── utils/
│   │
│   └── api/
│       ├── src/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── expenses/
│       │   ├── budgets/
│       │   ├── categories/
│       │   ├── payments/
│       │   ├── analytics/
│       │   ├── notifications/
│       │   ├── roast/
│       │   ├── admin/
│       │   └── common/
│       │
│       ├── prisma/
│       └── package.json
│
├── packages/
│   ├── money/
│   ├── types/
│   └── validation/
│
└── README.md
```

---

# 26. MVP Scope

## V1 — College Project + Real Users

```text
✅ Google OAuth
✅ College-domain restriction
✅ Manual expenses
✅ Categories
✅ Monthly budget
✅ UPI Intent
✅ Payment state machine
✅ Idempotent payment creation
✅ NEEDS_REVIEW flow
✅ Payment events
✅ Basic analytics
✅ Audit logging
✅ Roast Engine
✅ Roast settings
✅ Contextual roasts
```

## V2

```text
✅ PSP / aggregator integration
✅ Authoritative payment status
✅ Receipt uploads
✅ Recurring expenses
✅ CSV/PDF export
✅ Push notifications
✅ More advanced roast personalization
✅ QR payment flow
```

## V3

```text
✅ Merchant integrations
✅ Mess integration
✅ Laundry integration
✅ Campus marketplace
✅ Admin dashboard
✅ Full RBAC
✅ Advanced analytics
✅ Social/shared expense features
```

---

# 27. Final Product Identity

ThassaPay is not:

> "Another expense tracker."

It is:

> **A hostel-first money app that lets students pay through UPI, track every rupee, understand where their money went, and get absolutely roasted for their financial decisions.**

The core loop is:

```text
           PAY
            ↓
       RECORD MONEY
            ↓
        ANALYZE IT
            ↓
       REALIZE THE DAMAGE
            ↓
          GET ROASTED
            ↓
      TRY TO DO BETTER
            ↓
          PAY AGAIN 💀
```

### ThassaPay's personality:

**Finance app on the surface.
Hostel friend underneath.**
