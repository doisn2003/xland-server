# Phase 1 foundation

Node 24.19.0 LTS, npm 11.17.0. `npm ci`, then `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm start`. Dev: `npm run dev`.

This is a skeleton: only /health/live and /health/ready exist. Readiness is intentionally 503 until Phase 2 DB wiring. No core API, migrations, seeds or payment provider run. `test:integration` / `test:contract` exit nonzero with NOT RUN until their Phase 2 suites exist; never use these as evidence of a passing API.

Keep .env private. .env.example is illustrative only. PostgreSQL environment has not been identified or contacted. Use an isolated DB approved by A before future writes. Request logs exclude bodies, tokens and contact data. No CORS origins are enabled at Phase 1; future web/admin origins require explicit configuration.
