# ThassaPay backend — scaffold

This is not a finished app. It's a scaffold that fully implements the one part of
the original design that was actually dangerous to get wrong — **the UPI payment
state machine and its reconciliation loop** — plus the plumbing (money handling,
idempotency, auth guard, rate limiting) that the rest of the app depends on.

Read `../thassapay-architecture-v2.md` first — it explains *why* each of these
exists, not just what they do.

## What's actually implemented here

- `prisma/schema.prisma` — full data model, money as `BigInt` paise, append-only
  `payment_events` audit trail, soft-deletes on financial records.
- `src/common/money/money.ts` — the only place currency math happens.
- `src/payments/payment-state-machine.ts` — explicit allowed transitions.
  **`INITIATED -> SUCCESS` is not a legal transition** — that's the whole point.
- `src/payments/payments.service.ts` — idempotent attempt creation, state
  transitions, expense finalization on (and only on) `SUCCESS`.
- `src/payments/reconciliation.job.ts` — the sweep that moves stale
  `AWAITING_CONFIRMATION` attempts to `NEEDS_REVIEW` on a cron.
- `src/common/guards/` — JWT auth guard + a **per-user** payment rate limiter.
- Tests for the state machine and the `Money` class — these two are where a bug
  costs someone real rupees, so they're the two things with tests in the scaffold.

## What's deliberately stubbed / not built yet

- `auth`, `expenses`, `budgets`, `categories`, `analytics` modules — listed as
  commented-out imports in `app.module.ts` to show the intended boundary, but not
  implemented. Each should mirror `payments/`: its own controller, service, DTOs.
- Google OAuth flow itself (`auth.service.ts`) — wire up `passport-google-oauth20`
  or Google's own SDK, restrict signup to `ALLOWED_COLLEGE_DOMAIN`, issue the
  15-min access token + rotated refresh token pair.
- Notification delivery (FCM) — the reconciliation job has a `TODO` where it
  should call it.
- The PSP/aggregator adapter for V2 — `payment-state-machine.ts` and
  `payments.service.ts` are written so that swapping "client-reported return" for
  "PSP webhook" only touches `reportReturn()`, not the state machine itself.

## Before this touches real money

1. Wire the Postgres role used by the app to have **no UPDATE/DELETE grant** on
   `payment_events` and `audit_logs` at the database level, not just app-level
   convention.
2. Put `.env` secrets in an actual secrets manager before first deploy — see the
   comment at the top of `.env.example`.
3. Stand up a staging environment with its own database and run the full UPI
   Intent flow against it manually — UPI intent behavior differs across Google
   Pay/PhonePe/Paytm and you want to know that before a student does.
4. Add Sentry (or similar) before, not after, the first real payment.

## Running locally

```bash
cp .env.example .env   # fill in DATABASE_URL, REDIS_URL, JWT secrets
npm install
npx prisma migrate dev
npm run start:dev
npm test
```
