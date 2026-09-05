# Project state

A dated snapshot for anyone — human or agent — picking up development. Every
claim here was measured on **2026-09-05**, and every one is re-derivable with the
commands in [Verifying this yourself](#verifying-this-yourself). Where this
document and the live system disagree, the live system is right and this file is
stale.

Read [`../README.md`](../README.md) for what the system *does*, and
[`web-integration.md`](web-integration.md) for how it is delivered. This file
covers only what is done, what is not, and what will bite you.

## Sun and camera update

The 2026-09-05 update replaces the solar glare sprites, shares the
atmospheric transmission model with the Sun, and adds the menu's “Follow this
place” switch. See [the review and validation notes](solar-camera-review.md).
The classroom follow-up adds independent atmospheric integration checks, corrects
grazing-ray classification and optical-depth precision, and increases sampling
on the outer rim. See [the scientific validation](sunrise-validation.md).
Deployment is tracked by the **TheMarble site** workflow after merge to `main`.

## Where the work stands

`main` is the whole story. Twenty-two branches exist locally — `issue-2` through
`issue-17`, and seven `feat/`, `fix/`, `perf/` branches — and **all of them are
fully merged** (`0` commits ahead of `main`). They are stale local refs, not work
in progress, and can be deleted without loss.

Recent work arrived as PRs #22–#28: a render upgrade, a frame-cost recovery, and
five fixes covering unreached render paths, cryosphere publication, pointer
refresh, polar cloud slope, and polar resampling gaps.

### Open issues

| Issue | State |
| --- | --- |
| [#1](https://github.com/pearlmuter/TheMarble/issues/1) | The parent epic. Still open as the umbrella for #16 and #19. |
| [#16](https://github.com/pearlmuter/TheMarble/issues/16) | Visual calibration and web/Tauri acceptance. `ready-for-agent`, not started. |
| [#19](https://github.com/pearlmuter/TheMarble/issues/19) | Run polar cloud gap completion in production. Unlabelled; see below. |

### #19 is the one gap you can see in the live feed

The completion pipeline shipped with #9 — `scripts/cloud_gap_compositor.py`,
`npm run publish:cloud-gaps`, [`cloud-gap-pipeline.md`](cloud-gap-pipeline.md) —
but **it is not wired into production.** `earth-state-clouds.yml` runs
`publish:earth-state-feed` and nothing else.

The live manifest still shows exactly what #19 describes:

    latitudeRange:    [-72.737, 72.715]
    observedFraction: 0.9528
    assistance:       (absent)

So ~4.7% of the globe — both polar caps — carries no observed cloud, and the
frame records no assistance because none ran. This is the highest-value piece of
unfinished work: the code exists, is documented and tested, and needs wiring plus
the provider credentials the pipeline requires.

## Production health

Four workflows, all in `.github/workflows/`:

| Workflow | Cadence | Driven by |
| --- | --- | --- |
| `earth-state-clouds.yml` | every 10 min | Cloudflare Worker cron; GitHub `cron: '5 * * * *'` is a backstop |
| `earth-state-cryosphere.yml` | daily | schedule |
| `earth-production-health.yml` | every 30 min | same Worker; GitHub `cron: '7 * * * *'` is a backstop |
| `themarble-site.yml` | on push to `main` | path filter, see [`web-integration.md`](web-integration.md) |

GitHub's own scheduler is best-effort and drops most runs — a `*/10` cron there
fired at gaps of three to eight hours. That is why
`infrastructure/publisher-scheduler` (a Cloudflare Worker) drives both schedules
and the in-repo crons are only backstops. Changing cadence means editing
`wrangler.toml` **and redeploying the Worker**; editing the workflow alone
changes only the backstop.

### The publisher is healthy; the monitor was crying wolf

Of the sixteen most recent `Earth production health` runs, seven failed. Ten
failures sampled across 2026-09-03/04 split into two very different causes:

**`client-not-current` — nine of ten. A harness bug, now fixed.**
`scripts/smoke-earth-production.mjs` capped its wait for the loading overlay at a
hardcoded `120_000` ms, while the app is allowed
`EARTH_STATE_ACTIVATION_TIMEOUT_MS` = 300 s to activate. Each of the three smoke
views independently downloads ~19.7 MB of layer textures, so exceeding 120 s on a
CI runner is ordinary. Every failing view reported **zero console errors** — the
only page error was the harness timeout itself. Both readiness waits now share
one deadline derived from `READY_TIMEOUT_MS`, and
`test/production-scheduled-contract.test.js` now asserts the constant is *used*,
not merely defined — the gap that let the literal survive.

**`latest-content-stale` — one of ten. Genuine, and self-recovered.** At
2026-09-04T21:41Z the delivered bundle was the 18:00 nominal hour, 221 minutes
old against a 180-minute policy. Upstream GMGSI produced nothing for hours 19–21,
then the publisher jumped straight to hour 22. The publisher selects the newest
validated hour rather than replaying a backlog, so recovery is one run, not four.

### Freshness margin is thinner than the policy suggests

Across nine observed publications, the lag between a bundle's `validAt` (the
nominal UTC hour) and its publication was **44–51 minutes**, and every single
publication came from the `:40` or `:50` poll. Upstream data for hour *H* lands
between roughly `H:30` and `H:50`.

So bundle age oscillates between ~51 and ~111 minutes against
`maximumLatestManifestAgeMinutes: 180` — about **69 minutes of headroom**. Any
upstream delay longer than that trips the alert, which is precisely what happened
above.

This is why the ten-minute cadence should not be lengthened naively. A 40-minute
interval does not divide 60, so the poll phase would drift through `:00, :40,
:20` and miss the arrival window most hours, pushing lag to 60–80 minutes and
peak age to ~140 — cutting headroom to ~40 minutes. If the run count matters,
narrow the *window* rather than lengthening the *interval*:
`crons = ["0,30,40,50 * * * *", "25 * * * *"]` keeps every poll that has ever
published and drops four that never have. Note the repo is public, so Actions
minutes are free; this is a noise decision, not a cost one.

## Things that will bite you

- **`/assets/` has two writers.** The site build and the Earth-state publisher
  share the prefix. Never add `--delete` to either `aws s3 sync`, and never
  loosen `isContentAddressedAsset()`. See
  [`web-integration.md`](web-integration.md#two-writers-one-assets-prefix).
- **Adding `X-Frame-Options` or `frame-ancestors` to the marble origin** breaks
  the `emildanielsen.no` desktop window silently.
- **The site deploy's path filter** ignores `scripts/`, `config/`, `src-tauri/`
  and `tsconfig.json`. Changing those does not ship a new site.
- **Most health stages are waived, not passing.**
  `THEMARBLE_HEALTH_SNAPSHOT_URL` and `THEMARBLE_ORIGIN_LATEST_URL` are unset, so
  provider lateness, transformation, compositor, publication and the origin half
  of delivery are observed as *unavailable* on every run. Their alerts are raised
  and reported under `waivedAlerts` but cannot fail a run. Only two things are
  actually enforced: the deployed client reaching current data, and the delivered
  bundle advancing within policy. The reasoning is recorded in
  `config/earth-production-policy.json`; remove a stage from `waivedStages` once
  a snapshot publishes evidence for it.
- **GitHub is forcing Actions off Node 20.** `actions/checkout@v4`,
  `setup-node@v4`, `cache@v4` and `upload-artifact@v4` all warn on every run.
  They will need version bumps.
- **`docs/agents/domain.md` points at `CONTEXT.md` and `docs/adr/`, neither of
  which exists.** That is expected — the `/domain-modeling` skill creates them
  lazily — so proceed silently rather than treating it as a defect.

## Verifying this yourself

```sh
npm test                      # 385 tests, all passing
npx tsc --noEmit              # clean
gh run list --status failure --limit 20
gh issue list --state open
git branch --format='%(refname:short)' | while read b; do
  echo "$(git rev-list --count main..$b) ahead: $b"; done
```

Live feed state, including the #19 coverage gap:

```sh
curl -s https://themarble.emildanielsen.no/latest.json
```

Then fetch the `manifest.href` it names and read `cloudSequence.frames[].coverage`.

Health diagnostics for any run are retained for 90 days as the
`earth-production-health-<run-id>` artifact; `diagnostics/health.json` carries
the alert codes, the waived list, and `latestBundleAgeMinutes`. The recovery
runbook is in [`production-operations.md`](production-operations.md).
