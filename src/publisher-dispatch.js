// GitHub's scheduled workflows are best-effort: a */10 cron on this repository has
// been firing roughly every five hours, which leaves the published Earth state
// stale for most of the day. Cloudflare runs Worker cron triggers on its own
// scheduler, so the trigger lives there and only asks GitHub to run the producer.
const API_VERSION = '2022-11-28';

export function workflowDispatchRequest({ repository, workflow, ref = 'main', token }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error(`Invalid repository: ${repository}`);
  if (!/^[\w.-]+\.ya?ml$/.test(workflow ?? '')) throw new Error(`Invalid workflow file: ${workflow}`);
  if (!token) throw new Error('A workflow dispatch requires a GitHub token');
  return {
    url: `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`,
    init: {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'themarble-publisher-scheduler',
        'x-github-api-version': API_VERSION,
      },
      body: JSON.stringify({ ref }),
    },
  };
}

/**
 * GitHub answers a dispatch with 204 and no body. Anything else is worth
 * surfacing, but a failed poke must never throw away the reason.
 */
export function describeDispatchOutcome(status, body) {
  if (status === 204) return { ok: true, status, detail: 'workflow dispatched' };
  if (status === 401 || status === 403) return { ok: false, status, detail: `token rejected: ${body || 'no detail'}` };
  if (status === 404) return { ok: false, status, detail: 'repository or workflow not found, or the token cannot see it' };
  return { ok: false, status, detail: body || 'unexpected response' };
}

/**
 * One Worker, two schedules. Cloudflare reports which cron fired, so the trigger
 * picks the workflow. An unknown or absent cron pokes the publisher: a duplicate
 * poke reports `unchanged` and costs one API call, while a missed publish leaves
 * the globe stale.
 */
export function workflowForCron(cron, { publisherWorkflow, healthCron, healthWorkflow }) {
  if (healthWorkflow && healthCron && cron === healthCron) return healthWorkflow;
  return publisherWorkflow;
}
