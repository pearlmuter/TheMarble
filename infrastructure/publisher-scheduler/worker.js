// TheMarble publisher scheduler.
//
// GitHub's scheduled workflows are best-effort. A */10 cron on this repository
// fired roughly every five hours, so the published cloud state spent most of the
// day past its four-hour freshness limit. Cloudflare runs Worker cron triggers on
// its own scheduler, so the trigger lives here and GitHub keeps doing the work.
//
// This Worker holds no data and makes no decisions: it asks GitHub to run the
// producer, and the producer still decides whether a new observed hour exists.
// A duplicate poke is harmless — the publisher reports `unchanged` and leaves
// latest.json alone.
//
// The same applies to the health monitor, which GitHub dropped just as badly:
// a `7,37` cron managed about five runs a day out of forty-eight. Two crons,
// one Worker; the cron that fires picks the workflow.
import { describeDispatchOutcome, workflowDispatchRequest, workflowForCron } from '../../src/publisher-dispatch.js';

async function dispatch(env, cron) {
  const workflow = workflowForCron(cron, {
    publisherWorkflow: env.WORKFLOW,
    healthCron: env.HEALTH_CRON,
    healthWorkflow: env.HEALTH_WORKFLOW,
  });
  const { url, init } = workflowDispatchRequest({
    repository: env.REPOSITORY,
    workflow,
    ref: env.REF ?? 'main',
    token: env.GITHUB_TOKEN,
  });
  const response = await fetch(url, init);
  const body = response.status === 204 ? '' : (await response.text()).slice(0, 300);
  return { workflow, ...describeDispatchOutcome(response.status, body) };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const outcome = await dispatch(env, event.cron);
      // Worker logs are the only record of a poke that never reached GitHub.
      console.log(JSON.stringify({ at: new Date(event.scheduledTime).toISOString(), cron: event.cron, ...outcome }));
      if (!outcome.ok) throw new Error(`Dispatch of ${outcome.workflow} failed (${outcome.status}): ${outcome.detail}`);
    })());
  },

  // A plain GET reports whether the Worker can reach GitHub at all, without
  // waiting for the next scheduled tick. It never returns the token.
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/health') {
      return new Response('themarble publisher scheduler', { status: 200 });
    }
    const configured = Boolean(env.GITHUB_TOKEN) && Boolean(env.REPOSITORY) && Boolean(env.WORKFLOW);
    return Response.json({
      configured,
      repository: env.REPOSITORY ?? null,
      workflow: env.WORKFLOW ?? null,
      healthWorkflow: env.HEALTH_WORKFLOW ?? null,
    }, { status: configured ? 200 : 503 });
  },
};
