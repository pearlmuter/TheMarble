# Publisher scheduler

A Cloudflare Worker whose only job is to ask GitHub to run two workflows on
time: the publisher (`earth-state-clouds.yml`) every ten minutes, and the health
monitor (`earth-production-health.yml`) every half hour.

## Why this exists

GitHub's scheduled workflows are best-effort and are dropped under load. Measured
on this repository, a `*/10` cron fired at 05:40, 00:36, 21:05, 15:31, 07:40 —
gaps of three to eight hours against a ten-minute schedule. GMGSI publishes a new
observation hour every hour and the provenance panel calls the state stale after
four, so the globe spent most of the day stale for no reason but the scheduler.

The health monitor was dropped just as badly: a `7,37` cron managed about five
runs a day out of a scheduled forty-eight. A monitor nobody can rely on to run
is not a monitor, so it moved onto the same trigger.

Cloudflare runs cron triggers on its own scheduler. The work stays on GitHub
Actions, which is free for this public repository and already holds the
credentials for the origin.

## What it does not do

It holds no data, keeps no state, and makes no decision about publishing. The
producer still decides whether a new validated hour exists; a duplicate poke
returns `unchanged` and leaves `latest.json` untouched.

## Configuration

| Name | Kind | Value |
| --- | --- | --- |
| `REPOSITORY` | var | `pearlmuter/TheMarble` |
| `WORKFLOW` | var | `earth-state-clouds.yml` |
| `HEALTH_WORKFLOW` | var | `earth-production-health.yml` |
| `HEALTH_CRON` | var | `7,37 * * * *` — the trigger that selects the monitor |
| `REF` | var | `main` |
| `GITHUB_TOKEN` | **secret** | fine-grained PAT, `Actions: read and write`, this repository only |

`GET /health` reports whether the Worker is configured. It never returns the token.

## Deploying

    cd infrastructure/publisher-scheduler
    npx wrangler deploy
    npx wrangler secret put GITHUB_TOKEN

Both workflows keep a slow GitHub cron as a backstop, so the feed still advances
and the monitor still runs if this Worker is ever removed.

## Adding a schedule

`crons` in `wrangler.toml` lists the triggers; Cloudflare reports which one
fired as `event.cron`, and `workflowForCron` in `src/publisher-dispatch.js` maps
it to a workflow. An unrecognised cron pokes the publisher, because a duplicate
poke reports `unchanged` and a missed publish goes stale.
`test/publisher-scheduler-contract.test.js` fails if a configured workflow does
not exist or cannot be dispatched.
