# ThassaPay — Pre-Launch Security & Correctness Audit

**Date:** 2026-10-08
**Scope:** Full-repo P0/P1 pre-launch verification gate (26 steps) across `apps/api` (NestJS 10 + Prisma 5 + Postgres 16 + Redis), `apps/mobile` (Expo/RN), and `packages/{money,types,validation}`.
**Baseline:** single commit `750f672` on `main`, plus the in-flight "Audit fix P0/P1" working tree (52 modified, 3 deleted, 20 added files at time of report).
**Rule of evidence:** anything not actually executed end-to-end is labeled **NOT TESTED** — never PASS.

---

## 1. Executive Summary

The pre-launch gate found and fixed **all identified P0 (financial correctness) and P1 (security/auth) defects**, plus a deploy-blocking build configuration bug. The verification suite is green:

| Gate command | Result |
|---|---|
| `npm run typecheck` (root, incl. `tsconfig.test.json`) | **PASS** (rc=0) |
| `npm run lint` (ESLint 9 flat config, all workspaces) | **PASS** (rc=0) |
| `npm run build` (root, all workspaces) | **PASS** (rc=0) |
| `npm test` (root) | **PASS** — 19 suites / **185 tests** |
| Fresh-database migration + drift check (Step 18) | **PASS** |
| Live API integration over HTTP (Step 19) | **PASS** — **64/64 checks**, rc=0 |
| `npm audit fix` (non-breaking) | Applied: 111 → **109** vulns (2 → 1 critical); remainder need breaking majors |

**Verdict:** the codebase is in the best shape it has been for this audit cycle, but it is **not yet cleared for production launch**. See §9 Production Blockers — chiefly: no CI/CD, no refresh-token rotation despite documentation claiming it, in-memory-only OTP storage, and dependency majors (including one remaining critical advisory) deferred.

---

## 2. Method & Environment

- **Docker:** `thassapay_db` (postgres:16-alpine, `localhost:5432`) and `thassapay_redis` (`localhost:6390`) used for all live verification.
- **Clean audit database:** `thassapay_audit_test` created from zero and seeded only with category `11111111-1111-4111-8111-111111111111` (FOOD_MESS). All integration runs target this DB, never dev/prod data.
- **Live integration harness:** `apps/api/audit-integration.sh` boots the real built server (`node dist/main.js`, port 3111, `NODE_ENV=development`, explicit `JWT_ACCESS_SECRET`, `ALLOWED_ORIGINS=*`), drives the HTTP surface with `curl`, verifies DB state via `psql`, and tears the server down on exit. Rerunnable: per-run idempotency keys, rate-limit key reset, bounded curl timeouts, and `wait` scoped to curl PIDs only (a bare `wait` would block on the server process forever).
- **Bug priority used throughout:** P0 financial correctness → P1 security/auth → P2 → P3 → P4.

---

## 3. Gate Results by Step

| Area | Step(s) | Status | Evidence |
|---|---|---|---|
| Git history / working-tree secret audit | 1–6 | PASS | Expired 15-min JWT captures (`token_a.txt`, `verify_a.json`) deleted; 3 tracked `tsconfig.tsbuildinfo` untracked; `.gitignore` extended (tokens, test captures, `*.mkv/*.mp4`, `*.tsbuildinfo`, `*.db-journal`) |
| Secret scan (repo content) | — | PASS | No live credentials found; remaining local captures (`catid.txt`, `pay*.json`) are untracked & gitignored, contain no secrets |
| P0/P1 patch audit of in-flight diff | — | PASS | All in-flight changes reviewed; test-covered (see §5) |
| Health endpoint | 21 | PASS | Unit suite + live: `200 {"status":"ok"}`, <500ms, no `postgres`/`secret`/`password`/`redis://` leakage, `/api/health` alias works |
| Auth / OTP over HTTP | 8 | PASS | Throttled resend, wrong-OTP 401, 6-attempt lockout message, legacy `123456` bypass rejected, DTO 400s, token issuance, `/users/me` hides `refreshTokenHash`/`googleSub` |
| Rate limiting | 22 | PASS | Global `ThrottlerGuard` via `APP_GUARD` + per-user payment guard (10/60s) verified live: 11th create → `429` |
| Expenses / budgets / money on the wire | 7/13 | PASS | Number-paise exact JSON serialisation, 400 on negative/fractional/garbage input, soft delete + `deletedAt`, raw-row responses |
| Payment state machine | 10/11 | PASS | Full HTTP matrix incl. blocked `INITIATED→SUCCESS`, idempotent retries, review/confirm, denied-confirm → `FAILED` with no expense, second confirm rejected, `GET /:id` recovery |
| Idempotency & concurrency | 10 | PASS | Same-key retry returns same attempt, no duplicate row; 4 parallel duplicate creates → 1 distinct id, 1 DB row, all `201` |
| Cross-user isolation | 9 | PASS | User B gets 404 on User A's payment read/confirm and expense delete; sees none of A's expenses |
| Reconciliation sweep | 12 | PASS (unit) / **NOT TESTED** (live cron) | Idempotency via conditional `updateMany` unit-tested; scheduled job against real payment rows not exercised live |
| Fresh migration from zero | 18 | PASS | `prisma migrate deploy` on empty DB, `migrate status` current, `prisma migrate diff` **empty (no drift)**; verified 3 bigint money columns, unique constraints (idempotencyKey, expense paymentAttemptId, budget userId+month, email, googleSub, domain), 10 FKs, named indexes, soft-delete + `refreshTokenHash` columns |
| Live API integration | 19 | PASS | **64/64 checks**, rc=0 (see §7) |
| App lifecycle (UPI open/background/kill) | 20 | Code paths implemented + unit-tested / **NOT TESTED** on device | Real-device flow not exercised |
| Mobile unit tests | 16 | PASS (unit) / **NOT TESTED** (emulator) | 5 suites / 19 tests; `tsc --noEmit` and `eslint .` clean |
| Dependency audit | 23 | PASS (non-breaking) / PARTIAL (majors) | `npm audit fix` applied; 109 remain, all requiring breaking upgrades (see §6) |
| Env / staging config review | 25 | PASS | `SharedJwtModule` fails fast in production without `JWT_ACCESS_SECRET`/`JWT_SECRET`; `DEV_JWT_FALLBACK_SECRET` refused in production; `devOtp` only when `NODE_ENV !== 'production'` |
| Build/deploy layout | — | PASS | **Bug found+fixed:** `nest build` emitted `dist/src/main.js` while `start:prod`/Dockerfile `CMD node dist/main` — fixed via `include: ["src/**/*"]` in `apps/api/tsconfig.json`; `dist/main.js` verified emitted |
| This report | 26 | PASS | Document below |
| Emulator / real-device testing | 16/20 | **NOT TESTED** | See §8 |
| Real payment provider (UPI) end-to-end | — | **NOT TESTED** | See §8 |
| Sentry / error monitoring | — | **NOT TESTED** | See §8 |
| DPDP / privacy compliance | — | **NOT TESTED** | See §8 |
| DB role grants (least privilege) | — | **NOT TESTED** | See §8 |

---

## 4. Findings & Fixes

### P0 — Financial correctness (all fixed & test-covered)

| # | Finding | Fix |
|---|---|---|
| P0-1 | Money crossing the JSON boundary as `BigInt` could throw inside `JSON.stringify` (values > 2^53-1) and crash responses | Custom `BigInt.prototype.toJSON` serializer (`src/common/bigint-json.ts`) registered in `main.ts` + `app.module.ts`; spec `bigint-json.spec.ts` |
| P0-2 | Payment state machine permitted dangerous transitions; `AWAITING_CONFIRMATION → CANCELLED` was missing (leaving stuck attempts un-cancellable) | Transition matrix hardened; missing terminal-safe transition added with rationale; illegal transitions rejected (verified live: `INITIATED→SUCCESS` → 400, attempt unchanged) |
| P0-3 | Concurrent `createPaymentAttempt` with the same idempotency key could 500 on `P2002` | Race handled: loser returns the winner's attempt; verified live with 4 parallel creates → 1 row |
| P0-4 | No optimistic locking on state transitions → lost-update risk under concurrency | Conditional `updateMany` + `ConflictException` on version mismatch |
| P0-5 | Reconciliation sweep could double-apply (repeat run re-created expense) | Idempotent via conditional `updateMany` + `paymentAttemptId` unique constraint; spec `reconciliation.spec.ts` |
| P0-6 | Denial path could manufacture an expense / confirm body untyped (`didSucceed` truthy-string coercion, arbitrary `categoryId` → 500) | `ConfirmPaymentDto` with `@IsBoolean`/`@IsUUID`; live check: denied confirm → `FAILED`, `expenseId = null` |
| P0-7 | Money input accepted `<= 0`, fractional paise, garbage | `IsPaiseAmount` decorator; services reject `<= 0`; live: negative/fractional → 400 |
| P0-8 | Money wire contract ambiguous (string vs number) | Paise cross the boundary as exact JSON **numbers** via BigInt `toJSON`; DTOs accept number-or-string; responses are raw rows (numbers), not strings |

### P1 — Security / auth (all fixed & test-covered)

| # | Finding | Fix |
|---|---|---|
| P1-1 | OTPs generated non-cryptographically (predictable) | `crypto.randomInt` CSPRNG; `auth-otp.spec.ts` |
| P1-2 | No OTP attempt throttling/lockout; legacy `123456` dev bypass | Per-phone throttle + 6-attempt lockout + bypass rejected (live-verified) |
| P1-3 | JWT guard accepted empty `sub` | Rejects empty subject; `jwt-auth-guard.spec.ts` |
| P1-4 | Production could fall back to a dev JWT secret | `DEV_JWT_FALLBACK_SECRET` refused in production; `SharedJwtModule` fails fast without real secrets |
| P1-5 | `/users/me` leaked `refreshTokenHash` + `googleSub` | Explicit `profileSelect`; live check greps response for both fields |
| P1-6 | No global rate limiting | `ThrottlerGuard` registered via `APP_GUARD` |
| P1-7 | Auth/payment DTOs unvalidated (phone format, OTP shape, idempotency key) | `auth.dto.ts` (Indian phone, 6-digit OTP), `@Matches` idempotency key (`pay_<ts>_<rand>`) wired into controllers |
| P1-8 | Health endpoint could leak internals | Dedicated handler; live check greps for `postgres|secret|password|redis://` |
| P1-9 | Expired JWT captures committed/local in repo | Files deleted (15-min TTL, expired ~13 days, no refresh tokens exist so unrevocable-but-dead); `.gitignore` hardened; `tsbuildinfo` untracked |
| P1-10 | (Deploy) Production container would crash: `dist/main` path mismatch | tsconfig `include`/`exclude` fix; `dist/main.js` verified |

### P2 — Should fix before scale

| # | Finding | Status |
|---|---|---|
| P2-1 | OTP store is an in-process `Map` — a comment claiming "Redis in production" was **false**; multi-instance deployments break OTP verification & throttling | Documented; move to Redis before horizontal scaling |
| P2-2 | **No refresh-token flow** even though `refreshTokenHash` column + docs imply one — access-token expiry forces full re-login | Documented (blocker-adjacent, see §9) |
| P2-3 | Dependency majors deferred: Nest 10 (GHSA-36xv-jgw5-4q75 moderate), Expo/RN, jest | See §6 |
| P2-4 | No CI/CD — gate is manual | See §9 |

### P3 — Polish

| # | Finding | Status |
|---|---|---|
| P3-1 | `preferredRoastTone` accepted in DTO but not persisted | Accepted-but-ignored, documented |
| P3-2 | ESLint `no-floating-promises` dropped (requires type-aware linting) | Recorded here; re-enable with `typescript-eslint` type-aware config |
| P3-3 | Roast-tone preference & roast isolation | Isolation unit-tested (`roast-isolation.spec.ts`) |

### P4 — Housekeeping

- 5.1GB personal `.mkv` and other media gitignored (**not** deleted).
- Local test captures (`catid.txt`, `pay*.json`, `api-integration.log`, `integration-out.txt`) untracked + gitignored.
- `docker-compose.override.yml` (Redis on 6390) is currently **untracked** — commit it or document the port.

---

## 5. Test Evidence

| Workspace | Suites | Tests | Status |
|---|---|---|---|
| `apps/api` | 12 | 156 | PASS |
| `apps/mobile` | 5 | 19 | PASS |
| `packages/money` | 1 | 5 | PASS |
| `packages/validation` | 1 | 5 | PASS |
| **Total** | **19** | **185** | **PASS** |

New/expanded suites this cycle: `dto-contract`, `bigint-json` (+health), `auth-otp`, `jwt-auth-guard`, `payments-service`, `reconciliation`, `expenses-service`, `roast-isolation`, `payment-rate-limit`, updated `payment-state-machine` matrix, `money`, mobile `payment-flow`.

Typecheck: `tsc --noEmit` (src) + `tsc --noEmit -p tsconfig.test.json` (src+test) both clean; mobile `tsc --noEmit` clean. Lint: flat-config ESLint 9 clean across all workspaces.

---

## 6. Dependency Audit (Step 23)

- **Before:** 111 vulnerabilities (2 critical).
- **After `npm audit fix` (non-breaking, approved):** **109** (5 low, 30 moderate, 73 high, **1 critical**).
- **Remaining critical:** `tar`/node-tar advisories (GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, …) reached through the **Expo build-tool chain**; fix requires a semver-major Expo upgrade. Not on the API runtime path — not exploitable in the served backend.
- **Fixed by the run:** `shell-quote` critical and other non-breaking bumps.
- **Other notable:** `@nestjs/core` moderate injection advisory (GHSA-36xv-jgw5-4q75, affects ≤11.1.17 → our Nest 10) — fix requires **Nest 11/12 major**; `webpack` SSRF advisories via `@nestjs/cli` (build-time only).
- **`npm audit fix --force` was NOT run** — it would install Nest 12, Expo 57, RN 0.87, jest 30 (breaking).

---

## 7. Live Integration Verification (Step 19) — 64/64 PASS

Final run: `bash apps/api/audit-integration.sh` → **PASS=64 FAIL=0, rc=0**, covering:

1. Health: status/body/latency/alias/no-internals-leak.
2. Auth: 401s for unauthenticated/garbage/missing tokens.
3. OTP: request + throttle, wrong-OTP 401s, 6-attempt lockout message, `123456` bypass rejected, DTO 400, verify → token; `/users/me` hides auth material yet returns profile fields.
4. Money on the wire: exact JSON-number paise for expense & budget; negative/fractional/garbage → 400; list + soft delete verified in DB (`deletedAt` set, row retained, hidden from list).
5. Payment state machine: create (app-style idempotency key) → `INITIATED`; idempotent retry; blocked `INITIATED→SUCCESS` with state unchanged; return → `AWAITING_CONFIRMATION`; legacy payload → 400; review → `NEEDS_REVIEW` (idempotent retry); confirm → `SUCCESS`; second confirm rejected; exactly one expense created; `GET /:id` exposes `expenseId`.
6. Denied flow: return → review → confirm(`didSucceed:false`) → `FAILED`, `expenseId = null`.
7. Cross-user: 404s on read/confirm/delete, empty list.
8. Rate limit: 11th create/minute → `429`.
9. Concurrency: 4 parallel duplicate creates → 1 distinct attempt, all `201`, exactly 1 DB row.
10. DB consistency: one expense linked to successful attempt, payment-events recorded, zero/negative money rows = 0.

*Note:* three failures during bring-up were **harness bugs** (exact-match vs substring on the lockout message; fixed idempotency keys colliding with prior-run rows; bare `wait` blocking on the server process) — all fixed in the script; no product defect was involved.

---

## 8. NOT TESTED (explicitly, no PASS claimed)

- **Emulator / real-device mobile testing** — unit tests + typecheck only.
- **Real UPI payment provider end-to-end** — no live gateway; provider sandbox integration untouched.
- **App lifecycle on device** (UPI app open/background/kill mid-payment, OS-reclaimed process) — code paths implemented and unit-tested only.
- **Reconciliation sweep as a live scheduled job** against real stuck payments (logic is unit-tested).
- **Sentry / error monitoring** — not configured or exercised.
- **DPDP / privacy compliance** — no data-retention/deletion verification performed.
- **DB least-privilege role grants** — app connects as the schema owner; no restricted runtime role tested.
- **Production-mode boot** (`NODE_ENV=production` with real secrets) — fail-fast paths unit-tested, actual prod boot not run.
- **Horizontal scaling / multi-instance** — OTP & throttle in-process state makes this unverified (P2-1).

---

## 9. Remaining Risks & Production Blockers

**Blockers (must resolve before launch):**

1. **No CI/CD** — the entire gate is manual; one mis-run regressions. Codify: typecheck → lint → build → test → migrate-diff → `audit-integration.sh`.
2. **No refresh-token flow** despite docs/schema implying one — access-token expiry silently logs users out; worse, if TTLs are lengthened to compensate, stolen tokens are unrevocable.
3. **OTP in-memory only** — breaks the moment you run >1 instance (P2-1). Move to Redis (which is already provisioned) before launch if multi-instance is planned.
4. **Dependency majors deferred** — including the last critical (Expo `tar` chain) and the Nest injection advisory; schedule the upgrade train.
5. **No real-device / emulator pass** and **no live UPI sandbox run** (§8).

**Accepted risks (documented, non-blocking):**

- Roast tone preference accepted but not persisted (P3-1).
- `no-floating-promises` lint rule disabled (P3-2).
- Personal media & local captures left on disk (gitignored).
- Rate-limit counters live in Redis with 60s TTL — fine for single region.

---

## 10. Recommended Next Phase

1. **Land the audit as a commit** (surgical staging — never `git add -A`): the 52 modified + 20 new files (source fixes, tests, `eslint.config.js`, `tsconfig.test.json`, `prisma/migrations/`, `audit-integration.sh`, `docker-compose.override.yml`), excluding logs/captures/media.
2. **Stand up CI** running the exact gate above plus `prisma migrate diff` drift check on every PR.
3. **Implement refresh-token rotation** (the schema already has `refreshTokenHash`) and move OTP/throttle state to Redis.
4. **Schedule the major-upgrade train** (Nest 11/12, Expo/RN, jest 30) to clear the remaining 109 advisories.
5. **Device + UPI sandbox pass** to convert the §8 NOT TESTED items into evidence.
6. **Prod-boot rehearsal**: `NODE_ENV=production` container start with real secrets, migration deploy on a fresh DB, health check, rollback drill.
