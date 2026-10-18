# ThassaPay — Phase 6: Real-Device Authentication Validation

**Status: BLOCKED — no physical Android device attached to the build machine.**

No physical-device scenario (Tests A–E) could be executed. This document records
the exact environment inspected, the precise blocker, the setup required to
unblock, and the regression evidence that *was* obtained. Nothing below is
claimed as device-verified.

---

## 1. Environment inspected

| Item | Finding |
| --- | --- |
| Git branch | `feat/auth-refresh-token-rotation` (working tree dirty, Phases 4–5 uncommitted, as instructed) |
| Expo SDK | 51.0.0 (`~51.0.0`) |
| React Native | 0.74.5 |
| `expo-secure-store` | `~13.0.2` |
| `EXPO_PUBLIC_API_URL` | **Not set.** No `apps/mobile/.env` exists; `config.apiUrl` falls back to `http://localhost:3000` |
| Backend | Boots from `apps/api/dist/main.js`; `/health` returns `200 {"status":"ok"}` |
| LAN address of host | `172.18.161.5` (Wi‑Fi). `/health` reachable at `http://172.18.161.5:3000` → `200` |
| Host OS | Windows; Java 22, eas-cli 24.0.0 present |
| Android SDK | **Not installed** (`ANDROID_HOME` unset, no SDK dir) |
| adb | ASUS GlideX bundled `adb 31.0.2` present; daemon starts on tcp:5037 |

### Device availability (the blocker)

```
$ adb devices -l
List of devices attached
(empty)

$ adb shell getprop ro.product.model
adb.exe: no devices/emulators found
```

Zero devices on both reads. There is no physical Android device, no emulator,
and no Android SDK to create one.

### Expo Go compatibility (determined, not assumed)

`expo-secure-store@~13.0.2` **is listed in `expo/bundledNativeModules.json`**,
i.e. it ships inside Expo Go for SDK 51. Therefore:

- **A development build is NOT required** to test SecureStore for this SDK.
- **Expo Go 51.0.x** on the phone is sufficient.
- The blocker is solely the absent device, **not** SDK/Expo Go incompatibility.

> Note: `expo-doctor` reports 3 pre-existing project issues unrelated to this
> phase (`@types/react-native` installed directly; `typescript@5.9.3` vs expected
> `~5.3.3`). These predate Phase 6 and are not device blockers, but should be
> cleaned up in a dependency-hygiene pass.

---

## 2. Setup required to unblock (exact commands)

Prerequisite: an Android phone on the **same Wi‑Fi network** as the build
machine, with **Expo Go 51.0.x** installed.

**A phone cannot use `localhost`** — that resolves to the phone itself. The
phone needs the host's LAN IP.

```bash
# 1. Start Postgres + Redis (from repo root)
docker compose up -d

# 2. Apply migrations + start the API (from apps/api)
cd apps/api
npm run build
node dist/main.js          # serves :3000

# 3. Confirm the API is reachable from the LAN (from the build machine)
curl http://172.18.161.5:3000/health    # expect {"status":"ok"}

# 4. Start Expo, binding the API to the host LAN IP (from apps/mobile)
cd apps/mobile
EXPO_PUBLIC_API_URL=http://172.18.161.5:3000 npx expo start
```

Then scan the QR code with Expo Go. Replace `172.18.161.5` with the host's
current Wi‑Fi IPv4 if it changes (it is DHCP-assigned).

If the phone cannot reach the API:
- Allow Node through the Windows Firewall on the private network, or
- Confirm phone and host are on the same subnet (not a guest/iot VLAN).

**No native APK was built.** Android SDK is absent; an EAS cloud build would
require an Expo account login that was not available/was not created.

---

## 3. Physical-device test results

Every scenario below is **BLOCKED** for the same root cause: no device attached.

### Test A — Login and secure persistence — **BLOCKED**
- Steps 1–6 (login, secure persistence, restart restores session, no insecure fallback) not executed.
- Blocked at: no device to open the app on.
- Mock-level equivalent exists in `__tests__/secure-session.spec.ts` (restart restores from SecureStore) and `__tests__/secure-storage.spec.ts` (no insecure fallback, SecureStore-unavailable throws). **These are NOT device evidence.**

### Test B — Access-token expiration — **BLOCKED**
- Not executed. Single-flight refresh + retry-once + replacement-pair persistence are covered by `__tests__/auth-refresh.spec.ts` against a mocked fetch/SecureStore only.

### Test C — App lifecycle — **BLOCKED**
- Background/foreground, force-stop, network loss/recovery, refresh failure, SecureStore failure-injection: not executed on a device. Failure-injection paths are unit-tested via the SecureStore double (`__tests__/secure-storage.spec.ts`).

### Test D — Logout — **BLOCKED**
- Online/offline logout, server-side revocation, local clearing, forced re-login: not executed on a device. Server-side revocation IS verified at the API level by `apps/api/audit-integration.sh` (88/88, incl. logout/logout-all/restart-persistence) — that is backend evidence, not device evidence.

### Test E — Payment safety regression — **BLOCKED** (device)
- Idempotency-key stability across auth retry, no duplicate on interrupted request, UPI-return never self-declares success, `NEEDS_REVIEW` still works: not executed on a device.
- Backend state-machine + idempotency + concurrency invariants ARE verified by `apps/api/audit-integration.sh` (88/88) and `apps/api/test/payments-service.spec.ts`. No real money used anywhere; only the local `thassapay_audit_test` database and mock payment flows.

---

## 4. Evidence obtained (non-device, sanitized)

No JWTs, refresh tokens, OTPs, banking details, or personal data appear in this
document or the logs below.

| Check | Command | Exit | Result |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | 0 | all workspaces pass |
| Lint | `npm run lint` | 0 | clean |
| Full test suite | `npm test` | 0 | 245 passing (182 API + 53 mobile + 5 + 5) |
| Build | `npm run build` | 0 | API + packages build |
| Expo config | `npx expo config --type introspect` | 0 | `expo-secure-store` plugin resolves & registers |
| Backend health (LAN) | `curl http://172.18.161.5:3000/health` | 0 | `200 {"status":"ok"}` |
| Device attached | `adb devices` | 0 | **empty — 0 devices** |

---

## 5. Conclusion

Phase 6 **cannot be completed in this environment**. Per the task's own rule —
*"Do not report production readiness based on mocked SecureStore tests or Expo
Go alone"* — no production-readiness claim is made.

**To finish Phase 6**, attach an Android device (Expo Go 51.0.x), follow §2, and
execute Tests A–E, replacing each BLOCKED row with PASS/FAIL plus sanitized
logs. iOS remains a separate, also-untested platform.
