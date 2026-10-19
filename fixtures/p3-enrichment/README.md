# XLand A-18 enrichment v1

**Current live revision v1.1 (A-19):** base upload/seed completed, then exactly16own property.highlights fields were repaired from string[] to C-4 {title,description}[] through a separately journaled repair. Typed live probes now pass20properties/96feedvideos/8consultants/120newcomments/5events/1club and real repository pagination10/20/50. Artifacts in this root are immutable historical v1; revised dataset/manifests are under revisions/v1.1-highlights. Current read-only rerun: node scripts/p3-enrichment/repair-highlights.mjs dry-run (16unchanged). Base pipeline rerun intentionally fails closed after repair because historical values differ; never rewrite base artifacts/journal to hide the repair. Both write windows released; apply/rollback needs coordination with A. See brain/logs/agent-database/HANDOFF_A19.md for exact hashes, evidence and rollback order. A accepted D2/D3 media startup after the user confirmed image/video loading and playback on Pixel_9_Pro/API3004 without the demo-media overlay after repair; this does not establish full native seek/offline/gesture coverage.

**A-19 (19/10/2026):** Agent A accepted this exact v1 dataset and its 33 assets / 63,536,670 bytes. The earlier 60-scenery target is removed from the v1 gate; do not generate another 48 assets for this task. Historical `gaps` metadata below and in the signed manifest is retained unchanged for provenance. Current execution status is `brain/logs/agent-database/A19_STATUS.md`.

Owner: `xland-p3-enrichment-v1`; current Supabase mock fingerprint `03d6c297d77a1029` only. All personas and properties are synthetic. Public content has no real-person phone/email, login rights, false verification or exact land boundaries. Legal documents are untouched. License/provenance, original prompts, hashes, bytes and clip durations are in `manifest.json` and `generation-receipts.json`.

33 original/source-derived assets, **63,536,670 bytes**: 12 scenery PNGs, 8 avatar PNGs, 1 community PNG and 12 eight-second H.264 clips. Clips are pan/zoom animations of AI artwork. Two original report clips are reused with their source manifest. Repeated use of scenery across mock records is disclosed and does not increase the distinct-photo count. The suggested 60 scenery-image target is short by 48; this v1 does not claim that target passed.

Commands from `xland-server`:

```powershell
node scripts/p3-enrichment/inventory.mjs
node scripts/p3-enrichment/prepare.mjs
node scripts/p3-enrichment/verify-local-media.mjs
node --test tests/unit/p3-enrichment.test.mjs
node --import tsx scripts/p3-enrichment/test-isolated.mjs
node scripts/p3-enrichment/pipeline.mjs dry-run
node scripts/p3-enrichment/pipeline.mjs preflight
node scripts/p3-enrichment/pipeline.mjs upload
node scripts/p3-enrichment/pipeline.mjs apply
node scripts/p3-enrichment/pipeline.mjs apply
node scripts/p3-enrichment/pipeline.mjs readback
```

Current `.env` is the sole database target; no test/snapshot fallback. Configure Storage privately in ignored `.env.p3-enrichment` per `brain/logs/agent-database/INPUTS.md`. The pipeline validates its project against the database host/user before uploads; it sends bytes to Storage API with overwrite disabled, never inserts into `storage.objects`. Public bucket `public-media` with immutable owner/hash prefix; no anonymous write policy, private bucket ACL change, billing or legal document upload.

`preflight` checks all local asset hashes and, if configured, Storage bucket-read permission without writes. Upload may run before A's DB write window; apply still requires a valid window. Missing private configuration produces a clear readiness result without calling Storage. A read-only legacy cleanup audit is available as `node scripts/p3-enrichment/legacy-cleanup-preview.mjs`; it has no apply mode and leaves v1 inputs unchanged.

Before apply, A supplies a current `brain/logs/agent-database/WRITE_WINDOW.json` with owner, target fingerprint, manifest SHA256, `noConcurrentSchemaOrIdentityWrites: true`, and a future ISO `expiresAt`. This is coordination with concurrent shared DDL/identity work, not a new request for user seed permission. Apply also requires successful Storage readback for this manifest. No shared schema changes are needed with the current metadata inventory; the current provisioner can execute the scoped writes. Do not grant broad update permissions to `xland_seed`.

Private preimage/ownership journal is under `.local/p3-enrichment/`. Apply locks adopted rows, checks preimages, journals before mutation, and changes only explicit manifest keys/columns. Replay is unchanged; a conflicting deterministic ID or externally edited row stops the transaction. Password hashes are random, never exported; persona identities stay disabled. No existing accounts/contacts/sessions/payments/bookings are modified.

Rollback: `node scripts/p3-enrichment/pipeline.mjs rollback` restores adopted fields and deletes only own inserts in reverse dependency order, rejecting changed rows or new foreign references. Then `rollback-storage` may delete only files recorded as uploaded by this manifest, after checking no DB references remain and verifying bytes. It never deletes the bucket. An interrupted `prepared` journal is deliberately fail closed: inspect the private journal and DB transaction outcome before recovery; never delete it just to retry.

Do not rerun inventory after seeding to redefine adopted ownership: preserve the original `content-before.json` preimage, manifest and private journal for this run. A later dataset must use a new version and explicit delta.
