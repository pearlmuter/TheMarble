import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateEarthStateFeedRun, readEarthStateFeedLayers } from '../src/earth-state-feed-orchestration.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

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

async function publishedLayers(outputDirectory) {
  try {
    const latest = JSON.parse(await readFile(join(outputDirectory, 'latest.json'), 'utf8'));
    const manifestPath = resolve(outputDirectory, latest.manifest.href.replace(/^\.\//, ''));
    const prefix = `${resolve(outputDirectory)}${sep}`;
    if (!manifestPath.startsWith(prefix)) throw new Error('Published manifest escapes output directory');
    return readEarthStateFeedLayers(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return { bundleId: 'none' };
    throw error;
  }
}

function runProducer(command, args) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.once('error', error => resolvePromise({ code: 1, stdout, error: error.message }));
    child.once('close', code => resolvePromise({ code, stdout }));
  });
}

async function runStage(name, args, options) {
  const result = await runProducer(options.node ?? process.execPath, args);
  if (result.code !== 0) {
    return { name, status: 'failed', reason: result.error ?? `The ${name} producer exited with status ${result.code}` };
  }
  try {
    const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    return { name, status: report.status === 'published' ? 'published' : 'unchanged', validAt: report.validAt };
  } catch {
    return { name, status: 'failed', reason: `The ${name} producer did not report a publication outcome` };
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const outputDirectory = resolve(options.output ?? 'artifacts/earth-state');
  const python = options.python ?? 'python3';
  await mkdir(outputDirectory, { recursive: true });
  const before = await publishedLayers(outputDirectory);

  const stages = [];
  if (options['skip-clouds'] !== 'true') {
    const cloudArgs = options['cloud-catalog']
      ? [join(scriptDirectory, 'publish-cloud-earth-state.mjs'), '--catalog', options['cloud-catalog']]
      : [join(scriptDirectory, 'publish-gmgsi-earth-state.mjs')];
    stages.push(await runStage('clouds', [
      ...cloudArgs,
      '--python', python,
      '--output', outputDirectory,
      ...(options['public-root'] ? ['--public-root', options['public-root']] : []),
    ], options));
  }

  if (options['cryosphere-catalog']) {
    stages.push(await runStage('cryosphere', [
      join(scriptDirectory, 'publish-cryosphere-earth-state.mjs'),
      '--catalog', options['cryosphere-catalog'],
      '--python', python,
      '--output', outputDirectory,
      ...(options['public-root'] ? ['--public-root', options['public-root']] : []),
    ], options));
  }

  const after = await publishedLayers(outputDirectory);
  const report = evaluateEarthStateFeedRun({
    before,
    after,
    stages,
    checkedAt: new Date(options.now ?? Date.now()).toISOString().replace('.000Z', 'Z'),
  });
  const reportPath = options.report ? resolve(options.report) : join(outputDirectory, 'feed-run.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ ...report, before, after }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.coherent) process.exitCode = 1;
}

await main();
