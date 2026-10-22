# Reproducible QA inputs

`manifest.json` records each source and SHA-256. The contract, seed and finance
vectors were copied byte-for-byte from the existing independent fixtures; no
expected value or contract assertion was relaxed. They now ship with this repo.

The `mobile/` snapshot pins the domain entities and mapper source from mobile
commit `38a701009acb1a7e2862ba55e689c76b09b6d426`. Wire tests use this snapshot by
default, so a backend-only checkout can run them. Set `XLAND_MOBILE_ROOT` to an
absolute full mobile checkout to inspect live entities and verify every copied
Dart file against the manifest. A missing explicit checkout fails; it never
silently falls back. Updating the contract requires reviewing and repinning the
snapshot and checksums. These checks are not a substitute for running Dart or a
mobile device test.

Run `npm test`, `npm run test:admin`, `npm run test:integration` and
`npm run test:contract` from the backend root with the locked Node/npm versions.
The default evidence location is `.local/evidence`; the historical Agent C
evidence namespace remains supported when explicitly requested.
