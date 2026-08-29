# Earth production monitoring and recovery

TheMarble treats the visible globe, its immutable Earth-state bundle, the publishing pipeline, and its upstream observations as one production system. The scheduled `Earth production health` workflow checks that system every 30 minutes. It retains a JSON diagnosis and fixed day, terminator, and night screenshots for 90 days, including failed runs.

## Required repository variables

Configure these GitHub Actions repository variables before enabling the schedule:

- `THEMARBLE_HEALTH_SNAPSHOT_URL`: JSON emitted by the Earth-state production scheduler after its most recent attempt.
- `THEMARBLE_ORIGIN_LATEST_URL`: the publisher origin's `latest.json`.
- `THEMARBLE_CDN_LATEST_URL`: the public CDN's `latest.json`; this is also compiled into the monitored client.

All three endpoints must be HTTPS in production. The origin and CDN pointers must expose the same non-empty `bundleId`. The web endpoint must allow the deployed TheMarble origin to read its manifest and assets.

The health snapshot has this shape:

```json
{
  "checkedAt": "2026-08-29T08:00:00Z",
  "providers": {
    "satcorps": {
      "latestObservationAt": "2026-08-29T07:00:00Z",
      "discoveredAt": "2026-08-29T07:35:00Z",
      "expectedObservations": 1,
      "missingObservations": 0,
      "schemaFingerprint": "cloud-v3",
      "expectedSchemaFingerprint": "cloud-v3",
      "dimensions": { "width": 4096, "height": 2048 },
      "expectedDimensions": { "width": 4096, "height": 2048 },
      "corruptProducts": 0,
      "coverageFraction": 0.96,
      "qualityFlags": [],
      "processingDurationMs": 40000
    },
    "gmgsi": { "sameFields": "as satcorps" }
  },
  "transformation": { "ok": true, "durationMs": 18000 },
  "compositor": { "ok": true, "durationMs": 64000 },
  "publication": { "outcome": "published", "durationMs": 12000, "bundleId": "earth-current" },
  "delivery": { "latestManifestRetrievedAt": "2026-08-29T07:40:00Z" },
  "interSourceDisagreementFraction": 0.08
}
```

Each real provider object must contain the complete field set shown for SatCORPS. `publication.outcome` is healthy when it is `published` or `unchanged`. The versioned thresholds live in [`config/earth-production-policy.json`](../config/earth-production-policy.json).

## Diagnoses and artifacts

The workflow writes:

- `visual-smoke/day.png`, `terminator.png`, and `night.png`, all rendered at the same UTC instant from the same verified remote bundle.
- `visual-smoke/smoke-report.json`, including page/console errors and the bundle/runtime/currentness exposed by the client.
- `diagnostics/health.json` and an immutable timestamped health report.
- `soak.ndjson`, the cross-run SatCORPS/GMGSI evidence window.
- `diagnostics/satcorps-promotion.json`, the explicit provider-promotion decision and every threshold result.

Alerts intentionally name the failed boundary:

| Alert stage | Meaning |
| --- | --- |
| `upstream-provider-lateness` | An expected SatCORPS or GMGSI observation is late or missing. |
| `transformation` | Source schema/dimensions, corruption, coverage, quality, or transformation failed validation. |
| `compositor` | Physical-field composition failed. |
| `publication` | Atomic publication did not finish. |
| `delivery` | Origin/CDN availability or bundle identity differs. |
| `client-currentness` | The latest pointer is stale, the client is not using it, or a fixed visual view failed. |

This separation prevents an upstream delay from being reported as a renderer or CDN incident.

## SatCORPS promotion

GMGSI remains the operational cloud source until SatCORPS passes the complete soak policy. The default gate requires at least 21 days and 454 samples, then checks p95 discovery latency, missing observations, global coverage, corrupt products, schema and dimension stability, quality flags, and p95 disagreement against GMGSI. There is no manual preference switch in the selector.

After a successful soak, pass the fresh report to the cloud publisher:

```sh
npm run publish:clouds -- \
  --catalog <catalog.json> \
  --soak-report artifacts/production-health/diagnostics/satcorps-promotion.json \
  --python <venv-python> \
  --output <earth-state-directory>
```

The report must still be valid and no more than 36 hours old. Missing, stale, malformed, or failing reports retain GMGSI automatically.

## Recovery runbook

Never advance `latest.json` to an unverified candidate. Begin every recovery by verifying the stored last-known-good document and every referenced byte.

| Incident | First action | Safe outcome |
| --- | --- | --- |
| Provider outage | Stop advancing the provider-dependent layers. | Retain the last-known-good bundle while its age increases honestly. |
| Stale latest | Retry atomic publication from the last-known-good base. | Publish a complete candidate or retain last-known-good. |
| Compositor crash | Restart the compositor, then retry publication. | No partial output becomes current. |
| Corrupt output | Quarantine the candidate bundle. | Replace latest with last-known-good if the active pointer is no longer verified. |
| Publication interruption | Retry publication from the last-known-good base. | The atomic pointer remains on a complete bundle. |
| CDN failure | Restore delivery of the last-known-good bundle and compare CDN with origin. | Origin, CDN, and client converge on one bundle. |
| Requested rollback | Atomically replace latest with the verified last-known-good document. | The previous bundle is active and re-verified. |

The `createEarthProductionRecoveryController` module encodes and tests all seven paths. If an attempted repair throws or leaves an unverifiable latest pointer, it replaces latest with the verified last-known-good document and verifies that result again.

## Local diagnosis

The same checks can be run outside GitHub Actions:

```sh
npm run smoke:production -- \
  --app-url https://themarble.example/ \
  --output artifacts/production-health/visual-smoke

npm run monitor:production -- \
  --snapshot <health-snapshot-url-or-path> \
  --origin-latest <origin-latest-url-or-path> \
  --cdn-latest <cdn-latest-url-or-path> \
  --smoke-report artifacts/production-health/visual-smoke/smoke-report.json \
  --policy config/earth-production-policy.json \
  --history artifacts/production-health/soak.ndjson \
  --output artifacts/production-health/diagnostics
```

Both commands return a failing exit status after retaining their available evidence.
