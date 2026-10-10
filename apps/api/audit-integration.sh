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

req GET "$API/users/me"
check "GET /users/me -> 200" "200" "$CODE"
if grep -qiE 'refreshTokenHash|googleSub' "$BODY"; then bad "/users/me hides auth material" "leaked refreshTokenHash/googleSub"; else ok "/users/me hides refreshTokenHash+googleSub"; fi
if grep -q '"hostelBlock"' "$BODY"; then ok "/users/me still returns profile fields"; else bad "/users/me profile fields" "$(cat "$BODY")"; fi

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

echo
echo "================ INTEGRATION RESULT: PASS=$PASS FAIL=$FAIL ================"
[ "$FAIL" -eq 0 ]
