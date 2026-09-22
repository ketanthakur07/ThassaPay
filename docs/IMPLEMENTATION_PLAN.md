# ThassaPay — Implementation Plan

## Status Snapshot (as of Phase 0 Audit)

### Runtime Environment
| Tool | Installed Version |
|---|---|
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| Git | 2.51.0 |
| Expo CLI (global, legacy) | 6.3.12 (deprecated — use `npx expo` instead) |
| eas-cli (global) | 24.0.0 |

### What Exists in the Repository
| Item | Location | Status |
|---|---|---|
| Architecture spec (v2) | `thassapay-architecture-v2.md` | Complete |
| Backend scaffold (zip) | `thassapay-backend.zip` | Extracted → `apps/api/` |
| Monorepo root | `/` | Created (Phase 1) |
| docs/ | `/docs/` | Created (Phase 0) |

### What the Backend Scaffold Contains
| Component | File | Status |
|---|---|---|
| Prisma schema | `apps/api/prisma/schema.prisma` | Complete — all models, BigInt paise, audit tables |
| Money value object | `apps/api/src/common/money/money.ts` | Complete |
| Payment state machine | `apps/api/src/payments/payment-state-machine.ts` | Complete |
| Payments service | `apps/api/src/payments/payments.service.ts` | Complete |
| Payments controller | `apps/api/src/payments/payments.controller.ts` | Complete (needs GET endpoints) |
| Reconciliation job | `apps/api/src/payments/reconciliation.job.ts` | Complete |
| JWT auth guard | `apps/api/src/common/guards/jwt-auth.guard.ts` | Complete |
| Payment rate limit guard | `apps/api/src/common/guards/payment-rate-limit.guard.ts` | Complete |
| Prisma service | `apps/api/src/common/prisma.service.ts` | Complete |
| App bootstrap | `apps/api/src/main.ts` | Complete |
| App module | `apps/api/src/app.module.ts` | Stub — modules commented out |
| Auth module | (not created) | Stubbed only |
| Expenses module | (not created) | Stubbed only |
| Budgets module | (not created) | Stubbed only |
| Categories module | (not created) | Stubbed only |
| Analytics module | (not created) | Stubbed only |
| Roast Engine | (not created) | Not started |
| Mobile app | (not created) | Not started |
| Unit tests | `apps/api/test/` | Money + state machine |

---

## Phases

### Phase 0 — Repository Audit ✅ COMPLETE

**Output**: This file, plus:
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/SECURITY.md`
- `docs/PAYMENTS.md`
- `docs/ROAST_ENGINE.md`
- `docs/IMPLEMENTATION_PLAN.md` (this file)

---

### Phase 1 — Monorepo Foundation ✅ COMPLETE

**Goal**: A working monorepo with correct workspace wiring, shared packages extracted, backend scaffold in place, and mobile scaffold initialized. No new feature code yet.

#### 1.1 — Root package.json with npm workspaces

```json
{
  "name": "thassapay",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

#### 1.2 — packages/money

Extract the `Money` class into a standalone shared package `@thassapay/money`.

```
packages/money/
├── src/
│   └── money.ts    (moved from apps/api/src/common/money/)
├── package.json    (name: "@thassapay/money")
├── tsconfig.json
└── README.md
```

The `apps/api` backend references `@thassapay/money` via workspace path resolution. The mobile app imports the same class for display formatting only.

#### 1.3 — packages/types

Shared TypeScript types used by both API and mobile:

```
packages/types/
├── src/
│   ├── payment.ts       PaymentStatus, PaymentMethod, ExpenseSource enums
│   ├── user.ts          CurrentUserPayload
│   └── api.ts           API response shapes (PaymentAttemptResponse, ExpenseResponse, etc.)
├── package.json    (name: "@thassapay/types")
└── tsconfig.json
```

#### 1.4 — packages/validation

Shared regex constants and validator utilities:

```
packages/validation/
├── src/
│   ├── patterns.ts      UPI_VPA_REGEX, RUPEE_AMOUNT_REGEX, MONTH_FORMAT_REGEX
│   └── index.ts
├── package.json    (name: "@thassapay/validation")
└── tsconfig.json
```

#### 1.5 — apps/api cleanup

- Update `apps/api/package.json` to depend on `@thassapay/money`, `@thassapay/types`, `@thassapay/validation`
- Update imports throughout (state machine, service, DTOs) to use shared packages
- Add `eslint`, `prettier`, `typecheck` scripts
- Add `.env.example` (already present, verify correct)

#### 1.6 — apps/mobile scaffold

Initialize a new Expo managed workflow app:

```bash
npx create-expo-app@latest apps/mobile --template blank-typescript
```

Then add:
- `expo-auth-session` (Google OAuth)
- `expo-linking` (UPI deep link)
- `@tanstack/react-query` (server state)
- `zustand` (local UI state)
- `expo-router` (file-based routing)

Configure to depend on `@thassapay/types` and `@thassapay/money`.

#### 1.7 — Root config files

```
/.eslintrc.js         Base ESLint config, extended by each workspace
/.prettierrc          Prettier config (shared)
/.gitignore           node_modules, dist, .env, .expo, *.local
/docker-compose.yml   PostgreSQL + Redis for local dev
/README.md            Project overview + quick-start
```

#### 1.8 — GitHub Actions

```
.github/workflows/
├── ci.yml            On PR: lint, typecheck, test all workspaces
└── migrate.yml       On merge to main: run prisma migrate deploy against staging
```

#### Phase 1 Verification

```bash
npm install                              # installs all workspaces
npm run build --workspace=packages/money # builds shared money package
npm run test --workspace=packages/money  # Money + state machine tests pass
npm run typecheck --workspaces           # zero TypeScript errors across all packages
npm run lint --workspaces                # zero lint errors
```

---

### Phase 2 — Backend: All V1 Modules ✅ COMPLETE

**Goal**: A fully functional NestJS backend with all V1 endpoints implemented, tested, and runnable locally against PostgreSQL + Redis.

#### 2.1 — Auth Module

```
apps/api/src/auth/
├── auth.module.ts
├── auth.service.ts       Google token validation, user creation, JWT issuance
├── auth.controller.ts    POST /auth/google, POST /auth/refresh, POST /auth/logout
└── dto/
    └── google-auth.dto.ts
```

Key behaviors:
- Validates Google ID token via Google JWKS
- Restricts signup to `ALLOWED_COLLEGE_DOMAIN`
- Issues 15-min access JWT + 7-day refresh token (bcrypt-hashed before storage)
- Refresh rotation: old hash invalidated on every `/auth/refresh` call

#### 2.2 — Categories Module

```
apps/api/src/categories/
├── categories.module.ts
├── categories.service.ts
├── categories.controller.ts    GET /categories
└── dto/category.dto.ts
```

Default categories seeded via `prisma/seed.ts`: Food, Travel, Laundry, Shopping, Snacks, Entertainment, Other.

#### 2.3 — Budgets Module

```
apps/api/src/budgets/
├── budgets.module.ts
├── budgets.service.ts
├── budgets.controller.ts       PUT /budgets/:month, GET /budgets/:month
└── dto/set-budget.dto.ts
```

`GET /budgets/:month` returns `budgetPaise`, `spentPaise`, `remainingPaise`, `percentUsed`.

#### 2.4 — Expenses Module

```
apps/api/src/expenses/
├── expenses.module.ts
├── expenses.service.ts
├── expenses.controller.ts
│   GET    /expenses?month=2026-09&category=uuid&page=1&limit=20
│   POST   /expenses
│   DELETE /expenses/:id          (soft delete)
│   POST   /expenses/:id/correct  (correction row)
└── dto/
    ├── create-expense.dto.ts
    └── expense-response.dto.ts
```

All writes emit to `audit_logs`. Idempotency key required on creation.

#### 2.5 — Payments Module additions

Add to existing `payments.controller.ts`:
- `GET /payments` (with `?status=NEEDS_REVIEW` filter)
- `GET /payments/:id` (with event history)

Serialize `amountPaise` (BigInt) → `amountDisplay` (string) in response DTOs — raw BigInt must never reach JSON serialization.

#### 2.6 — Analytics Module

```
apps/api/src/analytics/
├── analytics.module.ts
├── analytics.service.ts
├── analytics.controller.ts
│   GET /analytics/summary?month=2026-09
│   GET /analytics/roast?month=2026-09
└── roast.engine.ts              Pure function, no DB
```

`GET /analytics/summary` returns:
- `totalSpent`, `budgetAmount`, `remaining`, `percentUsed`
- Per-category breakdown
- Daily spend array (for chart)
- Projected month-end spend (linear: `spent / daysElapsed * totalDays`)

`GET /analytics/roast` calls `roast(summary, user.roastMode)` — pure function, no extra DB calls.

#### 2.7 — Prisma seed

```
apps/api/prisma/seed.ts
```

Seeds:
- 7 default categories
- 1 test college (`vitap.ac.in`) for local dev

```bash
npm run --workspace=apps/api prisma:seed
```

#### Phase 2 Verification

```bash
npm run --workspace=apps/api prisma:migrate
npm run --workspace=apps/api prisma:seed
npm run --workspace=apps/api start:dev

# Manual endpoint tests via curl or Postman
POST /api/v1/auth/google
PUT  /api/v1/budgets/2026-09
POST /api/v1/expenses
GET  /api/v1/analytics/summary?month=2026-09
GET  /api/v1/analytics/roast?month=2026-09

# Full payment flow
POST /api/v1/payments           → INITIATED
POST /api/v1/payments/:id/return → AWAITING_CONFIRMATION
# Wait for reconciliation sweep or trigger manually
POST /api/v1/payments/:id/confirm { didSucceed: true }  → SUCCESS + expense created
GET  /api/v1/expenses           → expense appears

npm run --workspace=apps/api test   # all tests pass
```

---

### Phase 3 — Mobile App: All V1 Screens ✅ COMPLETE

**Goal**: React Native + Expo app with all V1 screens, connected to the Phase 2 backend, UPI handoff working.

#### Screens

| Screen | Route | Notes |
|---|---|---|
| Login | `/login` | Google Sign-In, college domain check |
| Onboarding | `/onboarding` | Name, hostel block/room, monthly budget |
| Dashboard | `/(tabs)/` | Budget ring, spent/remaining, recent expenses |
| Add Expense | `/expense/new` | Amount, category picker, description |
| Pay via UPI | `/pay` | Amount, UPI ID, payee name |
| Payment Pending | `/pay/[id]/pending` | Waiting state + "Did it go through?" |
| Expense Ledger | `/(tabs)/ledger` | Paginated, filterable |
| Analytics | `/(tabs)/analytics` | Charts by category + daily spend |
| Roast | `/(tabs)/roast` | Roast card + context |
| Settings | `/settings` | Roast mode selector, profile |

#### Tech choices
- **Navigation**: Expo Router v3 (file-based)
- **Server state**: TanStack Query v5
- **Local state**: Zustand v4
- **Fonts**: Space Grotesk (headings) + Inter (body)
- **Charts**: `victory-native` or `react-native-gifted-charts`
- **UPI**: `expo-linking` constructs `upi://` deep link

#### Phase 3 Verification

Full end-to-end flow tested on:
- Android emulator (UPI intent opens UPI app simulator)
- Physical Android device (real UPI intent → test payment to self)
- iOS simulator (UPI intent not supported — graceful fallback shown)

---

### Phase 4 — Polish & Pre-Launch

- FCM push notifications (wire into reconciliation job TODO)
- PSP/aggregator integration (Razorpay/Cashfree) for authoritative status
- Receipt photo upload (Expo Image Picker → R2/S3)
- CSV/PDF export endpoint
- DPDP Act 2023: consent screen, data export, account deletion
- Sentry (backend + mobile RN)
- Staging environment on Railway with isolated DB
- DB-role grants verified (no UPDATE/DELETE on payment_events, audit_logs)

---

## Risk Register

| Risk | Severity | Status | Mitigation |
|---|---|---|---|
| UPI intent returns unreliable | HIGH | MITIGATED | State machine + reconciliation sweep already implemented |
| Float rounding in money | HIGH | MITIGATED | BigInt paise + Money class already implemented |
| Duplicate payment attempts | HIGH | MITIGATED | Idempotency key already implemented |
| BigInt JSON serialization | MEDIUM | OPEN | All response DTOs must convert paise → display string |
| Compromised account spamming payments | MEDIUM | MITIGATED | Per-user Redis rate limit already implemented |
| Legacy expo-cli (global) | LOW | OPEN | Use `npx expo` (local) — global expo-cli is deprecated |
| No CI/CD yet | MEDIUM | OPEN | GitHub Actions planned in Phase 1.8 |
| No Sentry yet | MEDIUM | OPEN | Phase 4 — before real users |
| No staging environment | MEDIUM | OPEN | Phase 4 — before real users |
| Roast Engine accessing financial state | HIGH | OPEN | Must be verified in every code review |
