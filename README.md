# xland-server — Phase2 local API

Node24.19.0/npm11.17.0. API `/api/v1`; opaque sessions24h. C-3 remains the historical G1 baseline in the Agent C snapshot. `../brain/02_API_CONTRACT.md` is now **C-4 candidate**, pending B review/A final lock. Runtime coverage distinguishes59 successful HTTP paths and4explicit gates; it does not certify provider playback, live payments or UI acceptance.

The A-09 Supabase mock target is now provisioned: PostgreSQL17.6, environment `supabase_mock`, approved fingerprint03d6c297d77a1029, xland/xland_meta only. Metadata outside XLand is preserved. Current preview backend connects to Supabase at `http://127.0.0.1:3001/api/v1`:

```powershell
node scripts/supabase-preflight.mjs
node --import tsx scripts/provision-supabase-mock.ts
node --env-file=.env.supabase-mock --import tsx src/server.ts
node --import tsx scripts/verify-supabase-api.ts
```

Remote tooling uses the current private `.local/w2-run.json` for versioned evidence; initialize a new run/snapshot before reusing it in a later task. It reads the shared `.env` without changing the original credentials, verifies the A-09 fingerprint/current namespace/ledger, applies additive SQL and seeds without overwriting user mutations. When XLand already contains data, it takes an XLand-only private logical backup and verifies restore into a new local test DB before migration. Never point database-creating integration runners at Supabase. Private demo login is available at ignored `.local/supabase-demo-login.json` (no DB URI); enter it privately into the UI, never copy credentials into source/Markdown. `.env.supabase-mock` remains server-only.

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

Integration/contract runners use real PostgreSQL, create a new `xland_test_*` DB per test file and seed twice. They never use shared DATABASE_URL or clear data. Test DBs are retained. Run the suites sequentially because provisioning replaces a private test context file. Contract checks require sibling mobile/domain and brain baseline in this workspace. Foundation audit validates design fixtures only; startup diagnostic intentionally reports readiness503, while the real API checks PostgreSQL under the actual API role.

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
