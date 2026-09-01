# Publisher scheduler

A Cloudflare Worker whose only job is to ask GitHub, every ten minutes, to run
`earth-state-clouds.yml`.

## Why this exists

GitHub's scheduled workflows are best-effort and are dropped under load. Measured
on this repository, a `*/10` cron fired at 05:40, 00:36, 21:05, 15:31, 07:40 —
gaps of three to eight hours against a ten-minute schedule. GMGSI publishes a new
observation hour every hour and the provenance panel calls the state stale after
four, so the globe spent most of the day stale for no reason but the scheduler.

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
| `REF` | var | `main` |
| `GITHUB_TOKEN` | **secret** | fine-grained PAT, `Actions: read and write`, this repository only |

`GET /health` reports whether the Worker is configured. It never returns the token.

## Deploying

    cd infrastructure/publisher-scheduler
    npx wrangler deploy
    npx wrangler secret put GITHUB_TOKEN

The GitHub cron in `earth-state-clouds.yml` is deliberately kept as a slow
backstop, so the feed still advances if this Worker is ever removed.
