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

---

## 6. Re-inspection — 2026-10-19 (still BLOCKED)

The environment was re-checked during the git-checkpoint / CI session. Nothing
below is device evidence; the physical-device requirement stays **BLOCKED**.

| Item | Re-check finding |
| --- | --- |
| Android SDK | still absent (`ANDROID_HOME` unset, no SDK directory) |
| Emulator | none — no SDK emulator installed; installing large SDK components was out of scope for this session |
| adb | **no longer on PATH** — the GlideX-bundled adb seen on 2026-10-18 could not be located this time; with no adb there is no device channel at all |
| Connected devices | none (no adb; previously confirmed empty twice) |
| Java | 22.0.2 present |
| Expo tooling | legacy global `expo-cli` 0.18.31 (deprecated, refuses Node ≥ 17) + `eas-cli` 24.0.0; project-local Expo SDK 51 unchanged |
| Host LAN IPv4 | changed since §2 (DHCP): now `192.168.137.1` / `172.18.160.21` — substitute the current value in the §2 commands |
| Mobile env | still no `apps/mobile/.env`; only `.env.example` (no secrets committed) |

**Static verification of the committed token path (C1) — code-level, not device
behavior:** in the committed source, the access/refresh pair is written only via
`saveSecure` → `expo-secure-store` as one serialized pair under a single key;
every read/write/delete throws `SecureStorageError` when SecureStore is
unavailable (no localStorage/AsyncStorage fallback exists); the in-memory map in
`storage.ts` caches only non-secret UI state (profile, flags), never tokens.
This is source inspection plus mocked unit tests — it does **not** establish
Android Keystore behavior.

Quality gates at this checkpoint: typecheck/lint/build exit 0, **270** unit
tests pass (197 API + 63 mobile + 5 + 5), live backend integration 88/88 —
all backend/mocked evidence, no device evidence. Requirement status: Tests A–E
remain BLOCKED pending an attached Android device.

---

## 7. Android environment bring-up — 2026-10-19 (emulator ✓, Expo Go runtime BLOCKED)

The Android blocker was attacked directly this session: the SDK was installed
and an emulator was booted, so "no SDK/emulator possible" no longer applies.
The remaining blocker moved one layer up: **Expo Go 2.31.2 (the SDK 51 build)
crashes natively before any app UI can render** — with a deterministic,
app-independent signature.

### 7.1 What was installed / booted (outside the repo)

| Component | Location | Version |
| --- | --- | --- |
| Android cmdline-tools | `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\12.0` | 12.0 |
| platform-tools (adb) | `%LOCALAPPDATA%\Android\Sdk\platform-tools` | 35.0.2 |
| Emulator + system image | `%LOCALAPPDATA%\Android\Sdk` | API 34 (Android 14), x86_64 |
| AVD | `emulator-5554`, WHPX hardware acceleration | boots headless in ~60s |
| Expo Go | installed on the AVD from `expo.dev/go` | `Exponent-2.31.2.apk` (SDK 51) |

`adb reverse tcp:8081 tcp:8081` + `adb reverse tcp:3000 tcp:3000` wire the
emulator to Metro and the local API — no LAN/firewall steps needed on an
emulator.

### 7.2 Blocking defect found & fixed: app could not bundle at all

With the emulator ready, the app failed to bundle for a repo-layout reason
independent of Android: with npm workspaces hoisting `expo` to the repo root,
Expo's default entry `node_modules/expo/AppEntry.js` does
`import App from '../../App'`, landing on `<repo>/App.tsx` — which does not
exist (the app is `apps/mobile/App.tsx`). **The committed app could not start
via Metro in this monorepo.**

Fix (committed on this branch): explicit entry `apps/mobile/index.js`
(`registerRootComponent(App)` from `./App`) + `"main": "index.js"` in
`apps/mobile/package.json`. Verified: Metro serves the launch asset
`GET /index.bundle?platform=android` → **HTTP 200, 691 modules, 6.2 MB**, with
`RootNavigator`/`AuthContext`/`saveSecure` present. Expo SDK 51's built-in
monorepo resolution handles `node_modules` — no custom `metro.config.js` is
needed; none is committed.

### 7.3 The remaining blocker: Expo Go 2.31.2 native crash (deterministic)

With Metro + API up and the REAL app bundled through the committed entry,
Expo Go loads the manifest, starts Hermes, runs the bundle — then dies before
first paint. 4/4 launches, identical signature (logcat, sanitized):

```
E ReactNativeJS: Error: Exception in HostObject::get for prop 'UIManager':
                  java.lang.NullPointerException, js engine: hermes
E … ClassNotFoundException: com.facebook.react.devsupport.DevLoadingViewController
W … Runtime exception in RNObject when calling method setDevLoadingEnabled:
                  java.lang.NullPointerException
E UIManagerHelper: ReactNoCrashSoftException: Cannot get UIManager because the
                  context doesn't contain an active CatalystInstance.
  … ReactInstanceManager.attachRootViewToInstance
  … ReactRootView.onMeasure
E AndroidRuntime: FATAL EXCEPTION: main
  java.lang.IllegalStateException: Unable to attach a rootView to ReactInstance
  when UIManager is not properly initialized.
```

Bisect to prove it is NOT app logic: the entry was temporarily swapped for a
minimal RN-only probe (`<View><Text>PROBE_OK</Text></View>`, zero app modules)
— **same crash, same signature**. The bundle itself is healthy (HTTP 200,
644 modules for the probe; 691 for the real app). The failure is inside
Expo Go's host runtime: the CatalystInstance never becomes active, the
UIManager host object throws NPE on first access, root-view attach fails.

Corroboration: an independent project (Oct 2026) hit the identical
`MainApplication cannot be cast to ReactApplication` / UIManager-init crash on
SDK 51 + Expo Go on a *physical* device and classified it as "an Expo Go
SDK 51 runtime failure, not an app-logic bug"; their fix was upgrading the app
to SDK 57 — an SDK upgrade is explicitly out of scope here ("do not rebuild
the project from scratch").

### 7.4 Status of Tests A–E

Still **BLOCKED** — not for lack of a device (the AVD is a working Android 14
device), but because the only SDK-51-compatible runner (Expo Go 2.31.2)
crashes natively before any app screen renders, and the crash reproduces with
a bare React Native tree.

**Unblock paths (in order of preference):**

1. **Dev build instead of Expo Go** — `npx expo prebuild` +
   `gradle assembleDebug` (or an EAS build with an Expo account), install the
   debug APK on the AVD. The crash is in Expo Go's host code; a self-built
   app links its own React Native, sidestepping it. This is native-toolchain
   work (~10+ min Gradle + SDK licenses) and was the timeboxed cut-off.
2. **Physical device with Expo Go 51.0.x** — if the crash is specific to
   Expo Go's x86_64 build on API 34, an ARM device may behave differently
   (the external corroboration suggests it will not).
3. **SDK upgrade to a supported line** — out of scope for validation.

No production-readiness claim is made. Everything above is environment
evidence; Tests A–E still have no device evidence rows.
