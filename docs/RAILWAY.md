# Railway production — 26 October 2026

The production hosting target has returned to the existing Railway service:

- Project: `xland-internal` (`b111bc9d-7eb1-496c-b70d-204f6a6c42f2`).
- Service: `xland-server` (`22e32363-d4d9-4f4a-80b9-cebaab3a3891`).
- Environment: `production` (`1948710d-9ce9-4387-aef9-6bb67daf1c60`).
- Origin: https://xland-server-production.up.railway.app
- API: https://xland-server-production.up.railway.app/api/v1
- Readiness: `/health/ready`; liveness: `/health/live`.

Deployment `7d751d18-bb7a-4fb8-9051-8d7c2722f781` built the runtime source from
commit `8f288dc7f1b43a49d9c34111258e6bb44edddf13`. Its Docker upload contains only
the 64 allowlisted source/build/public files, with a SHA-256 manifest retained
in ignored local release evidence. No `.env`, signing configuration or SDK was
uploaded. Railway reported `SUCCESS` and the container started on port 8080.

The existing Singapore region, one replica, 1 vCPU/1 GB limits, Dockerfile,
start command and 180-second readiness healthcheck are retained. Serverless is
disabled. No plan upgrade or payment was performed. The dashboard displayed a
past-due billing warning even though this deployment succeeded; the account
owner should resolve billing to avoid service disruption.

## Configuration and data

The 24 intended runtime variables were compared against the existing Northflank
configuration. Database target, narrow runtime login, cursor secret, Google,
maps and signing fingerprints remain identical. Railway already had the correct
`PUBLIC_BASE_URL`; CORS, Supabase Storage configuration and the release marker
were updated. Runtime secrets remain in provider configuration and ignored local
files. The release marker is `0.2.4-railway.20261026`.

No migrations, provisioning, business-record edits or database resets are part
of this move. The existing dataset classification remains `supabase_mock`.
Google login remains enabled; phone OTP and live payments remain disabled.

Website production must use the server-only variable:

```dotenv
XLAND_ADMIN_API_URL=https://xland-server-production.up.railway.app/api/v1/admin
XLAND_ADMIN_WEB_ORIGIN=https://xland-alpha.vercel.app
```

Redeploy Vercel after changing the API URL. Website user routes retain their
existing behavior; this hosting change does not replace their fixture data.

Mobile API, Dart sharing host and Android manifest host move together; see
`../../xland-mobile/docs/RAILWAY.md`. Existing installed Northflank APKs need the
new APK because the API endpoint is compiled into the app.

## Verification and rollback

The initial Railway checks passed: 18 backend/API/admin requests, all 14 feed
author profiles and video endpoints, crawler sharing metadata/images, and
Android assetlinks. Admin checks create/revoke only a test login session.

Northflank remains available for rollback and for older installed APKs. To roll
back, restore Vercel's previous server-only API URL and redeploy, then build the
explicit `Xland Northflank` mobile configuration. Its Dart and Gradle sharing
host overrides are included. Both hosts continue using the same Supabase data.
Do not reset the database when changing hosts. Final rollout evidence lives in
`../../brain/reports/railway-20261026/`.
