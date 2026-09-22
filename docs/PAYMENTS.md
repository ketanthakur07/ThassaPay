# ThassaPay — Payments

## Regulatory Framing

ThassaPay initiates UPI payments by handing off to the user's existing UPI app (Google Pay, PhonePe, Paytm, etc.) via a deep link. It does **not**:

- Hold, custody, or move funds
- Maintain an internal wallet balance
- Issue prepaid instruments
- Act as a Transaction Processing Application Provider (TPAP) under NPCI

As long as these constraints hold, ThassaPay stays out of PPI (Prepaid Payment Instrument) and TPAP licensing territory.

**Adding any of the following requires a separate compliance review before code is written:**
- Peer-to-peer transfers
- Wallet or stored-value balance
- Merchant settlement
- Lending or credit

---

## Payment Attempt vs. Expense

These are two distinct database records. Understanding the distinction is the most important thing in this codebase.

| Concept | Table | Created when | Links to |
|---|---|---|---|
| `PaymentAttempt` | `payment_attempts` | User initiates a UPI payment | `payment_events` (audit trail) |
| `Expense` | `expenses` | Payment reaches `SUCCESS` state | `payment_attempt` (optional, only for UPI source) |

**A PaymentAttempt that never reaches SUCCESS never creates an Expense.**

If a payment is INITIATED but the user backgrounds the app and never confirms — there is no expense. The attempt sits in AWAITING_CONFIRMATION, gets swept to NEEDS_REVIEW after 10 minutes, and the user is asked once: "Did this go through?" Their answer resolves it.

---

## Payment State Machine

```
                    ┌──────────────────────────────────────────────────────┐
                    │                                                      │
  [client POST]     │    [client POST /return]                             │
  /payments ────► INITIATED ──────────────────► AWAITING_CONFIRMATION      │
                                                        │                  │
                                    ┌───────────────────┼────────────────┐ │
                                    │                   │                │ │
                                    ▼                   ▼                ▼ │
                                 FAILED             SUCCESS     (10 min timeout)
                                    │                   │                │ │
                              no expense          expense             NEEDS_REVIEW
                                                 created                  │
                                                                  [user confirms]
                                                               ┌──────────┴──────────┐
                                                               ▼                     ▼
                                                           SUCCESS               FAILED
                                                        expense created       no expense
```

### States

| State | Meaning |
|---|---|
| `INITIATED` | Attempt created, UPI deep link about to be opened |
| `AWAITING_CONFIRMATION` | App returned from UPI app; awaiting authoritative confirmation |
| `SUCCESS` | Payment confirmed; expense record created |
| `FAILED` | Payment definitively failed; no expense |
| `CANCELLED` | User cancelled in UPI app; no expense |
| `NEEDS_REVIEW` | Timed out waiting for confirmation; user must respond |

### Legal Transitions

| From | To | Trigger |
|---|---|---|
| INITIATED | AWAITING_CONFIRMATION | Client reports app returned OK |
| INITIATED | CANCELLED | Client reports user cancelled |
| INITIATED | FAILED | Client reports app returned error |
| AWAITING_CONFIRMATION | NEEDS_REVIEW | Reconciliation sweep (cron, 10 min timeout) |
| AWAITING_CONFIRMATION | FAILED | Future: PSP webhook says failed |
| NEEDS_REVIEW | SUCCESS | Explicit user confirmation (POST /confirm) |
| NEEDS_REVIEW | FAILED | Explicit user denial (POST /confirm with didSucceed=false) |

### Illegal Transitions

| From | To | Why rejected |
|---|---|---|
| INITIATED | SUCCESS | **The client cannot claim success directly** |
| Any terminal state | Any state | SUCCESS, FAILED, CANCELLED are terminal |

These are enforced by `assertValidTransition()` in `payment-state-machine.ts` which throws `InvalidPaymentTransitionError` on any violation. This guard runs before every state change in `payments.service.ts`.

---

## API Endpoints

### POST /api/v1/payments

Creates a payment attempt. Idempotent — retrying with the same `idempotencyKey` returns the existing attempt.

**Request**:
```json
{
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "amount": "250.00",
  "upiId": "merchant@okicici",
  "categoryId": "uuid-of-category",
  "description": "Canteen lunch"
}
```

**Response**: PaymentAttempt object with `status: "INITIATED"`

**Guards**: JwtAuthGuard, PaymentRateLimitGuard (max 10/60s per user)

### POST /api/v1/payments/:id/return

Called by the mobile app when it returns from the UPI app. Reports what the UPI app appeared to do. **This never sets SUCCESS.**

**Request**:
```json
{
  "outcome": "app_returned_ok",
  "referenceId": "optional-ref-from-upi-app"
}
```

Outcomes:
- `app_returned_ok` → AWAITING_CONFIRMATION
- `user_cancelled` → CANCELLED
- `app_returned_error` → FAILED

### POST /api/v1/payments/:id/confirm

Called when the user explicitly answers "Did your payment go through?" This is the **only** client-triggered path to SUCCESS.

**Request**:
```json
{
  "didSucceed": true,
  "categoryId": "uuid-of-category",
  "description": "Canteen lunch"
}
```

Only valid when attempt is in `NEEDS_REVIEW` state. Creates an Expense on confirmation.

### GET /api/v1/payments

Returns the user's payment attempts. Filterable by `?status=NEEDS_REVIEW`.

### GET /api/v1/payments/:id

Returns a single payment attempt with its event history.

---

## Reconciliation Job

`ReconciliationJob` runs as a `@Cron` every 5 minutes. It sweeps all `AWAITING_CONFIRMATION` attempts older than 10 minutes and moves them to `NEEDS_REVIEW`.

```
Every 5 minutes:
  SELECT * FROM payment_attempts
  WHERE status = 'AWAITING_CONFIRMATION'
    AND awaiting_since < NOW() - INTERVAL '10 minutes'
  
  For each:
    BEGIN TRANSACTION
      UPDATE payment_attempts SET status = 'NEEDS_REVIEW'
      INSERT INTO payment_events (fromStatus=AWAITING_CONFIRMATION, toStatus=NEEDS_REVIEW, reason='sweep_timeout')
    COMMIT
    
    [TODO: push FCM notification to user]
```

**Operational alert**: Monitor the count of NEEDS_REVIEW attempts. A spike in this queue depth is a leading indicator that a specific UPI app has changed its intent response behavior — this should trigger investigation, not just be dismissed as users being uncertain.

---

## UPI Deep Link Format

The mobile app constructs a UPI deep link before opening the UPI app:

```
upi://pay?pa={upiId}&pn={payeeName}&am={amount}&tn={description}&cu=INR&tr={attemptId}
```

Parameters:
- `pa` — Payee VPA (UPI ID)
- `pn` — Payee name (display only)
- `am` — Amount in rupees (formatted as `250.00`)
- `tn` — Transaction note / description
- `cu` — Currency code (`INR`)
- `tr` — Transaction reference (the `PaymentAttempt.id` — allows future reconciliation)

The mobile app opens this via `expo-linking`. The UPI app handles the actual payment. ThassaPay never sees the user's UPI PIN.

---

## Idempotency

Every payment creation request must include a client-generated UUID as `idempotencyKey`.

**How it works**:

```
Client generates UUID4 before showing the pay screen
→ Stores it locally
→ Sends it with POST /payments
→ Backend: IF EXISTS (same key, same userId) → return existing attempt
→ Backend: IF NOT EXISTS → create new attempt
→ If network fails → client retries with the SAME UUID
→ Backend returns same attempt, not a duplicate
```

**Why this matters**: Mobile networks drop. Users retry. Without idempotency, a student could be charged twice for one intended payment.

---

## Phase 2: PSP Integration

When a payment aggregator (Razorpay, Cashfree, PhonePe PG) is integrated:

1. The aggregator receives webhook callbacks with authoritative payment status
2. `reportReturn()` in `payments.service.ts` is the only method that needs to change — it currently handles client-reported returns; it will additionally handle PSP webhook payloads
3. The state machine does not change — `AWAITING_CONFIRMATION → SUCCESS` via PSP webhook is already a legal transition
4. Webhook signatures must be verified (HMAC-SHA256 with the aggregator's webhook secret) before any state change is applied
5. PSP webhook endpoints must be on a separate path not protected by user JWT — use webhook-specific secret header validation instead

This means most of the `NEEDS_REVIEW` queue disappears in Phase 2 — the sweep job becomes a safety net for webhook delivery failures, not the primary confirmation mechanism.

---

## Financial Safety Non-Negotiables

These apply to every line of code that touches payments:

1. Never trust client-reported payment success
2. Never skip idempotency on payment creation
3. Never create an Expense unless in a SUCCESS transition
4. Never call `finalizeAsExpense()` from anywhere except the `transition()` method on a SUCCESS transition
5. Never hard-delete a PaymentAttempt or Expense
6. Never store the user's UPI PIN, banking credentials, card numbers, OTPs
7. Never represent an estimated balance as authoritative bank balance
8. Never skip the state machine guard (`assertValidTransition()`) for a "shortcut"
