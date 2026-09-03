export function workflowDispatchRequest(options: {
  repository: string;
  workflow: string;
  ref?: string;
  token: string;
}): { url: string; init: RequestInit };

export function describeDispatchOutcome(status: number, body?: string): {
  ok: boolean;
  status: number;
  detail: string;
};

export function workflowForCron(cron: string | undefined, schedules: {
  publisherWorkflow: string;
  publisherCron?: string;
  healthCron?: string;
  healthWorkflow?: string;
}): string;
