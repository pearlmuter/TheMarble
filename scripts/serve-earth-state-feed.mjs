import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { earthStateDeliveryHeaders } from '../src/earth-state-delivery.js';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { readEarthStateFeedRunReport } from '../src/earth-state-feed-orchestration.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 8788;
const DEFAULT_INTERVAL_MINUTES = 30;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('Arguments must be --name value pairs');
    options[flag.slice(2)] = value;
  }
  return options;
}

function log(message) {
  process.stdout.write(`${new Date().toISOString().replace('.000Z', 'Z')} ${message}\n`);
}

function publishOnce({ outputDirectory, python }) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, [
      join(scriptDirectory, 'publish-earth-state-feed.mjs'),
      '--output', outputDirectory,
      '--python', python,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolvePromise({ ok: false, reason: error.message }));
    child.once('close', code => {
      const report = readEarthStateFeedRunReport(stdout);
      if (code !== 0 || !report) {
        // A late provider is ordinary: the previous verified state stays served.
        resolvePromise({ ok: false, reason: (stderr.trim().split('\n').at(-1) || `exit ${code}`).slice(0, 200) });
        return;
      }
      resolvePromise({ ok: true, report });
    });
  });
}

function createFeedServer(rootDirectory) {
  const root = resolve(rootDirectory);
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const requestedPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const filePath = resolve(root, requestedPath);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error('not a file');
      const headers = {
        ...earthStateDeliveryHeaders(requestedPath, earthStateMediaTypeForPath(filePath) ?? 'application/octet-stream'),
        'content-length': String(details.size),
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404, earthStateDeliveryHeaders(requestedPath)).end();
    }
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputDirectory = resolve(options.output ?? 'artifacts/earth-state');
  const python = options.python ?? 'python3';
  const port = Number(options.port ?? DEFAULT_PORT);
  const intervalMinutes = Number(options['interval-minutes'] ?? DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) throw new Error('--interval-minutes must be at least 1');
  await mkdir(outputDirectory, { recursive: true });

  const server = createFeedServer(outputDirectory);
  await new Promise(resolvePromise => server.listen(port, '127.0.0.1', resolvePromise));
  log(`Serving ${outputDirectory} at http://127.0.0.1:${port}/latest.json`);

  const publish = async () => {
    const result = await publishOnce({ outputDirectory, python });
    if (!result.ok) {
      log(`Publication did not complete: ${result.reason}. The previous verified state stays served.`);
      return;
    }
    const { severity, advanced, stages, problems } = result.report;
    const outcome = stages.map(stage => `${stage.name} ${stage.status}${stage.validAt ? ` ${stage.validAt}` : ''}`).join(', ');
    log(`Publication ${severity}: ${outcome || 'no producer ran'}${advanced.length ? ` — advanced ${advanced.join(', ')}` : ''}`);
    for (const problem of problems) log(`  ${problem.stage ?? problem.layer}: ${problem.reason}`);
  };
  await publish();
  const timer = setInterval(() => { void publish(); }, intervalMinutes * 60_000);
  log(`Checking for a newer observed hour every ${intervalMinutes} minutes.`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      clearInterval(timer);
      server.close(() => process.exit(0));
    });
  }
}

await main();
