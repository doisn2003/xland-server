# Public author profiles

`GET /api/v1/authors/:authorId` returns a public user profile even when the user
is not a consultant. `consultantId` is nullable and, when present, equals that
author's own ID. It is not the assigned consultant from a video property's row.

`GET /api/v1/authors/:authorId/videos` filters by `videos.author_id`, supports
cursor pagination and keeps PostgreSQL RLS visibility. The API query allowlist
accepts pagination for this route. Public video and follower counts are computed
by the backend; private contacts are excluded. No migration or seed is required.

The client uses these endpoints directly. There is no client compatibility scan
or video-based profile reconstruction. A missing endpoint is a rollout failure.

## Validation and deployment

Run lint, typecheck, unit tests, `npm run test:authors` and build before pushing.
The author integration runner provisions an isolated local PostgreSQL database.
It tests ordinary posters, consultants, hidden videos, paging, caller-specific
follow state, and invalid or missing author IDs.

Production acceptance is `npm run verify:authors`. It performs public GETs only,
discovers authors through the actual feed, requires both author endpoints and
checks identities, counts and pagination. Reports go to
`.local/release/author-profiles-acceptance/author-profiles.json`; override the
destination with `XLAND_AUTHOR_EVIDENCE`. No client fallback is accepted by this
check. Do not mark the production fix complete until this command passes against
the deployed commit.

Railway was previously deployed through CLI uploads, with no GitHub source
configured. Pushing alone does not establish automatic deployment. Connect the
existing `xland-server` service to `doisn2003/xland-server`, branch `main`, and
verify that source and its queued/successful commit before claiming auto-deploy
is configured. While Railway rejects deployment or source changes, production
completion remains pending. Preserve the existing database/auth variables.

The commit includes the already deployed sharing runtime and public assets so a
GitHub deployment preserves the currently working content links.

## Deployment readiness — 22 October 2026

Both fixes are pushed to `main`: backend `ea60b8c` and mobile `728a944`.
Git remote refs were checked after each push. Local backend checks and the
isolated author integration test pass. The client snapshot exported from the
Git index also passes its author data and navigation tests without unrelated
working-tree changes.

Repository access is now ready. The repository owner's Railway GitHub App
installation already covers this repository. The project member's linked GitHub
account `hoangpm127` has accepted collaborator access; GitHub confirms
`push: true` and `admin: false`. Railway successfully created the GitHub trigger
for `doisn2003/xland-server`, branch `main`, on the existing production service.
The trigger ID is `a6f0d6f4-d39b-406b-9918-8747b5908530`; a separate read confirms
the saved repository and branch. No further repository permission change is
required for that trigger.

Railway's branch-list API still reports `GitHub Repo not found`, and the dashboard
shows `Could not load branches`. This is separate from the confirmed collaborator
permission and saved trigger. Fetching/building the GitHub source remains
unverified. Recheck the lookup when Railway recovers; if it still fails, refresh
the existing `hoangpm127` GitHub connection on Railway before deployment.

**Production remains incomplete.** At 02:20 UTC on 22 October, Railway still
reported builds/deployments paused. The active and latest deployment were both
`ab5f71f0-afe5-4046-a908-47a3735b07dc`, from before the author change; no new
deployment was queued. Direct live acceptance still received HTTP 404 for
Ngoc Anh's author profile. A configured trigger is not deployment acceptance.

The remaining work after Railway restores builds/deployments is:

1. Deploy the latest commit from the connected `main` branch to the existing
   `xland-server` service in `production`. If no deployment starts automatically,
   use Railway's **Deploy Latest Commit** action. Confirm the deployed Git SHA
   matches the intended remote `main` commit and includes backend fix `ea60b8c`.
2. Wait for the Docker build, rollout and `/health/ready` healthcheck to succeed.
   Preserve the existing database/auth variables; this feature needs no database
   migration or seed.
3. Run `npm run verify:authors` against the production origin. Require HTTP 200
   from both `/api/v1/authors/:authorId` and
   `/api/v1/authors/:authorId/videos`, with the actual author's identity and
   author-filtered videos. Ngoc Anh must have `consultantId: null`; the assigned
   property consultant remains Quang Quan.
4. Mark the backend rollout complete only after the deployed commit and direct
   production acceptance both pass. Mobile installation/emulator changes are
   outside these backend rollout steps.

Automatic deployment is configured for future pushes. The current pushed code
must still be confirmed on production after the incident; recovery alone does
not prove that Railway replayed a deployment request made during the pause.
