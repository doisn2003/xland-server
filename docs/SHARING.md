# Share links and cross-platform preview

Implemented 21 October 2026. The selected initial origin is
`https://xland-server-production.up.railway.app`. This document describes the new
implementation and the completed Railway rollout. Actual cards inside receiving
chat apps remain a separate acceptance check from public crawler responses.

## Live rollout — 21 October 2026

Deployment `ab5f71f0-afe5-4046-a908-47a3735b07dc` is `SUCCESS` on the existing
production service. Readiness returns 200. No schema migration or seed ran.
Only `PUBLIC_BASE_URL`, `SHARE_ANDROID_PACKAGE` and `SHARE_ANDROID_SHA256` were
configured for this feature; existing database/auth configuration was preserved.
The assetlinks endpoint contains the public debug and internal release signing
fingerprints. The Pixel 9 Pro Android 17 emulator reports the domain `verified`.
Google's public Digital Asset Links check also returned HTTP 200 with
`linked: true` for the debug signing certificate; its response is saved alongside
the deployment evidence.

The corrected mobile handoff is now signed **release 0.2.1+3**, not the earlier
debug build. On the separate **XLand Release API 37** emulator, Android reports
the same domain `verified` with release certificate
`DF:50:77:55:0E:D2:FC:D0:B8:40:34:69:B8:C2:8A:A7:EB:0C:66:A3:16:4E:A8:34:0A:7B:FF:80:C8:67:EB:9C`.
Google Digital Asset Links also returned `linked: true` for that release
certificate. Public video/property acceptance was rerun successfully at 06:46
UTC; the new report is `.local/release/xland-share-20261021-release/`.

Read-only live acceptance passed for:

- [Video](https://xland-server-production.up.railway.app/videos/f20c71d7-81f9-5f2e-a048-43d44c3f7a9c)
- [Property](https://xland-server-production.up.railway.app/properties/5bf96d5f-0af5-5371-aac9-f424c97625b6)

Both return 200 HTML/HEAD without redirects, correct canonical/title/description,
and content-specific public PNGs (1536 × 1024, HTTP 200). Browser, Facebook,
WhatsApp, Zalo and Twitter User-Agent simulations received identical HTML. This
checks server compatibility, not actual cards rendered by those companies.
Missing content returns 404. Both fallback pages were also visually checked
in the browser. Records used in acceptance are explicitly labeled illustrative.

Rerun `node scripts/release/verify-sharing.mjs`; this script only reads public
endpoints. Set `XLAND_SHARE_EVIDENCE` to select a new evidence directory. The final
deployment, source hashes and live report are under
`.local/release/xland-share-20261021-final/`. Staging now accepts `XLAND_RELEASE_ID`
and defaults to a fresh timestamp instead of overwriting October 19 evidence.

## Public URL contract

The existing `GET /api/v1/properties/:id/share` and
`GET /api/v1/videos/:id/share` still return `{data:{url,title}}`. The title now
comes from the actual record. Event share URLs remain compatible too.

Canonical URLs are `https://HOST/properties/UUID`, `/videos/UUID` and
`/events/UUID`. IDs are database IDs, not website mock IDs, titles or slugs.
The same HTTPS URL is copied, sent to other apps and used as `og:url`.

1. Flutter loads the canonical link in a shared bottom sheet. It provides a
   selectable link, Copy and the system share sheet (`share_plus` 13.3.1).
2. Android App Links / iOS Universal Links open the exact content in the installed
   app. Cold starts retain Home underneath; warm links also navigate by ID.
   A shared video is fetched directly, independent of feed pagination.
3. Without the app, the server renders a responsive summary page. Crawlers get
   Open Graph and Twitter metadata in the first HTML response, without JS,
   authentication, redirects, cookies or a separate mock content store.
4. The web page has an explicit `xland://share/<kind>/<id>` button to try opening
   an installed app from browsers that did not hand off the original HTTPS link.
   It does not auto-redirect or pretend that a store listing exists.

## Feasibility with the existing website

Rich Link Preview **is feasible without adding share buttons to the website or
migrating its mock data first**. The new public pages live on the backend host and
read the same database as mobile. The independent mock website is not used as the
destination. This avoids mismatched IDs, prices, photos and titles.

When the website is connected to the real API, it can render these public paths
itself or reverse-proxy them to this service. Keep the original links available;
moving an app association to a new host requires updated app builds and
association files, not just a server environment-variable change.

Open Graph describes a preview card, not guaranteed inline video playback. The
video URL represents the video record and its poster/description; playback is in
the app. Zalo, Messenger, Facebook, WhatsApp, mail and messaging clients decide
whether and how to show previews and cache them. TikTok does not reliably accept
arbitrary website links through every version of its share extension. The system
sheet shows only compatible installed destinations. Copy remains available.
No Facebook/Zalo/Messenger/TikTok SDK credentials or hard-coded private app
schemes are required to send links.

## Deployment configuration

Deploy the updated server, including `public/share-default.png`; Docker and the
source staging helper include that asset. Set these Railway variables:

```dotenv
PUBLIC_BASE_URL=https://xland-server-production.up.railway.app
SHARE_ANDROID_PACKAGE=vn.xland.xland_mobile
SHARE_ANDROID_SHA256=<SHA-256 fingerprint of the certificate signing the installed APK>
# Set only after the Apple application identifier is known:
SHARE_APPLE_APP_ID=<10-character App ID prefix>.vn.xland.xlandMobile
```

`SHARE_ANDROID_SHA256` accepts comma-separated certificates, each in colon-byte
format. Use the internal release certificate for sideloaded APKs, and the Play
App Signing certificate for Play-distributed builds. Do not substitute the
upload certificate. Public certificate fingerprints are not signing keys.
An empty certificate/App ID configuration publishes empty association lists;
it does not falsely advertise verified native links. `PUBLIC_BASE_URL` unset
keeps share creation disabled and public content pages return 503.

Server endpoints, all anonymous HTTPS with no redirects:

- `/.well-known/assetlinks.json`
- `/.well-known/apple-app-site-association`
- `/share/default-preview.png`
- `/properties/:id`, `/videos/:id`, `/events/:id`

Mobile defaults already use this Railway host. Android uses the
`xlandShareHost` Gradle property; Dart uses `XLAND_SHARE_HOST`; iOS uses
`ios/Flutter/Sharing.xcconfig` and Associated Domains in `Runner.entitlements`.
For a new host, update all three and `PUBLIC_BASE_URL` together. iOS signing must
enable Associated Domains for the correct App ID/provisioning profile.
The custom `xland` scheme is a convenience button, not a verified association.

No database migration is needed. HTML queries run under anonymous `xland_api`
RLS even when the sharer is signed in. Pending properties, paused properties,
unapproved/deleted videos and videos attached to unavailable properties cannot
produce a public preview. Pages omit private contacts, exact coordinates,
legal files, storage keys and bearer tokens. Text is escaped. HTML is `no-store`
so the service does not retain removed content; third-party caches may persist.

Only HTTPS public media without credentials or query tokens is included.
Signed/temporary media falls back to the bundled XLand PNG. CDN transformation
URLs with query strings also use the fallback: supply a stable public poster URL
for a content-specific image. An accepted image URL must still be reachable by
crawlers; the server does not fetch arbitrary image URLs on each request.
Illustrative records remain labeled in the summary and metadata.

## Verification and acceptance

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run test:sharing
```

`test:sharing` starts an isolated loopback PostgreSQL cluster, creates a fresh
`xland_test_sharing_*` database, applies current migrations, checks forced RLS and
tests actual HTTP responses and the ShareLink wire contract. It never reads
`.env`, uses `DATABASE_URL`, or changes the shared test context. Private test
state is under ignored `.local/sharing/`; databases are retained for inspection.

The existing broad `test:integration` runner stopped before feature tests because
its locked C4 table list predates later migrations. Running the old operations
contract independently also exposed an existing `AgendaItem.description` mismatch
in event fixtures. These baseline failures were not changed as part of sharing.

Local verification completed: 25 unit tests passed; lint, TypeScript checks and
the server build passed. The isolated sharing HTTP/PostgreSQL test passed for
property, video and event URLs, guest/auth parity, metadata escaping, image
fallbacks, HEAD, paused/pending properties and deleted videos. These are local
results; the live rollout and its independent checks are recorded above.

After deploying and installing a new app build:

1. Open one property and one video URL in a logged-out browser. Verify 200 HTML,
   exact title, price/location and a reachable JPEG/PNG `og:image`. Verify HEAD.
2. Confirm the two association files contain the actual signing identities.
   On Android use `adb shell pm verify-app-links --re-verify vn.xland.xland_mobile`
   then `adb shell pm get-app-links vn.xland.xland_mobile`.
3. Tap links from another app with XLand stopped and running; verify content ID,
   Back navigation, guest mode and removed-content states. On iOS use a signed
   device build; Windows cannot validate Apple signing or Universal Links.
4. Open the native share sheet and cancel, then copy/paste. Verify iPad anchoring.
   On browsers without Web Share, the visible Copy action remains usable.
5. Send a property/video link manually to the desired chat apps and inspect the
   actual preview. External messages were not sent by the automated tests.
   Cached cards may need refreshing with the platform's own debugger.

References: [Open Graph](https://ogp.me/),
[share_plus](https://pub.dev/packages/share_plus),
[Android App Links](https://docs.flutter.dev/cookbook/navigation/set-up-app-links),
[iOS Universal Links](https://docs.flutter.dev/cookbook/navigation/set-up-universal-links).
