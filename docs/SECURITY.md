# ThassaPay — Security

## Threat Model Summary

ThassaPay is a financial-tracking and UPI payment-initiation application. Students' spending data and payment history are high-value targets. The attack surface is:

1. **API endpoints** — unauthenticated access, broken auth, IDOR
2. **Payment flow** — client spoofing a SUCCESS status, duplicate payment attempts
3. **Data exposure** — UPI IDs, spending patterns, hostel room numbers
4. **Token theft** — long-lived access tokens in a stolen device
5. **Account takeover** — compromised Google account or brute-forced refresh token

---

## Authentication

### Access Tokens

- **Algorithm**: HS256 JWT
- **Lifetime**: 15 minutes (hardcoded, no env override)
- **Payload**: `{ sub: userId, collegeId, iat, exp }`
- **Never extend access token lifetime** as a UX fix — fix the refresh flow instead

### Refresh Tokens

- **Lifetime**: 7 days
- **Storage**: Hashed with bcrypt before storage in `users.refresh_token_hash`
- **Rotation**: Every `/auth/refresh` call invalidates the old token hash and issues a new one
- **Revocation**: `/auth/logout` clears `refresh_token_hash` — the old token is immediately invalid even before expiry

### Google OAuth

- Mobile app obtains a Google ID token via `expo-auth-session` / Google Sign-In SDK
- API validates the ID token against Google's JWKS endpoint — never trusts the raw token fields
- Signup is restricted to `ALLOWED_COLLEGE_DOMAIN` — other email domains receive `403 Forbidden`
- Google `sub` (subject) is stored as `users.google_sub` — it is **not** a password and is safe to store

---

## Payment Security

### The Core Rule

**The backend never trusts client-reported SUCCESS.**

The payment state machine makes `INITIATED → SUCCESS` an illegal transition. The only paths to `SUCCESS` are:

1. **User explicit confirmation** (`NEEDS_REVIEW → SUCCESS` via `POST /payments/:id/confirm`)
2. **Future PSP webhook** (Phase 2 — authoritative signal from payment aggregator)

### Idempotency

Every payment creation (`POST /payments`) requires a client-generated UUID as `Idempotency-Key`. The backend stores this on `payment_attempts.idempotency_key` (unique index). A retry with the same key returns the existing row instead of creating a new payment attempt.

This prevents:
- Duplicate payments from mobile network retries
- Double-taps on the Pay button
- Race conditions from background app resume

### Per-User Rate Limiting

Payment creation is rate-limited **per user** (not just globally):
- Max 10 payment attempts per user per 60-second window
- Backed by Redis: `ratelimit:payments:{userId}`
- Responds with `429 Too Many Requests` when exceeded
- A compromised account cannot spam payment attempts even if the global limiter is far from tripped

### What Is Never Stored

- UPI PINs
- Banking passwords
- ATM/card PINs
- OTPs
- Raw refresh tokens (only bcrypt hash is stored)

---

## Input Validation

- All request bodies are validated by `class-validator` via NestJS `ValidationPipe`
- `whitelist: true` strips unknown fields
- `forbidNonWhitelisted: true` rejects requests with unknown fields (returns 400)
- `transform: true` coerces types (string → number, etc.) where declared
- UPI IDs are validated against `UPI_VPA_REGEX` before any database write
- Rupee amounts are validated against `RUPEE_AMOUNT_REGEX` — no free-form numeric input reaches the DB layer

---

## HTTP Security

```typescript
// main.ts
app.use(helmet());  // sets: X-Frame-Options, X-XSS-Protection, HSTS, CSP, etc.
app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] });
```

- CORS origin allowlist is explicit — not `*`
- No CORS allowed in production unless a specific origin is listed

---

## Database Security

### Role-Level Constraints

The PostgreSQL role used by the application has restricted grants:

| Table | INSERT | SELECT | UPDATE | DELETE |
|---|---|---|---|---|
| `payment_events` | ✅ | ✅ | ❌ | ❌ |
| `audit_logs` | ✅ | ✅ | ❌ | ❌ |
| All others | ✅ | ✅ | ✅ | ✅ (soft-deletes only) |

This means even a fully compromised application server cannot modify or delete audit records.

### Soft Deletes

Financial records (`expenses`, `users`) use `deletedAt` timestamps — never hard `DELETE`. This ensures:
- A user's payment history is always auditable even after account closure
- Accidental deletions are recoverable

---

## Secrets Management

### Rule: Zero Secrets in Source Control

- `.env` files are in `.gitignore`
- `.env.example` contains only placeholder values
- CI/CD secrets are stored in the secrets manager, not in GitHub Actions `env:` blocks visible in workflow YAML

### Recommended Secret Stores

| Environment | Store |
|---|---|
| Local dev | `.env` file (gitignored) |
| Staging / Production | Doppler, Railway Secrets, GCP Secret Manager, or AWS Secrets Manager |

### Rotation Policy

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` should be rotated every 90 days
- Google OAuth credentials are rotated annually or on any suspected compromise
- Database credentials are rotated on every team member departure

---

## Audit Logging

The `audit_logs` table records all security-relevant actions:

| Action | Logged when |
|---|---|
| `expense.created` | Manual expense created |
| `expense.soft_deleted` | Expense soft-deleted |
| `expense.corrected` | Correction row created |
| `payment.state_transition` | Any payment status change |
| `auth.login` | Successful Google sign-in |
| `auth.logout` | Explicit logout |
| `auth.refresh` | Refresh token rotated |
| `budget.set` | Budget created or updated |

Logs include: `userId`, `actorType`, `action`, `targetType`, `targetId`, `metadata` (JSON), `createdAt`.

---

## DPDP Act 2023 (India) — Phase 3

These are planned for Phase 3 but the schema is designed to support them:

- **Consent capture**: Explicit consent checkbox at onboarding, stored with timestamp
- **Data export**: `GET /api/v1/users/me/export` — returns all user data as JSON
- **Account deletion**: `DELETE /api/v1/users/me` — soft-deletes account PII, retains financial records per retention policy
- **Retention policy**: Financial records (expenses, payment attempts) retained for 7 years per Indian financial record-keeping norms; PII fields (name, email, phone) anonymized on deletion

---

## Security Checklist — Before Real Users

- [ ] DB-role grants verified: no UPDATE/DELETE on `payment_events` and `audit_logs`
- [ ] `.env` secrets are in a secrets manager, not a committed file
- [ ] Sentry configured and receiving errors from both API and mobile
- [ ] Staging environment exists with its own isolated database
- [ ] UPI Intent flow manually tested across Google Pay, PhonePe, and Paytm on staging
- [ ] Refresh token rotation verified: using an old refresh token after rotation returns 401
- [ ] Rate limiting verified: 11th payment attempt in 60 seconds returns 429
- [ ] CORS allowlist verified: requests from unexpected origins are rejected
