# xland-server

**Hosting hiện tại — 22/10/2026:** Northflank phục vụ
`https://p01--xland--y56gnzgzjsqm.code.run`, thay Railway trong thời gian sự cố.
Admin web: `https://xland-alpha.vercel.app/admin`.
Xem [cấu hình và vận hành Northflank](docs/NORTHFLANK.md).

Admin fullstack (22/10/2026): namespace mới `/api/v1/admin`, migration `0012_admin_workspace.sql`, PostgreSQL RBAC/audit và upload Supabase. Chạy `npm run admin:dev` ở cổng 3005; `npm run test:admin` kiểm thử với PostgreSQL cô lập. Tài khoản đã provision theo yêu cầu: `admin / 123456`. Xem [kế hoạch, API và vận hành Admin](../xland-website/xland/docs/ADMIN.md). Các API mobile hiện hữu giữ nguyên.

## Admin audit fixes — 22 October 2026

Admin uploads now use private staging plus `POST /api/v1/admin/uploads/finalize`.
Apply migrations 0013–0014 and provision the staging bucket with the guarded
`npm run admin:setup` before deploying the matching backend and website. Numeric
and bigint Admin fields require decimal strings. Editing nested video media
requires its own `_version`, returned by GET video.

QA fixtures are now self-contained and checksummed: see
[tests/fixtures/README.md](tests/fixtures/README.md). `npm run test:admin` uses an
isolated local PostgreSQL DB and a Storage HTTP double; the explicit
`node --import tsx scripts/admin-verify-upload.mjs` additionally checks real
Supabase uploads and cleans only its own object keys. It uses the private local
Storage environment overlay and never writes business rows.

Public author profile endpoints are implemented in source. Production completion
requires a successful backend deployment and `npm run verify:authors`; the client
uses these endpoints directly with no compatibility fallback. See
[author API and rollout acceptance](docs/AUTHOR_PROFILES.md).

Share implementation (21 October 2026): public content pages, Open Graph and native
app association endpoints are deployed on Railway. Android verified links cover
this workstation's debug certificate and the internal release certificate.
See [sharing architecture and live verification](docs/SHARING.md).

## Current internal release — 19 October 2026

The API is deployed on Railway: [readiness](https://xland-server-production.up.railway.app/health/ready). See [delivery milestones and release operations](docs/INTERNAL_RELEASE.md). The released mobile app connects to Railway and does not require a PC server. Earlier local setup instructions follow.

Node24.19.0/npm11.17.0. API `/api/v1`; opaque sessions24h. C-3 remains the historical G1 baseline in the Agent C snapshot. `../brain/02_API_CONTRACT.md` is **C-4 LOCKED by A RV-P2-003/baseline08**; its candidate header bytes remain unchanged to preserve the hash. Runtime coverage distinguishes59 successful HTTP paths and4explicit gates; it does not certify provider playback, live payments or UI acceptance.

The A-09 Supabase mock target is provisioned: PostgreSQL17.6, environment `supabase_mock`, approved fingerprint03d6c297d77a1029, xland/xland_meta only. A-10 accepts W2 backend/domain/data. Start a local preview per machine session; a previous background listener does not survive restart.

## W3 repeatable preview (no migration or seed)

W4: `video_player` is pinned by mobile to2.11.1. C-4 is **LOCKED by A RV-P2-003/baseline08**; its original candidate header bytes remain unchanged. Phase3 stays closed. For synthetic video, first run `node scripts/media-demo-provider.mjs` in an owned foreground terminal; video5560 is project-generated MP4 with provenance in `demo-assets/w4/manifest.json`. Then, when intentionally restarting the owned preview, use `node scripts/preview.mjs start --demo-media` (optional `--demo-media-scenario=expired` or `unavailable`). This only sets development composition flags; no seed/migration/API/policy change. Default start keeps media disabled. Current listeners are not restarted merely by editing this script.

From `C:\OwnProject\XLAND-PROJECT\xland-server`:

```powershell
node scripts/preview.mjs start
node scripts/preview.mjs status
node scripts/preview.mjs stop
```

One `start` launches the API3001 and Flutter `lib/bootstrap/dev_main.dart` web-server5555. Open `http://127.0.0.1:5555`. Set `XLAND_FLUTTER_SDK` to an installed SDK folder if it differs from the current XLandTools SDK. `start --api-only` omits Flutter. Workers are hidden on Windows. The supervisor reads `.env.supabase-mock` privately, verifies environment/fingerprint, binds loopback, checks readiness200, canonical list/detail and both guest calculator methods before Ready. It does **not** migrate/reseed. The Flutter process receives the API base URL, never the private DB config. Private demo login remains `.local/supabase-demo-login.json`.

`.local/preview.json` holds supervisor PID, Flutter PID and a private control nonce/pipe; don't print/copy that file. `stop` authenticates to that supervisor and requests Flutter quit, HTTP close and database pool close. It never kills a process selected by port. `.local/preview.log` contains redacted event names/codes; start failures return nonzero. Startup deadline120s; stop deadline15s. A busy API/web port or lock is refused. Inspect `Get-NetTCPConnection -State Listen -LocalPort 3001,5555` and the owning process; an HTTP200 on an occupied port does not confer ownership. If reboot leaves stale lock/state, verify the recorded PID is absent (or unrelated by executable/command line), archive the private files and remove only those stale `.local/preview.lock`/`.local/preview.json` files; do not kill an unrelated/reused PID. Then start again.

Browser CORS permits exactly `http://127.0.0.1:5555` and `http://localhost:5555`. Pick one origin consistently: web secure-storage uses the browser origin's WebCrypto/localStorage, and changing host/port/browser profile loses access to that origin's session. Localhost is for local preview; nonsecure LAN HTTP is not a supported web secure context. Browser storage can be cleared/denied; show typed storage failure, no plaintext fallback. API restart retains sessions in Supabase until expiry/revoke. Android/iOS use the existing secure-storage plugin; native persistence/restart/locked-device acceptance remains pending.

For Android emulator, run Flutter separately with `--dart-define=XLAND_API_BASE_URL=http://10.0.2.2:3001/api/v1`; alternatively an authorized USB debug session can use `adb reverse tcp:3001 tcp:3001` and the localhost default. Confirm reachability/platform debug cleartext config on the selected device; this is not native acceptance. iOS simulator can use host loopback on its Mac host. Physical-device LAN/HTTPS, entitlements/signing/firewall require separate configuration; this script binds loopback and does not change firewall or release settings.

## Explicit provisioning tools (not startup)

Only use these for an authorized provisioning run, not each preview start:

```powershell
node scripts/start-evidence-run.mjs
node scripts/supabase-preflight.mjs
node --import tsx scripts/provision-supabase-mock.ts
node --env-file=.env.supabase-mock --import tsx src/server.ts
node --import tsx scripts/verify-supabase-api.ts
```

Remote tooling uses the current private `.local/w2-run.json` for versioned evidence; initialize a new run/snapshot before reusing it in a later task. It reads the shared `.env` without changing the original credentials, verifies the A-09 fingerprint/current namespace/ledger, applies additive SQL and seeds without overwriting user mutations. When XLand already contains data, it takes an XLand-only private logical backup and verifies restore into a new local test DB before migration. Never point database-creating integration runners at Supabase. Private demo login is available at ignored `.local/supabase-demo-login.json` (no DB URI); enter it privately into the UI, never copy credentials into source/Markdown. `.env.supabase-mock` remains server-only.

## W3 isolated scenarios and provider demo

```powershell
$env:XLAND_EVIDENCE_DIR = "C:/OwnProject/XLAND-PROJECT/brain/logs/agent-c/evidence/P2-W3/reviewer-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))"
node scripts/test-postgres.mjs scenarios
node --import tsx scripts/verify-narrow-runtime.ts
node --test scripts/local-runner.test.mjs
# Optional synthetic provider, foreground; Ctrl+C stops this owned process:
node scripts/demo-provider.mjs
```

Scenarios create a fresh loopback `xland_test_*` DB, move its demo slot/event to now+7days at10:00 Asia/Ho_Chi_Minh and exercise41 success/error/ownership/retry cases. Full-slot/sold-out/past-date controls affect only that test DB. Private `.local/test-context.json` is replaced per run; run runners sequentially. Narrow-runtime proof uses that isolated context and a generated nonbypass/nonowner login, not the shared remote credential. Recovery probing waits at most90s, existing running/recovering clusters are not started twice, each test child has180s timeout, owned cluster stop is bounded. No reset/DB deletion. Namespace guard stays inside C evidence; reviewers can copy completed evidence to their namespace afterward.

Synthetic provider is loopback5560 with a clearly labelled project-created text guide, generated WAV and browser canvas video demo. It is separate from application repositories/L02. The Dart demo adapter validates local origin, expiry, marker/MIME/size, cancels timed-out streams and sends no session token. `verify-demo-provider.mjs` verifies HTTP→Dart→temporary-file write/read/delete plus errors/ranges. Demo, preview verification and cold/warm probes honor `XLAND_EVIDENCE_DIR` inside C evidence, otherwise create a fresh timestamped W3 directory; exclusive artifact writes refuse overwriting an existing proof. Its generated provenance manifest records exact bytes/hashes. No production URL, legal evidence, signed entitlement, native playback or public provider acceptance is implied. See `brain/logs/agent-c/P2_W3_INTEGRATION_HANDOFF.md` for B scenarios and dependencies.

From this directory:

```powershell
npm ci
node --import tsx scripts/provision-local.mjs
npm run build
node --env-file=.env.local dist/server.js
```

The provisioner creates a private loopback cluster and `xland_dev_p2`, additive migrations and demo seed. Replays preserve existing records/passwords and user changes. Credentials are only in ignored `.env.local`/`.local`; never paste them into docs, clients or evidence. Existing `.env` is preserved. Development binds127.0.0.1 by default. Browser preview CORS origins are localhost/127.0.0.1:5555. `PUBLIC_BASE_URL` must be your controlled HTTPS host; unconfigured sharing fails explicitly. `AVATAR_ORIGINS` allowlists already hosted HTTPS origins; there is no upload API.

Before changing an existing local DB, provisioning writes an ignored `xland-logical-v1` snapshot, restores all36 tables into a new `xland_test_restore_*` DB and compares per-table data digests. Exact numeric strings, timestamp microseconds, JSON and bytea are preserved. Embedded binaries omit pg_dump; this is an application backup with versioned migrations, not a cluster dump. For a shared environment, first classify the target, take an operator-approved backup and plan restore in a new DB. Generic migration refuses an unclassified/unapproved development target and requires a backup file/digest for existing data. No DROP/TRUNCATE/reset is used. SQL failure rolls back transactionally; after success prefer an additive correction or validated restore into a new DB. Keep persistent CURSOR_SECRET with the private backup because retry snapshots use authenticated encryption.

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:contract
npm run check:foundation
npm run build
node scripts/smoke-startup.mjs
```

Integration/contract runners use real PostgreSQL, create a new `xland_test_*` DB per test file and seed twice. They never use shared DATABASE_URL or clear data. Test DBs are retained. Run the suites sequentially because provisioning replaces a private test context file. Contract checks use the checksummed mobile/contract snapshots committed here; set `XLAND_MOBILE_ROOT` to compare against an explicit mobile checkout. Foundation audit validates design fixtures only; startup diagnostic intentionally reports readiness503, while the real API checks PostgreSQL under the actual API role.

Runtime SQL uses transaction-local xland_api/auth/payment roles and verified user context. API role has FORCE RLS/column grants; public projections omit exact parcel coordinates, keys and contacts. Deployment requires reviewed narrow login credentials/secrets/provider config. Phase2 intentionally refuses production database classification; enabling/deploying production is a later gate.

Booking/event writes lock inventory and enforce idempotency. Bookings remain awaiting_deposit/unpaid with disabled payment placeholders; no hold expiry, cancellation/refund/no-show/charge basis is invented. Pending demo holds need future operator policy before live use. Event registration is pending with paymentMode=disabled. Consent settings do not imply push delivery. Support creates received tickets with no assigned advisor/chat/SLA promise.

A-06 closes SPEC-001 specification: N01 estimates and N02 saves exact BigInt/rational xland-loan-v1 results with VND_HALF_UP_MONTHLY_LAST_ADJUST. Monthly payment means first month; declining payments decrease. Save locks current price and persists recomputed input/result/version/snapshot atomically; retries retain the original response even after price change. N03 preserves historical result:null; N04 owner-only. A-07 adds optional clearAvatar/clearContactPhone flags only to Dart input, with pre-HTTP conflict validation; wire remains omit/null. B06/B07/P03 still return POLICY_NOT_CONFIGURED. Legal source/media/map/real share routes remain dependencies; unavailable URLs stay null. U02 stays reserved.

Internal `src/payments/simulation.ts` is absent from HTTP/runtime imports. It requires explicit TEST config and a loopback xland_test DB. Signed test events exercise duplicate/mismatch/late/race/rollback and verified receipt prerequisites; success advances only to pending_confirmation. It never contacts SePay or exposes an endpoint to set paid/confirmed.

For typed Dart → real HTTP/PG verification in isolated data:

```powershell
node --import tsx scripts/verify-postgres-foundation.ts
node --import tsx scripts/dart-api-server.ts
# Another terminal, from ../xland-mobile:
# dart run tool/api_modules_smoke.dart
```

Stop the owned test listener with Ctrl+C. B preview: Flutter target `lib/bootstrap/dev_main.dart`, Chrome/web port5555, `--dart-define=XLAND_API_BASE_URL=http://127.0.0.1:3001/api/v1` (the candidate dev default); Android emulator debug uses10.0.2.2:3001. Port3000 is the older local-DB preview and can be explicitly selected after updating that local DB. Token stays in data session storage; presentation receives typed repositories. Native secure storage/signing/device verification and P3 UI wiring/E2E remain separate acceptance work.

Test artifacts are versioned under Agent C evidence per run/case. Set `XLAND_EVIDENCE_DIR` inside the C evidence namespace to group a run; runners otherwise generate a fresh timestamped directory. No test overwrites the W1/A-review evidence. See P2_SUPABASE_READY.md, P2_C4_CANDIDATE_READY.md, P2_PROVIDER_DEPENDENCIES.md and P2_DEPLOYMENT_PRECHECK_RUNBOOK.md for current status and review gates.
