# ThassaPay — Development Guide

## Prerequisites

| Tool | Minimum Version | Notes |
|---|---|---|
| Node.js | 20.x | v24.x on dev machine is fine; Docker targets node:20-slim |
| npm | 11.x | Workspaces are used — do not use yarn or pnpm |
| PostgreSQL | 15+ | Local or Docker |
| Redis | 7+ | Local or Docker |
| Git | 2.x | |

---

## Repository Structure

```
thassapay/
├── apps/
│   ├── api/          Backend — NestJS + Prisma
│   └── mobile/       Mobile — React Native + Expo
├── packages/
│   ├── money/        @thassapay/money  — shared Money value object
│   ├── types/        @thassapay/types  — shared TypeScript types
│   └── validation/   @thassapay/validation — shared regex/validators
└── docs/
```

---

## First-Time Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd thassapay

# 2. Install all workspace dependencies
npm install

# 3. Set up environment for the API
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — fill in DATABASE_URL, REDIS_URL, JWT secrets, Google OAuth credentials

# 4. Run database migrations
npm run --workspace=apps/api prisma:migrate

# 5. Seed the database (categories + test college)
npm run --workspace=apps/api prisma:seed

# 6. Start the API dev server
npm run --workspace=apps/api start:dev

# 7. In another terminal, start the mobile app
cd apps/mobile
npx expo start
```

---

## Workspace Scripts

From the monorepo root:

```bash
# Run all tests
npm run test --workspaces --if-present

# Build all packages
npm run build --workspaces --if-present

# Lint all workspaces
npm run lint --workspaces --if-present

# Type-check all workspaces
npm run typecheck --workspaces --if-present
```

Individual workspaces:

```bash
# API
npm run --workspace=apps/api start:dev
npm run --workspace=apps/api test
npm run --workspace=apps/api build
npm run --workspace=apps/api prisma:migrate
npm run --workspace=apps/api prisma:seed

# Mobile
npm run --workspace=apps/mobile start
npm run --workspace=apps/mobile ios
npm run --workspace=apps/mobile android

# Packages
npm run --workspace=packages/money test
npm run --workspace=packages/money build
```

---

## Environment Variables

### apps/api/.env (local dev only — never commit)

```env
DATABASE_URL="postgresql://user:password@localhost:5432/thassapay"
REDIS_URL="redis://localhost:6379"

JWT_ACCESS_SECRET="change-me-locally"
JWT_REFRESH_SECRET="change-me-locally-different"

GOOGLE_OAUTH_CLIENT_ID="from-google-cloud-console"
GOOGLE_OAUTH_CLIENT_SECRET="from-google-cloud-console"
ALLOWED_COLLEGE_DOMAIN="vitap.ac.in"

ALLOWED_ORIGINS="http://localhost:8081"

SENTRY_DSN=""
PORT=3000
```

In staging/production, these come from a secrets manager (Doppler / Railway secrets / GCP Secret Manager). They are **never** committed to the repository or stored in CI environment variables visible in build logs.

---

## Database Migrations

```bash
# Create a new migration (after editing prisma/schema.prisma)
npm run --workspace=apps/api prisma:migrate

# Reset and re-seed local database
npx prisma --prefix apps/api migrate reset

# View migration status
npx prisma --prefix apps/api migrate status
```

**Rule**: Migrations are run by CI against staging before any production deploy. Never hand-run `prisma migrate deploy` against production directly.

---

## Testing

```bash
# Run all tests
npm run test --workspaces --if-present

# Run API tests only
npm run --workspace=apps/api test

# Run with coverage
npm run --workspace=apps/api test -- --coverage

# Watch mode
npm run --workspace=apps/api test -- --watch
```

### What has tests (currently)

| File | Coverage |
|---|---|
| `packages/money/src/money.ts` | Unit tested — float precision, formatting, parsing |
| `apps/api/src/payments/payment-state-machine.ts` | Unit tested — all legal/illegal transitions |

**Rule**: The state machine and Money class must always have 100% branch coverage. Any new feature in `payments.service.ts` that touches state transitions must include a test.

---

## Code Standards

### TypeScript

- **Strict mode** (`strict: true`) — no exceptions
- `any` is banned; use `unknown` with type narrowing
- All public service methods have explicit return types
- DTOs use `class-validator` decorators; no manual `if` type checks on input

### Money

- **Never** use `number` or `float` for currency values
- **Always** use `Money.fromRupees(input)` to parse user input
- **Always** use `Money.fromPaise(dbValue)` to wrap DB values
- **Never** do arithmetic on raw paise integers — use `Money.add()`, `Money.subtract()`
- **Never** store rupees as a float in the database

### Financial Records

- Never hard-delete expenses or payment attempts
- Corrections create new rows (`correctedFromId`); they do not edit existing rows
- `payment_events` is append-only; never update or delete rows from it
- `audit_logs` is append-only; never update or delete rows from it

### API Design

- All routes are prefixed with `/api/v1/`
- All endpoints require JWT auth unless explicitly documented otherwise
- All POST endpoints that create financial records require an `idempotencyKey`
- No endpoint returns raw Prisma model objects — always map to response DTOs

---

## Linting & Formatting

```bash
# Lint
npm run lint --workspaces --if-present

# Format (Prettier)
npm run format --workspaces --if-present
```

Config files:
- `.eslintrc.js` — at monorepo root, extended by each workspace
- `.prettierrc` — at monorepo root

---

## Running with Docker (optional for local)

```bash
# Start PostgreSQL + Redis only
docker compose up db redis -d

# Then run API normally with npm
npm run --workspace=apps/api start:dev
```

See `docker-compose.yml` at the monorepo root.

---

## Debugging Tips

- **Payment stuck in AWAITING_CONFIRMATION**: Check if Redis is running (ReconciliationJob needs the schedule module). The sweep runs every 5 minutes and moves stale attempts to NEEDS_REVIEW.
- **BigInt serialization error**: NestJS's default JSON serializer does not handle BigInt. The API response DTOs convert paise → display string before returning. If you see `TypeError: Do not know how to serialize a BigInt`, you're returning a raw Prisma model — map it to a DTO first.
- **Google OAuth failing locally**: Make sure `ALLOWED_COLLEGE_DOMAIN` matches the email domain you're testing with.
