# Northflank deployment — 22 October 2026

Service: `doisn2003s-team/default/xland`, GitHub `doisn2003/xland-server`, branch
`main`, Dockerfile build, public HTTP container port 8080, HTTPS edge.

- Origin: `https://p01--xland--y56gnzgzjsqm.code.run`
- API: `/api/v1`; Admin: `/api/v1/admin`
- Readiness: `/health/ready`; process liveness: `/health/live`
- Admin website: `https://xland-alpha.vercel.app/admin`

Northflank probes use HTTP port 8080: readiness every 15 seconds (initial delay
5 seconds), liveness every 30 seconds (initial delay 30 seconds), timeout 10
seconds and three failed probes before the corresponding action.

The service continues using the existing Supabase target, migrations 0012–0014,
accounts, private staging bucket and verified media upload flow. Startup does
not run provisioning, migrations or resets. The database classification remains
`supabase_mock` because this is the existing internal pilot dataset.

## Runtime environment

24 variables are installed in Northflank runtime Environment. Values containing
credentials remain in the provider and ignored local configuration only:

```text
NODE_ENV PORT BIND_HOST DATABASE_URL DATABASE_ENVIRONMENT
DATABASE_APPROVED_FINGERPRINT CURSOR_SECRET XLAND_API_MODE
XLAND_GOOGLE_LOGIN_ENABLED GOOGLE_AUTH_AUDIENCES XLAND_PHONE_OTP_ENABLED
SMS_BRANDNAME_APPROVED MAPS_EMBED_ENABLED MAPS_GEOAPIFY_ENABLED
MAPS_GEOAPIFY_API_KEY MAPS_GEOAPIFY_DAILY_CREDITS CORS_ORIGINS
TRUST_PROXY_HOPS XLAND_RELEASE_VERSION PUBLIC_BASE_URL
SHARE_ANDROID_PACKAGE SHARE_ANDROID_SHA256 SUPABASE_URL SUPABASE_SECRET_KEY
```

Runtime uses the existing narrow `xland_runtime_internal` login with explicit
SET membership for API/auth/maps/admin roles. It has no inherited data access,
superuser or schema provisioning privileges. Google login and Geoapify are
enabled; phone OTP and live payments retain their disabled state.

`PUBLIC_BASE_URL` is the Northflank origin. Android certificate fingerprints are
the existing debug and release fingerprints. CORS allows the production Vercel
origin plus the existing local Flutter preview origins. Mobile native HTTP is
HTTPS and does not require browser CORS.

## Vercel

Production project `doisns-projects/xland`, GitHub `doisn2003/xland`, branch main:

```dotenv
XLAND_ADMIN_API_URL=https://p01--xland--y56gnzgzjsqm.code.run/api/v1/admin
XLAND_ADMIN_WEB_ORIGIN=https://xland-alpha.vercel.app
```

These are server-side Next.js variables. No DB credentials or Storage service
keys belong in Vercel or `NEXT_PUBLIC_*`. Redeploy after changing environment.

## Verification and rollback

Check live/ready, public catalog/feed, author profiles, maps, Google capability,
admin login, session protection, schema, lists and verified Storage uploads.
The rollout checks passed for 14 public author profiles and their video feeds,
public sharing metadata/images, Vercel login/protected routes and three verified
uploads (PNG, MP4, private PNG). Probe objects were removed; upload/audit metadata
remains. No business records were created or edited by these hosting checks.
Keep the existing database and Storage when changing hosts. To return to Railway,
deploy the matching server source there, restore provider variables and change
Vercel/mobile API plus canonical sharing/App Links together. Verify before
switching clients; changing a URL does not migrate data or rotate credentials.

## Latency correction — 22 October 2026

The initial deployment passed functional probes but the property form took
23.34 seconds to become usable. Direct API measurements were 8.25 seconds for
Admin schema and about 5 seconds for a property record. The database pooler is
in AWS ap-south-1 (Mumbai), while this free Northflank service is in US Central;
sequential database round trips amplified that distance.

Admin schema now reads all 15 modules in one catalog query. Session validity and
Admin membership are checked together on every request. Database role, UTC and
actor settings are applied in one parameterized, transaction-local query, and
idle connections remain available for 60 seconds. Transaction rollback, RLS,
revocation and write-time Admin checks remain enforced. The website loads
schema, property data and locations in parallel, with no caching of sessions or
business records. These changes do not require a provider plan upgrade.
