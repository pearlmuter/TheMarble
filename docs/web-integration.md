# How TheMarble reaches the web

[`live-feed-deployment.md`](live-feed-deployment.md) covers how the *data* is
produced and served. This covers how the *application* is delivered, and how it
is embedded in the web desktop at `emildanielsen.no`.

## One build, four surfaces

`dist/` is the only build artifact. Everything below runs the same bytes:

| Surface | How it loads `dist/` | Feed pointer it reads |
| --- | --- | --- |
| Website, `https://themarble.emildanielsen.no/` | uploaded to R2 by `themarble-site.yml` | same-origin `/latest.json` |
| Web-desktop window on `emildanielsen.no` | the website above, in an iframe | same-origin `/latest.json` |
| Tauri desktop app | embedded at build time (`frontendDist: "../dist"`) | `https://themarble.emildanielsen.no/latest.json`, cross-origin |
| Production health monitor | built in CI, served at `127.0.0.1:4173` | `THEMARBLE_CDN_LATEST_URL`, cross-origin |

The pointer is baked in at build time from `VITE_EARTH_STATE_LATEST_URL`
(and `VITE_EARTH_STATE_PRESENTATIONS_URL`); unset, both fall back to
`/earth-state/…` on the app's own origin. See *Client configuration* in
[`live-feed-deployment.md`](live-feed-deployment.md).

## The site and the feed share one origin

The site is **not** on Cloudflare Pages. The 16K Milky Way texture is 47 MB and
Pages refuses any file over 25 MiB. R2 has no such limit, so `dist/` is uploaded
into `themarble-earth-state` — the same bucket the feed is published to — and
both are served from `https://themarble.emildanielsen.no/`.

That is a deliberate choice with a payoff: the browser reads `latest.json`
same-origin, so the hot path involves no CORS preflight and no second TLS origin.

### Origin layout

| Path | Written by | `Cache-Control` |
| --- | --- | --- |
| `/index.html` | site deploy | `max-age=60, must-revalidate` |
| `/assets/index-*.js`, `/assets/index-*.css` | site deploy | `max-age=31536000, immutable` |
| `/earth-state/**` (packaged fallback state) | site deploy | `max-age=300, must-revalidate` |
| `/latest.json`, `/latest-presentations.json` | publisher | `max-age=30, must-revalidate` |
| `/bundles/<bundle-id>/manifest.json` | publisher | `max-age=31536000, immutable` |
| `/assets/<sha256>.<ext>` | publisher | `max-age=31536000, immutable` |

## Two writers, one `/assets/` prefix

Both the site deploy and the Earth-state publisher write under `/assets/`. Vite
emits `assets/index-CJmrFX2X.js`; the publisher emits `assets/<64 hex>.png` from
its content-addressed store. They share the prefix and must not disturb each
other. Three things keep that true, and **all three are load-bearing**:

1. **Neither `aws s3 sync` uses `--delete`.** Adding it to "clean up stale
   objects" would delete every one of the other writer's live files.
2. **The publisher seeds its working store by syncing the whole bucket down**
   (`aws s3 sync "$BUCKET" artifacts/earth-state --size-only`). The site's
   `index.html` and `assets/index-*.js` are therefore physically present in the
   store during every publish run, and are enumerated as pruning candidates.
3. **The pruner refuses to delete anything that is not content-addressed.**
   `isContentAddressedAsset()` in [`../src/earth-state-retention.js`](../src/earth-state-retention.js)
   matches only `assets/<64 hex>.<ext>`; an unreferenced `assets/index-*.js` is
   retained precisely because it is not the publisher's to delete. This is
   covered by [`../test/earth-state-retention.test.js`](../test/earth-state-retention.test.js) —
   do not loosen that regex.

### Write ordering

The publisher uploads immutable assets **before** advancing the pointer, and
deletes pruned keys **after**. A pointer must never name bytes that are not yet
uploaded, and bytes must not be dropped while a pointer still names them. Do not
reorder those steps in `earth-state-clouds.yml`.

R2 rate-limits repeated writes to a single object to roughly one per second, so
no key may be written by more than one command in a deploy, both workflows set
`concurrency: cancel-in-progress: false`, and the site deploy runs with
`AWS_RETRY_MODE=adaptive`. Cancelling a run does not recall writes already in
flight.

## The embed on `emildanielsen.no`

`emildanielsen.no` is a web desktop that opens applications in iframes. Its
Content-Security-Policy names the ones it will frame:

    frame-src 'self' https://drott.emildanielsen.no
                     https://kyber.emildanielsen.no
                     https://themarble.emildanielsen.no

The iframe is created by the desktop when the window is opened, so TheMarble does
not appear in the parent page's initial HTML.

Two constraints hold this together:

- **The marble origin sends no `X-Frame-Options` and no `frame-ancestors`.** The
  embed works because nothing forbids it. Adding either header — a reflex when
  hardening a site — breaks the desktop window with no other symptom.
- **Inside the frame the document origin is `themarble.emildanielsen.no`**, so
  the feed fetch is same-origin and unaffected by the parent's `connect-src`.

The R2 bucket's own CORS policy returns `access-control-allow-origin: *`, and
only in reply to a request that carries an `Origin` header. That policy — not the
uploader — is what serves the Tauri app (`tauri://localhost`) and any other
cross-origin reader. Every publish re-checks it against
`THEMARBLE_CLIENT_ORIGINS` via `npm run verify:earth-state-feed --client-origins`.

## What triggers a site redeploy

`themarble-site.yml` runs on push to `main` touching only:

    src/**  public/**  index.html
    package.json  package-lock.json  vite.config.ts
    .github/workflows/themarble-site.yml

Changes to `scripts/**`, `docs/**`, `config/**`, `src-tauri/**`, `test/**` or
`tsconfig.json` therefore **do not** ship a new site, even though `npm run build`
runs `tsc` and would pick a `tsconfig.json` change up. Use `workflow_dispatch` if
you change one of those and need the site rebuilt.

The deploy refuses to ship a local preview state: `dist/earth-state-preview` is a
hard failure, because the preview state is published under `artifacts/`, never
`public/`, and so must never reach `dist`.

## The site root

R2 serves no index document for a directory request, so the bare origin depends
on a Cloudflare rule rewriting `/` to `/index.html`. That rule is configured
outside this repository. The deploy's final step checks the root and emits a
*warning* rather than failing, because a deploy cannot fix a routing rule.

As of 2026-09-05 the root returns `200`, so that guard can be promoted to a hard
failure whenever someone is confident the rule is permanent — see the comment in
`themarble-site.yml`.
