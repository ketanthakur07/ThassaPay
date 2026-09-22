# ThassaPay — Architecture v2 (Real-Money Revision)

The original doc had the right instincts (payment ≠ expense, UPI isolated behind an
adapter). What it was missing is everything that only bites you once real money and
real users show up. This version fixes those gaps and is what the code scaffold is
built from.

## 1. The core problem the original design ignored

**UPI Intent has no reliable "it actually succeeded" signal for a third-party app.**
You launch Google Pay/PhonePe via intent, the user does whatever they do, and the app
returns control to you with... whatever that app feels like returning. It can be
absent, delayed, or simply wrong (user backgrounds the app mid-flow, OS kills your
activity, etc.). The original doc's status enum (`SUCCESS/FAILED/CANCELLED/UNKNOWN`)
was honest about this but didn't design *around* it. A real system needs:

- A payment state machine with explicit transitions and a background reconciler
- A hard rule: **the backend never trusts client-reported success alone**
- A path for the user to manually confirm/dispute an `UNKNOWN` payment
- Eventually, a real PSP/aggregator (Razorpay, Cashfree, PhonePe PG, etc.) if you want
  authoritative webhook-based confirmation instead of "app came back to foreground"

This isn't a nice-to-have — it's the single biggest correctness risk in the whole app.
Get this wrong and users see expenses that didn't happen, or don't see ones that did.

## 2. Payment state machine (replaces the flat enum)

```
INITIATED ──(user opens UPI app)──> AWAITING_CONFIRMATION
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
                SUCCESS               FAILED              (timeout, 10 min)
                    │                     │                     ▼
                    ▼                     ▼                 NEEDS_REVIEW
             expense created      expense NOT created            │
                                                          user confirms/denies
                                                                  │
                                                        ┌─────────┴─────────┐
                                                        ▼                   ▼
                                                    SUCCESS              FAILED
```

Rules:
- Only `SUCCESS` creates/finalizes an `Expense`. Nothing else does, ever.
- A scheduled job sweeps `AWAITING_CONFIRMATION` rows older than N minutes into
  `NEEDS_REVIEW` and pushes a notification: *"Did the ₹250 payment to canteen@upi go
  through?"* with Yes/No, which the user answers once.
- Every state transition is written to an **append-only `payment_events` table** (not
  just overwriting a `status` column) so you can reconstruct what happened, which
  matters the moment a user disputes something.

## 3. Idempotency (missing entirely from v1)

Mobile networks drop requests. Users double-tap "Pay". Without an idempotency key,
`POST /payments/create` retried by the client (intentionally or by a flaky network)
creates two payment attempts for one intended payment.

- Client generates a UUID per payment attempt and sends it as `Idempotency-Key`.
- Backend stores it as a unique column on `payment_attempts`. A retry with the same
  key returns the existing row instead of creating a new one.
- Same pattern applies to expense creation from any client-driven action.

## 4. Money as integers, not floats/decimals-in-app-code

`amount` as a JS number anywhere near money is a bug waiting to happen (₹0.1 + ₹0.2
problems, rounding drift in analytics aggregation). Fix:
- Store money as **`BigInt` paise** in Postgres (`amount_paise bigint`), never rupees-as-float.
- A single `Money` value object in `common/money` is the only place that formats
  paise → ₹ for display, and the only place that parses user input → paise. Nothing
  else touches currency math directly.

## 5. Schema fixes

Problems in v1's schema and the fix:

| v1 issue | Fix |
|---|---|
| `category_id` duplicated on both `expenses` and `payment_attempts` — can drift | Category lives only on `expenses`. A `payment_attempt` doesn't need a category; the expense it produces does. |
| No idempotency key column | Added, unique, indexed. |
| `status` as a bare string with no history | Kept as current-state column *plus* an append-only `payment_events` table. |
| No audit trail for money-relevant admin actions | `audit_logs` table, immutable (no UPDATE/DELETE grants at the DB role level). |
| No tenant/college scoping at the schema level | `college_id` on `users` from day one — retrofitting tenant scoping later means a painful backfill + migration on a live money table. |
| Floats implied for `amount` | `BigInt` paise everywhere. |
| No soft-delete / correction path for expenses | `expenses.deleted_at`, `expenses.corrected_from_id` — money records should never hard-delete; corrections are new rows referencing the original. |

## 6. Security additions v1 didn't cover

- **Refresh token rotation**, not just a long-lived JWT — a stolen token shouldn't be
  a forever-key into someone's financial history.
- **Per-user rate limiting** on payment creation specifically (not just a global rate
  limiter) — a compromised account shouldn't be able to hammer the payment endpoint.
- **Field-level encryption** for anything beyond what's needed operationally — UPI IDs
  and payee details are still sensitive; encrypt at rest, not just "the disk is
  encrypted."
- **DPDP Act 2023 (India)** compliance basics: explicit consent capture for data use,
  a data export endpoint, a data deletion endpoint (account closure ≠ silent orphaned
  rows — needs a real retention/deletion policy for financial records vs. account PII).
- **Secrets** out of `.env` committed anywhere — a real secrets manager (Doppler,
  AWS/GCP secrets manager, even Railway's/Render's built-in secret store) from day one,
  because retrofitting this after a leak is how breaches happen.
- Admin module gets **RBAC**, not "is logged in" — v1 listed an admin module with no
  access-control model at all.

## 7. Regulatory framing (v1 mentioned NPCI but didn't draw the actual line)

- As long as ThassaPay **never holds, custodies, or moves funds itself** — it only
  *initiates* a UPI Intent that hands off to the user's own UPI app and bank — it stays
  out of PPI (Prepaid Payment Instrument) and TPAP licensing territory. This is a load-bearing
  constraint on the product, not a footnote: **don't add wallet balance, hold funds,
  or peer-to-peer transfer features** without re-evaluating this, because that's the
  line into "you're now a regulated payment entity."
- If you later move to a PSP/aggregator, you're doing "merchant-side" integration
  (a bank/aggregator acquires the payment on your behalf), not becoming a TPAP
  yourself — different and much lighter compliance lift.

## 8. Operational maturity v1 skipped entirely

- **Structured logging + error tracking** (Sentry or similar) from the first deploy,
  not added later. Payment bugs reported by students three weeks after the fact are
  unfindable without logs.
- **Migrations pipeline**: Prisma migrate in CI, never hand-run against prod.
- **Staging environment** with its own database before "real app, real users" — a
  payment bug tested only in prod is a bug a student's ₹500 finds for you.
- **Metrics/alerting**: alert on payment failure-rate spikes and on `NEEDS_REVIEW`
  queue depth growing — that queue is your canary for "the UPI intent flow started
  behaving differently."

## 9. Revised MVP scope

Same spirit as v1's staged rollout, adjusted for the above:

**V1 (college project → real users)**
- Google OAuth (college-domain restricted)
- Manual expenses, categories, monthly budget
- UPI Intent payment flow **with the state machine + reconciliation sweep above**
- Idempotent payment creation
- Basic analytics (spend by category, budget remaining)
- Audit log for payment state transitions

**V2**
- PSP/aggregator integration for authoritative status (removes most of the
  `NEEDS_REVIEW` cases)
- Receipt upload, recurring expenses, CSV/PDF export
- Push notifications via FCM

**V3**
- Merchant/mess integrations, admin dashboard with proper RBAC, campus marketplace

## 10. Stack (unchanged where v1 was right, tightened where it wasn't)

| Layer | Choice | Note |
|---|---|---|
| Mobile | React Native + Expo | unchanged |
| Backend | NestJS + TypeScript | unchanged |
| ORM | Prisma | unchanged, but money columns as `BigInt` |
| DB | PostgreSQL | + a `payment_events` audit table, immutable at DB-role level |
| Cache/queue | Redis | also backs the reconciliation sweep job (BullMQ) |
| Auth | Google OAuth + JWT w/ refresh rotation | rotation added |
| Secrets | Doppler / cloud secrets manager | new — not in v1 |
| Errors/logs | Sentry + structured JSON logs | new — not in v1 |
| Deployment | Railway/Render + managed Postgres, **separate staging** | staging added |
