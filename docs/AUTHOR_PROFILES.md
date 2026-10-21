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
