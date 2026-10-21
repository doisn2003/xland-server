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

## Push and auto-deploy handoff — 21 October 2026

Both fixes are pushed to `main`: backend `ea60b8c` and mobile `728a944`.
Git remote refs were checked after each push. Local backend checks and the
isolated author integration test pass. The client snapshot exported from the
Git index also passes its author data and navigation tests without unrelated
working-tree changes.

**Production remains incomplete.** Direct live acceptance still receives 404
from the author endpoint. The active deployment is still
`ab5f71f0-afe5-4046-a908-47a3735b07dc`, from before the author change.

The source-connect request recorded `doisn2003/xland-server` on the service, but
Railway rejected deployment while builds were paused. A separate read confirmed
there are **no deployment triggers** for this service/environment. Creating the
`main` GitHub trigger was then rejected because no project member has access to
the repository. Therefore automatic deployment is not yet configured or queued.

An owner must connect a GitHub account with contributor access to this repository
to a Railway project member and grant the Railway GitHub App repository access.
See [Railway's autodeploy access requirements](https://docs.railway.com/deployments/github-autodeploys).
After access is available, create/verify the `main` trigger on the existing
service, deploy the pushed commit and rerun `npm run verify:authors`. Do not treat
the hosting incident ending as proof that either repository access or a pending
deployment has been resolved.
