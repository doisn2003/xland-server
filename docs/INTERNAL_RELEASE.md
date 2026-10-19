# Internal release 0.2.0 — backend

19 October 2026. Railway is live; the Android APK has been handed to the owner for testing. Phone acceptance remains pending.

## Milestones

1. **Phase 3 features:** Google authentication/session handling, social/property/community APIs, and administrative-area Geoapify maps. Phone OTP remains disabled without an approved provider/Brandname.
2. **Data and verification:** original generated media/provenance, mock enrichment and Supabase Storage tooling, migration/probe helpers and integration/regression scenarios.
3. **Phase 4 delivery:** Docker, least-privilege database login, Railway configuration, deployment and HTTPS smoke helpers; Android release lives in xland-mobile.

## Deployment

- API: <https://xland-server-production.up.railway.app/api/v1>
- Readiness: <https://xland-server-production.up.railway.app/health/ready>
- Project `xland-internal`, service `xland-server`, environment `production` (product scope is still an internal pilot).
- Accepted deployment `1f4abe50-81e6-420d-90f4-857231954f64`, Singapore, one replica, 1 vCPU / 1 GB allocation limit. Allocation limits are not monetary caps; monitor the existing Railway account's usage.
- Node 24.19.0, lockfile install, TypeScript build. Runtime uses user `node`, listens on PORT and never migrates/seeds at startup.

Put secrets in Railway Variables. Runtime database credentials are separate from migration/seed credentials. Keep CURSOR_SECRET stable. TRUST_PROXY_HOPS=1 applies to the Railway edge; local default is 0. Add explicit CORS origins when integrating web/admin.

`scripts/release/stage.mjs` copies only allowed source/build files into a separate staging directory and records hashes. Upload that clean directory using the official Railway CLI with explicit target IDs. Never upload the workspace, `.local`, `.env*`, credentials or backups. Current helper IDs/paths target this pilot; review for subsequent releases. Deployment settings use `scripts/release/railway-settings.graphql` and JSON; new Railway services no longer accept the previous railway.json workflow.

## Checks and recovery

Lint/typecheck/build and 21 unit tests passed. Readiness and 22 groups of live HTTPS checks passed, including two-user isolation, durable social state, booking idempotency and disabled payments. Live smoke creates dedicated synthetic users/slot, then disables accounts, revokes sessions, releases the hold and preserves audit. It writes test data and must not target an unrelated environment.

For a future regression, use Railway's rollback/redeploy action on a successful deployment and recheck readiness/API. This is the first successful baseline; there is no earlier successful version yet. Code rollback does not restore database contents or Variables. No destructive rollback drill was performed.

Shared evidence/backlog/runbook remain in the workspace's `../brain/`, outside this Git repository. No live customer data or private credentials are included here.

## Pilot limits

The catalogue is mock content. Visit requests are not confirmed real appointments. Payment/SePay and SMS are off. Private documents, web sharing/app links, iOS and extended native cases remain deferred; chatbot/admin/NFT are later work. Google/video/maps on the exact release APK await the owner's phone test.
