#!/usr/bin/env bash
# Step 19 — live API integration against the clean `thassapay_audit_test` DB.
# Boots the built server, exercises the real HTTP surface, kills the server.
set -u

cd "$(dirname "$0")"
export NODE_ENV=development
export DATABASE_URL="postgresql://thassapay:thassapay_local@localhost:5432/thassapay_audit_test"
export REDIS_URL="redis://localhost:6390"
export JWT_ACCESS_SECRET="audit-integration-secret-2026-not-prod"
export ALLOWED_ORIGINS="*"
export PORT=3111
BASE="http://localhost:3111"
API="$BASE/api/v1"
CATEGORY="11111111-1111-4111-8111-111111111111"
BODY=$(mktemp)
AUTH=""
RUN=$(date +%s)   # unique per run so reruns never collide with leftover rows
PASS=0; FAIL=0

ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL  $1 — $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected=[$2] actual=[$3]"; fi; }
contains(){ case "$3" in *"$2"*) ok "$1";; *) bad "$1" "expected substring=[$2] actual=[$3]";; esac; }

val(){ node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  try{ const o=JSON.parse(d); let v=o; for(const k of process.argv[1].split('.')){ if(!k) continue; v=(v===null||v===undefined)?undefined:v[k]; }
       process.stdout.write(typeof v==='object'&&v!==null?JSON.stringify(v):(v===undefined?'undefined':String(v))); }
  catch(e){ process.stdout.write('PARSE_ERR'); } });" "$1" < "$BODY"; }

req(){ # method url [json] -> sets CODE
  local m="$1" u="$2" j="${3:-}"
  local args=(-X "$m" "$u")
  if [ -n "$AUTH" ]; then args+=(-H "Authorization: Bearer $AUTH"); fi
  if [ -n "$j" ]; then args+=(-H 'Content-Type: application/json' -d "$j"); fi
  CODE=$(curl -sS --max-time 15 -o "$BODY" -w '%{http_code}' "${args[@]}")
}

cleanup(){ [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null; rm -f "$BODY"; }
trap cleanup EXIT

echo "== booting API =="
# Clear leftover per-user rate-limit counters from prior runs (60s TTL in shared Redis)
docker exec thassapay_redis redis-cli --scan --pattern 'ratelimit:*' | while read -r k; do
  [ -n "$k" ] && docker exec thassapay_redis redis-cli DEL "$k" > /dev/null
done
node dist/main.js > api-integration.log 2>&1 &
API_PID=$!
for i in $(seq 1 40); do
  sleep 0.5
  curl -sS -o /dev/null "$BASE/health" && break
done

echo "== Step 21: health =="
START=$(date +%s%N)
req GET "$BASE/health"; ENDD=$(date +%s%N)
check "GET /health status" "200" "$CODE"
check "GET /health body" '{"status":"ok"}' "$(cat "$BODY")"
MS=$(( (ENDD - START) / 1000000 ))
if [ "$MS" -lt 500 ]; then ok "health responds fast (${MS}ms)"; else bad "health latency" "${MS}ms"; fi
req GET "$BASE/api/health"; check "GET /api/health status" "200" "$CODE"
if grep -qiE 'postgres|secret|password|redis://' "$BODY"; then bad "health leaks internals" "$(cat "$BODY")"; else ok "health leaks nothing"; fi

echo "== Step 22/9: authentication =="
req POST "$API/expenses" '{"categoryId":"'"$CATEGORY"'","amountPaise":100,"paymentMethod":"CASH"}'
check "unauthenticated write -> 401" "401" "$CODE"
AUTH="not-a-token"; req GET "$API/users/me"; check "garbage token -> 401" "401" "$CODE"
AUTH=""; req GET "$API/users/me"; check "missing token -> 401" "401" "$CODE"

echo "== Step 8: OTP flow over HTTP =="
req POST "$API/auth/otp/request" '{"phoneNumber":"9876543210"}'
check "otp/request #1 -> 201" "201" "$CODE"
DEVOTP=$(val devOtp)
req POST "$API/auth/otp/request" '{"phoneNumber":"9876543210"}'
check "otp/request immediate retry -> throttled" "400" "$CODE"
req POST "$API/auth/otp/verify" '{"phoneNumber":"9876543210","otp":"000000"}'
check "wrong OTP -> 401" "401" "$CODE"
for i in 1 2 3 4; do req POST "$API/auth/otp/verify" '{"phoneNumber":"9876543210","otp":"000000"}'; done
req POST "$API/auth/otp/verify" '{"phoneNumber":"9876543210","otp":"000000"}'
contains "6th wrong OTP -> lockout message" "Too many incorrect attempts" "$(val message)"
req POST "$API/auth/otp/verify" '{"phoneNumber":"9876543210","otp":"123456"}'
check "legacy dev bypass 123456 rejected" "401" "$CODE"
req POST "$API/auth/otp/verify" '{"phoneNumber":"9876543210"}'
check "missing otp field -> 400 (DTO validation)" "400" "$CODE"

# Main user (phone B)
req POST "$API/auth/otp/request" '{"phoneNumber":"9765432109"}'; O1=$(val devOtp)
req POST "$API/auth/otp/verify" '{"phoneNumber":"9765432109","otp":"'"$O1"'"}'
check "otp/verify valid -> 201" "201" "$CODE"
AUTH=$(val accessToken)
if [ -n "$AUTH" ] && [ "$AUTH" != "undefined" ]; then ok "access token issued"; else bad "access token issued" "$AUTH"; fi
RT=$(val refreshToken)
if [ -n "$RT" ] && [ "$RT" != "undefined" ]; then ok "refresh token issued at login"; else bad "refresh token issued at login" "$RT"; fi

req GET "$API/users/me"
check "GET /users/me -> 200" "200" "$CODE"
if grep -qiE 'refreshTokenHash|googleSub' "$BODY"; then bad "/users/me hides auth material" "leaked refreshTokenHash/googleSub"; else ok "/users/me hides refreshTokenHash+googleSub"; fi
if grep -q '"hostelBlock"' "$BODY"; then ok "/users/me still returns profile fields"; else bad "/users/me profile fields" "$(cat "$BODY")"; fi

echo "== refresh-token rotation + logout revocation =="
# Refresh replaces the refresh token; the old one must stop working.
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT"'"}'
check "refresh -> 201" "201" "$CODE"
AUTH2=$(val accessToken); RT2=$(val refreshToken)
if [ -n "$RT2" ] && [ "$RT2" != "undefined" ] && [ "$RT2" != "$RT" ]; then ok "refresh rotates the refresh token"; else bad "refresh rotates the refresh token" "same-or-missing token returned"; fi
if [ -n "$AUTH2" ] && [ "$AUTH2" != "undefined" ]; then ok "refresh returns a new access token"; else bad "refresh returns a new access token" "$AUTH2"; fi
# The rotated (consumed) token is rejected on replay.
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT"'"}'
check "replayed old refresh token -> 401" "401" "$CODE"
# The new access token authenticates.
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' "$API/users/me" -H "Authorization: Bearer $AUTH2")
check "new access token authorises /users/me -> 200" "200" "$CODE"
# Replaying the consumed token burned the family: the newest token dies too.
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT2"'"}'
check "family revoked after reuse: newest token -> 401" "401" "$CODE"
# Unknown token -> the same generic 401 (no existence oracle).
req POST "$API/auth/refresh" '{"refreshToken":"totally-made-up-token"}'
check "unknown refresh token -> 401" "401" "$CODE"
# Logout revokes the session server-side. A fresh phone/user avoids waiting out
# the 1-request-per-minute OTP throttle (the control stays fully enforced).
# NOTE: `req` always sends the global $AUTH as the bearer token, so we point
# $AUTH at the OWNING user before each logout — the ownership check must see a
# match or it (correctly) no-ops. Cross-user protection is asserted separately.
MAIN_AUTH="$AUTH"   # preserve the main user for the later money suites
req POST "$API/auth/otp/request" '{"phoneNumber":"9812345670"}'; OL1=$(val devOtp)
req POST "$API/auth/otp/verify" '{"phoneNumber":"9812345670","otp":"'"$OL1"'"}'
USER_L_AUTH=$(val accessToken); RT_L=$(val refreshToken)
# Cross-user: authenticate as the MAIN user (a different account) while
# presenting user L's refresh token. The ownership check must refuse to revoke.
AUTH="$MAIN_AUTH"
req POST "$API/auth/logout" '{"refreshToken":"'"$RT_L"'"}'
check "cross-user logout -> 201 (idempotent, no leak)" "201" "$CODE"
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT_L"'"}'
check "cross-user logout did NOT revoke -> 201" "201" "$CODE"
# Now the OWNER logs out — this must revoke.
AUTH="$USER_L_AUTH"
req POST "$API/auth/logout" '{"refreshToken":"'"$RT_L"'"}'
check "owner logout -> 201" "201" "$CODE"
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT_L"'"}'
check "logged-out refresh token -> 401" "401" "$CODE"
# logout-all revokes every session for the user. (Multi-session revocation is
# covered directly in the unit suite; here we assert the HTTP path kills a
# live session.)
req POST "$API/auth/otp/request" '{"phoneNumber":"9812345671"}'; OA1=$(val devOtp)
req POST "$API/auth/otp/verify" '{"phoneNumber":"9812345671","otp":"'"$OA1"'"}'
AUTH=$(val accessToken); RT_A1=$(val refreshToken)
req POST "$API/auth/logout-all" '{}'
check "logout-all -> 201" "201" "$CODE"
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT_A1"'"}'
check "post logout-all refresh token -> 401" "401" "$CODE"
AUTH="$MAIN_AUTH"   # restore the main user for the money suites below
# Persistence: the revocation is a DB row, not in-memory — it survives a restart.
REVOKED=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM refresh_sessions WHERE \"revokedAt\" IS NOT NULL;")
if [ "$REVOKED" -gt 0 ]; then ok "revocations persisted to DB (${REVOKED} rows)"; else bad "revocations persisted to DB" "0 rows"; fi
# Only hashes are stored — a raw token must never appear in the table.
RAWLEAK=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM refresh_sessions WHERE \"tokenHash\" IN ('"$RT"','"$RT2"','"$RT_L"','"$RT_A1"');")
check "raw refresh tokens never stored (hashes only)" "0" "$RAWLEAK"

echo "== Step 7/13: expenses (money on the wire) =="
req POST "$API/expenses" '{"categoryId":"'"$CATEGORY"'","amountPaise":150000,"paymentMethod":"UPI","description":"Mess lunch","expenseDate":"2026-10-07"}'
check "create expense (number paise) -> 201" "201" "$CODE"
if grep -qE '"amountPaise":150000([,}])' "$BODY"; then ok "expense amount serialises as exact JSON number"; else bad "expense amount serialisation" "$(cat "$BODY")"; fi
EXP_ID=$(val id)
req POST "$API/expenses" '{"categoryId":"'"$CATEGORY"'","amountPaise":-100,"paymentMethod":"CASH"}'
check "negative amount -> 400" "400" "$CODE"
req POST "$API/expenses" '{"categoryId":"'"$CATEGORY"'","amountPaise":"12.5","paymentMethod":"CASH"}'
check "fractional paise -> 400" "400" "$CODE"
req POST "$API/expenses" '{"categoryId":"not-a-uuid","amountPaise":100,"paymentMethod":"CASH"}'
check "garbage categoryId -> 400" "400" "$CODE"
req GET "$API/expenses"
check "list expenses -> 200" "200" "$CODE"
LIST_COUNT=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(String(JSON.parse(d).length))})" < "$BODY")

echo "== Step 13: soft delete + correction =="
req DELETE "$API/expenses/$EXP_ID"
check "soft delete -> 200" "200" "$CODE"
LEFT=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d);process.stdout.write(String(rows.filter(r=>r.id==='$EXP_ID').length))})" < <(curl -sS "$API/expenses" -H "Authorization: Bearer $AUTH"))
check "soft-deleted expense hidden from list" "0" "$LEFT"
ROW=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT CASE WHEN \"deletedAt\" IS NULL THEN 'alive' ELSE 'soft_deleted' END FROM expenses WHERE id='$EXP_ID';")
check "row still exists with deletedAt set" "soft_deleted" "$ROW"

echo "== budgets + analytics =="
req POST "$API/budgets" '{"month":"2026-10","amountPaise":50000}'
check "set budget (number paise) -> 201" "201" "$CODE"
if grep -qE '"amountPaise":50000([,}])' "$BODY"; then ok "budget serialises as exact JSON number"; else bad "budget serialisation" "$(cat "$BODY")"; fi
req POST "$API/budgets" '{"month":"2026-10","amountPaise":-5}'
check "negative budget -> 400" "400" "$CODE"
req POST "$API/budgets" '{"month":"October","amountPaise":500}'
check "bad month format -> 400" "400" "$CODE"
req GET "$API/analytics/summary"
check "analytics -> 200" "200" "$CODE"

echo "== Step 10/11/13: payment state machine over HTTP =="
IDEMP="pay_$(date +%s)_abc1234"
req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"150.00","idempotencyKey":"'"$IDEMP"'","categoryId":"'"$CATEGORY"'","description":"Mess lunch"}'
check "create payment (app-style idempotency key) -> 201" "201" "$CODE"
PID=$(val id); PSTATUS=$(val status)
check "payment starts INITIATED" "INITIATED" "$PSTATUS"
if grep -qE '"amountPaise":15000([,}])' "$BODY"; then ok "payment amount serialises as exact JSON number"; else bad "payment amount serialisation" "$(cat "$BODY")"; fi

req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"150.00","idempotencyKey":"'"$IDEMP"'","categoryId":"'"$CATEGORY"'"}'
check "retry same idempotency key -> same attempt" "$PID" "$(val id)"
SAME=$(curl -sS "$API/payments/$PID" -H "Authorization: Bearer $AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).idempotencyKey)))")
check "no duplicate row created" "$IDEMP" "$SAME"

req POST "$API/payments/$PID/confirm" '{"didSucceed":true,"categoryId":"'"$CATEGORY"'"}'
check "INITIATED -> SUCCESS blocked (400)" "400" "$CODE"
STILL=$(curl -sS "$API/payments/$PID" -H "Authorization: Bearer $AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).status))")
check "attempt still INITIATED after blocked confirm" "INITIATED" "$STILL"

req POST "$API/payments/$PID/return" '{"outcome":"app_returned_ok"}'
check "return report -> AWAITING_CONFIRMATION" "AWAITING_CONFIRMATION" "$(val status)"
req POST "$API/payments/$PID/return" '{"status":"USER_RETURNED"}'
check "legacy return payload -> 400 (DTO enum)" "400" "$CODE"
req POST "$API/payments/$PID/review" '{}'
check "review -> NEEDS_REVIEW" "NEEDS_REVIEW" "$(val status)"
req POST "$API/payments/$PID/review" '{}'
check "review retry is idempotent (still 201/200)" "201" "$CODE"
BEFORE=$(curl -sS "$API/expenses" -H "Authorization: Bearer $AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).filter(e=>!e.deletedAt).length)))")
req POST "$API/payments/$PID/confirm" '{"didSucceed":true,"categoryId":"'"$CATEGORY"'","description":"UPI Payment"}'
check "NEEDS_REVIEW -> SUCCESS" "SUCCESS" "$(val status)"
req POST "$API/payments/$PID/confirm" '{"didSucceed":true,"categoryId":"'"$CATEGORY"'"}'
check "second confirm rejected" "400" "$CODE"
AFTER=$(curl -sS "$API/expenses" -H "Authorization: Bearer $AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).filter(e=>!e.deletedAt).length)))")
check "exactly one expense created" "1" "$((AFTER - BEFORE))"
req GET "$API/payments/$PID"
check "authoritative lookup -> 200" "200" "$CODE"
EXPID=$(val expenseId)
if [ -n "$EXPID" ] && [ "$EXPID" != "null" ] && [ "$EXPID" != "undefined" ]; then ok "lookup exposes created expenseId"; else bad "lookup exposes created expenseId" "$EXPID"; fi

# Denied confirmation must not create an expense
req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"42.00","idempotencyKey":"pay_denied_'"$RUN"'_0001","categoryId":"'"$CATEGORY"'"}'
check "denied-flow payment created -> 201" "201" "$CODE"
PID2=$(val id)
req POST "$API/payments/$PID2/return" '{"outcome":"app_returned_ok"}'
check "denied flow: return -> AWAITING_CONFIRMATION" "AWAITING_CONFIRMATION" "$(val status)"
req POST "$API/payments/$PID2/review" '{}'
check "denied flow: review -> NEEDS_REVIEW" "NEEDS_REVIEW" "$(val status)"
req POST "$API/payments/$PID2/confirm" '{"didSucceed":false,"categoryId":"'"$CATEGORY"'"}'
check "denied confirmation -> FAILED" "FAILED" "$(val status)"
NOEXP=$(curl -sS "$API/payments/$PID2" -H "Authorization: Bearer $AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).expenseId)))")
check "failed payment holds no expense" "null" "$NOEXP"

echo "== Step 9: cross-user access =="
req POST "$API/auth/otp/request" '{"phoneNumber":"9654321098"}'; O2=$(val devOtp)
req POST "$API/auth/otp/verify" '{"phoneNumber":"9654321098","otp":"'"$O2"'"}'
AUTH2=$(val accessToken)
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' "$API/payments/$PID" -H "Authorization: Bearer $AUTH2")
check "User B reads User A's payment -> 404" "404" "$CODE"
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$API/payments/$PID/confirm" -H "Authorization: Bearer $AUTH2" -H 'Content-Type: application/json' -d '{"didSucceed":true,"categoryId":"'"$CATEGORY"'"}')
check "User B confirms User A's payment -> 404" "404" "$CODE"
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' -X DELETE "$API/expenses/$EXP_ID" -H "Authorization: Bearer $AUTH2")
check "User B deletes User A's expense -> 404" "404" "$CODE"
B_LIST=$(curl -sS "$API/expenses" -H "Authorization: Bearer $AUTH2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).length)))")
check "User B sees none of User A's expenses" "0" "$B_LIST"

echo "== Step 22: per-user payment rate limit (10/60s) =="
LAST=""
for i in $(seq 1 11); do
  CODE=$(curl -sS --max-time 15 -o "$BODY" -w '%{http_code}' -X POST "$API/payments" -H "Authorization: Bearer $AUTH2" -H 'Content-Type: application/json' \
    -d '{"upiId":"canteen@okaxis","amount":"10.00","idempotencyKey":"pay_rl_'"$RUN"'_'"$i"'_key","categoryId":"'"$CATEGORY"'"}')
  LAST="$CODE"
done
check "11th payment attempt within a minute -> 429" "429" "$LAST"

echo "== concurrency: parallel duplicate payment creates =="
IDEMP2="pay_parallel_${RUN}_0001"
CURL_PIDS=()
for i in 1 2 3 4; do
  curl -sS --max-time 15 -o "$BODY.$i" -w '%{http_code}\n' -X POST "$API/payments" -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
    -d '{"upiId":"canteen@okaxis","amount":"77.00","idempotencyKey":"'"$IDEMP2"'","categoryId":"'"$CATEGORY"'"}' >> /tmp/codes.$$ 2>&1 &
  CURL_PIDS+=($!)
done
# wait ONLY on the curls — a bare `wait` would also block on the API server forever
for p in "${CURL_PIDS[@]}"; do wait "$p" || true; done
# read bodies via stdin (bash handles the path; node on Windows can't open git-bash's /tmp directly)
IDS=$(for i in 1 2 3 4; do node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).id+' ')}catch(e){process.stdout.write('ERR ')}})" < "$BODY.$i"; done)
UNIQ=$(echo $IDS | tr ' ' '\n' | grep -v ERR | sort -u | wc -l | tr -d ' ')
CODES=$(cat /tmp/codes.$$ | tr -d '\r' | sort -u | tr '\n' ' ')
rm -f /tmp/codes.$$ "$BODY".1 "$BODY".2 "$BODY".3 "$BODY".4
check "4 parallel duplicates -> one distinct attempt id" "1" "$UNIQ"
check "parallel duplicates all succeed (201)" "201 " "$CODES"
DUPROWS=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM payment_attempts WHERE \"idempotencyKey\"='$IDEMP2';")
check "exactly one row for the idempotency key" "1" "$DUPROWS"

echo "== money consistency in the DB =="
PAYEXP=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM expenses WHERE \"paymentAttemptId\"='$PID';")
check "one expense row linked to the successful attempt" "1" "$PAYEXP"
EVENTS=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM payment_events WHERE \"paymentAttemptId\"='$PID';")
echo "  INFO  payment_events rows for that attempt: $EVENTS"
BAD=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM expenses WHERE \"amountPaise\" <= 0;")
check "no zero/negative money rows" "0" "$BAD"

echo "== restart persistence: sessions live in Postgres, not in-process =="
# Create a live session BEFORE the restart. (RT from the main login was burned
# by reuse detection, RT_L/RT_A1 were revoked — all good negative controls.)
req POST "$API/auth/otp/request" '{"phoneNumber":"9812345672"}'; OR1=$(val devOtp)
req POST "$API/auth/otp/verify" '{"phoneNumber":"9812345672","otp":"'"$OR1"'"}'
AUTH_R=$(val accessToken); RT_R=$(val refreshToken)
# A payment created BEFORE the restart must survive it with state intact —
# this is the "app killed mid-flow" case: the server must hold recoverable
# state, not an in-memory guess. (Uses user R so the per-user payment rate
# limit of the MAIN user stays untouched.)
SAVE_AUTH="$AUTH"; AUTH="$AUTH_R"
IDEMP_PR="pay_prerestart_${RUN}_0001"
req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"55.00","idempotencyKey":"'"$IDEMP_PR"'","categoryId":"'"$CATEGORY"'","description":"Pre-restart payment"}'
check "pre-restart payment created -> 201" "201" "$CODE"
PID_PRE=$(val id)
AUTH="$SAVE_AUTH"
# Kill and relaunch the API process — in-memory state would be lost here.
kill "$API_PID" 2>/dev/null
wait "$API_PID" 2>/dev/null
node dist/main.js >> api-integration.log 2>&1 &
API_PID=$!   # keep the EXIT trap pointed at the new process
RESTARTED=0
for i in $(seq 1 40); do
  sleep 0.5
  if curl -sS -o /dev/null "$BASE/health"; then RESTARTED=1; break; fi
done
if [ "$RESTARTED" = "1" ]; then ok "API restarted"; else bad "API restarted" "health never came back"; fi
# 1. A live pre-restart refresh token still works (session survived the restart).
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT_R"'"}'
check "live refresh token survives restart -> 201" "201" "$CODE"
RT_R2=$(val refreshToken); AUTH_R2=$(val accessToken)
# 2. Revocation from BEFORE the restart is still enforced after it.
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT_L"'"}'
check "pre-restart revoked token still dead after restart -> 401" "401" "$CODE"
# 3. Reuse-burned token from BEFORE the restart is still dead after it.
req POST "$API/auth/refresh" '{"refreshToken":"'"$RT"'"}'
check "pre-restart consumed token still dead after restart -> 401" "401" "$CODE"
# 4. The access JWT is stateless and keeps working across the restart.
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' "$API/users/me" -H "Authorization: Bearer $AUTH_R2")
check "fresh access token authorises after restart -> 200" "200" "$CODE"
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' "$API/users/me" -H "Authorization: Bearer $AUTH")
check "pre-restart access JWT still valid after restart -> 200" "200" "$CODE"
# 5. OTP store IS in-process (documented P2): a pre-restart devOtp is gone.
req POST "$API/auth/otp/verify" '{"phoneNumber":"9812345672","otp":"'"$OR1"'"}'
check "consumed OTP not replayable after restart -> 401" "401" "$CODE"
# 6. Post-restart state persisted: revoked rows are queryable from the DB.
REV_AFTER=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM refresh_sessions WHERE \"revokedAt\" IS NOT NULL;")
if [ "$REV_AFTER" -gt 0 ]; then ok "revocations still in DB after restart (${REV_AFTER} rows)"; else bad "revocations still in DB after restart" "0 rows"; fi
# 7. The pre-restart payment survived the restart: same attempt, same state,
#    same idempotency key — a recoverable server-side record, not a client guess.
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' "$API/payments/$PID_PRE" -H "Authorization: Bearer $AUTH_R")
check "pre-restart payment lookup after restart -> 200" "200" "$CODE"
check "pre-restart payment still INITIATED after restart" "INITIATED" "$(val status)"
check "pre-restart idempotency key unchanged after restart" "$IDEMP_PR" "$(val idempotencyKey)"

echo "== auth renewal cannot duplicate a payment =="
# Simulate an expired access token for a real payment create: re-sign the
# user's own claims (decoded from their valid token) with the harness's local
# test secret and a past exp. The guard must reject it BEFORE any state is
# written, and the retry after "refresh" must reuse the same idempotency key.
SAVE_AUTH="$AUTH"; AUTH="$AUTH_R"
EXPIRED_JWT=$(node -e "const jwt=require('jsonwebtoken');const claims=jwt.decode(process.argv[1]);delete claims.iat;delete claims.exp;process.stdout.write(jwt.sign(claims,process.env.JWT_ACCESS_SECRET,{expiresIn:-60}))" "$AUTH_R")
IDEMP_AR="pay_authretry_${RUN}_0001"
CODE=$(curl -sS -o "$BODY" -w '%{http_code}' -X POST "$API/payments" -H "Authorization: Bearer $EXPIRED_JWT" -H 'Content-Type: application/json' \
  -d '{"upiId":"canteen@okaxis","amount":"66.00","idempotencyKey":"'"$IDEMP_AR"'","categoryId":"'"$CATEGORY"'"}')
check "expired access token on payment create -> 401" "401" "$CODE"
BLOCKED_ROWS=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM payment_attempts WHERE \"idempotencyKey\"='$IDEMP_AR';")
check "401 created no payment row" "0" "$BLOCKED_ROWS"
# The client "refreshes" (new access token) and retries the SAME logical
# operation — same key. It must succeed as exactly one attempt.
req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"66.00","idempotencyKey":"'"$IDEMP_AR"'","categoryId":"'"$CATEGORY"'"}'
check "retry after auth renewal -> 201" "201" "$CODE"
PID_AR=$(val id)
req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"66.00","idempotencyKey":"'"$IDEMP_AR"'","categoryId":"'"$CATEGORY"'"}'
check "second retry returns the SAME attempt (no duplicate)" "$PID_AR" "$(val id)"
AR_ROWS=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM payment_attempts WHERE \"idempotencyKey\"='$IDEMP_AR';")
check "exactly one row for the auth-retry key" "1" "$AR_ROWS"
AUTH="$SAVE_AUTH"

echo "== reconciliation sweep (compiled job, real DB) =="
# Drive a payment to AWAITING_CONFIRMATION, backdate its timeout clock instead
# of waiting 10 real minutes, then run the COMPILED ReconciliationJob.sweep()
# from dist against the disposable DB. The API's own 5-minute cron may race
# this — the conditional updateMany makes that safe, and the event-count
# assertions below hold either way.
SAVE_AUTH="$AUTH"; AUTH="$AUTH_R"
IDEMP_RC="pay_recon_${RUN}_0001"
req POST "$API/payments" '{"upiId":"canteen@okaxis","amount":"33.00","idempotencyKey":"'"$IDEMP_RC"'","categoryId":"'"$CATEGORY"'"}'
check "recon payment created -> 201" "201" "$CODE"
PID_RC=$(val id)
req POST "$API/payments/$PID_RC/return" '{"outcome":"app_returned_ok"}'
check "recon payment return -> AWAITING_CONFIRMATION" "AWAITING_CONFIRMATION" "$(val status)"
AUTH="$SAVE_AUTH"
docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "UPDATE payment_attempts SET \"awaitingSince\" = now() - interval '15 minutes' WHERE id='$PID_RC';" > /dev/null
node -e "const{ReconciliationJob}=require('./dist/payments/reconciliation.job.js');const{PrismaClient}=require('@prisma/client');(async()=>{const j=new ReconciliationJob(new PrismaClient());await j.sweep();process.exit(0);})().catch(e=>{console.error(e);process.exit(1);})" > /dev/null 2>&1
check "sweep exit 0 (compiled job ran against real DB)" "0" "$?"
RC_STATUS=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT status::text FROM payment_attempts WHERE id='$PID_RC';")
check "stale attempt moved to NEEDS_REVIEW" "NEEDS_REVIEW" "$RC_STATUS"
RC_EVENTS=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM payment_events WHERE \"paymentAttemptId\"='$PID_RC' AND \"toStatus\"='NEEDS_REVIEW' AND reason='sweep_timeout';")
check "exactly one sweep_timeout audit event" "1" "$RC_EVENTS"
# A second sweep must be a no-op (idempotent) and must never create expenses.
node -e "const{ReconciliationJob}=require('./dist/payments/reconciliation.job.js');const{PrismaClient}=require('@prisma/client');(async()=>{const j=new ReconciliationJob(new PrismaClient());await j.sweep();process.exit(0);})().catch(e=>{console.error(e);process.exit(1);})" > /dev/null 2>&1
RC_EVENTS2=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM payment_events WHERE \"paymentAttemptId\"='$PID_RC' AND \"toStatus\"='NEEDS_REVIEW' AND reason='sweep_timeout';")
check "second sweep adds no duplicate event (idempotent)" "1" "$RC_EVENTS2"
RC_EXP=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT count(*) FROM expenses WHERE \"paymentAttemptId\"='$PID_RC';")
check "sweep never creates an expense" "0" "$RC_EXP"
RC_STILL=$(docker exec -i thassapay_db psql -U thassapay -d thassapay_audit_test -At -c "SELECT status::text FROM payment_attempts WHERE id='$PID_RC';")
check "sweep never silently marks SUCCESS" "NEEDS_REVIEW" "$RC_STILL"

echo
echo "================ INTEGRATION RESULT: PASS=$PASS FAIL=$FAIL ================"
[ "$FAIL" -eq 0 ]
