# ThassaPay — Architecture

> **Identity**: *Track your money. Pay through UPI. Understand the damage. Get roasted for your financial decisions.*

## Overview

ThassaPay is a hostel-first personal finance and UPI payment-initiation application for college students. It is a **modular monolith** — one backend process with clearly separated modules. It is explicitly **not** a bank, wallet, investment platform, or payment custodian.

---

## Monorepo Layout

```
thassapay/
│
├── apps/
│   ├── api/          NestJS backend (modular monolith)
│   └── mobile/       React Native + Expo
│
├── packages/
│   ├── money/        Shared Money value object (BigInt paise)
│   ├── types/        Shared TypeScript interfaces & enums
│   └── validation/   Shared validators & regex patterns
│
├── docs/             This documentation
├── .github/          CI/CD workflows
└── README.md
```

The monorepo is managed with **npm workspaces** (Node 24, npm 11). No build orchestrator (Turborepo, Nx) is used in V1 — simple `npm run --workspace` commands are sufficient.

---

## Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 24.x (LTS) | Targets `node:20-slim` in Docker for production stability |
| Backend framework | NestJS | ^10.4 | Modular monolith |
| ORM | Prisma | ^5.20 | Migrations in CI, never hand-run against prod |
| Database | PostgreSQL | 16 | Managed (Railway / Render) |
| Cache / queue | Redis + BullMQ | ioredis ^5 | Reconciliation sweep, rate limiting |
| Mobile | React Native + Expo | SDK 51+ | Managed workflow |
| Language | TypeScript | ^5.6 | Strict mode, ES2021 target |
| Auth | Google OAuth 2.0 + JWT | @nestjs/jwt ^10 | 15-min access tokens + rotated refresh tokens |
| Logging | Structured JSON (pino) | - | From day one, not added later |
| Errors | Sentry | - | Backend + mobile RN |
| Secrets | Doppler / cloud secrets manager | - | Never committed .env |
| Deployment | Railway / Render | - | Separate staging environment |

---

## Backend Module Map

```
apps/api/src/
│
├── main.ts                      Bootstrap: Helmet, CORS, ValidationPipe, /api prefix
├── app.module.ts                Root module — imports all feature modules
│
├── common/
│   ├── prisma.service.ts        Singleton PrismaClient
│   ├── guards/
│   │   ├── jwt-auth.guard.ts    Bearer token verification
│   │   └── payment-rate-limit.guard.ts  Per-user Redis rate limiter
│   └── decorators/
│       └── current-user.decorator.ts
│
├── auth/                        Google OAuth, token issuance, refresh rotation
├── categories/                  Default + custom expense categories
├── budgets/                     Monthly budget CRUD + budget status
├── expenses/                    Manual expense CRUD, soft-delete, corrections
├── payments/                    UPI payment attempt state machine (core)
│   ├── payment-state-machine.ts  The transition guard: INITIATED→SUCCESS is illegal
│   ├── payments.service.ts
│   ├── payments.controller.ts
│   └── reconciliation.job.ts    Cron: AWAITING_CONFIRMATION → NEEDS_REVIEW after 10 min
└── analytics/                   Spend summaries, projections, roast engine
    └── roast.engine.ts           Pure function — no DB access, no side effects
```

---

## Database Schema Design Decisions

| Decision | Rationale |
|---|---|
| `amountPaise BigInt` everywhere | Eliminates float rounding. ₹0.1 + ₹0.2 = ₹0.30 exactly |
| `payment_events` append-only table | Full audit trail of every state transition |
| `PaymentAttempt` != `Expense` | An attempt is not an expense until SUCCESS. Separate models, separate writes |
| `correctedFromId` on `Expense` | Corrections are new rows, not edits |
| `deletedAt` soft-deletes | Financial records are never hard-deleted |
| `collegeId` on `User` from day one | Multi-tenant scoping; painful to retrofit on a live money table |
| `idempotencyKey` on `PaymentAttempt` | Unique index; duplicate POST retries return existing row |
| `audit_logs` table | Immutable at DB-role level (INSERT/SELECT only; no UPDATE/DELETE grants) |

---

## Payment State Machine

```
INITIATED ──(UPI app opened)──► AWAITING_CONFIRMATION
                                        │
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
          SUCCESS                   FAILED              (sweep timeout, 10 min)
              │                         │                          ▼
     expense created           expense NOT created           NEEDS_REVIEW
                                                                   │
                                                       ┌───────────┴───────────┐
                                                       ▼                       ▼
                                                   SUCCESS                  FAILED
```

**Rule**: `INITIATED → SUCCESS` is an **illegal transition**. It is rejected by `assertValidTransition()`. A client can never directly claim a payment succeeded. Only user confirmation (or a future PSP webhook) produces SUCCESS.

---

## Security Model

| Concern | Implementation |
|---|---|
| Auth tokens | 15-min JWT access + 7-day refresh; refresh is hashed before storage; rotated on every use |
| Payment rate limiting | Per-user Redis counter: max 10 attempts / 60 seconds |
| Input validation | ValidationPipe with whitelist + forbidNonWhitelisted on all endpoints |
| HTTP headers | helmet() middleware |
| CORS | Allowlist from ALLOWED_ORIGINS env var |
| Audit trail | Immutable audit_logs and payment_events tables |
| Secrets | Secrets manager — never .env committed or dashboard history |
| DB grants | App role: no UPDATE/DELETE on payment_events, audit_logs |
| Data law | DPDP Act 2023: consent capture, export endpoint, deletion flow (Phase 3) |

---

## Shared Packages

### packages/money

The **only** place currency math happens in the entire codebase.

```typescript
Money.fromRupees('250.50')    // parses user input → BigInt paise
Money.fromPaise(25050n)       // wraps raw DB value
money.add(other)              // BigInt arithmetic, no float involved
money.toDisplayString()       // '₹250.50' — for UI only
money.toPaise()               // BigInt — for DB writes
```

### packages/types

Shared enums and interfaces mirroring Prisma enums, API response shapes, CurrentUserPayload.

### packages/validation

Shared regex constants: UPI_VPA_REGEX, RUPEE_AMOUNT_REGEX, MONTH_FORMAT_REGEX.

---

## What ThassaPay Is NOT

- Not a bank or wallet
- Not a payment custodian (never holds funds)
- Not a TPAP under NPCI
- Not a financial adviser
- Not a P2P transfer platform
- Not an investment platform

Adding any of those features requires a separate compliance review before code is written.
