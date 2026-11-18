import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const directory = resolve(process.env.VERIFY_OUTPUT || 'outputs/validation-complete-20261115');
await mkdir(directory, { recursive: true });
const selection = process.argv.slice(2);
const tests = (await readdir('scripts')).filter(name =>
  (/^verify-.*\.mjs$/.test(name) && name !== 'verify-suite.mjs') || name === 'index-11.test.cjs')
  .filter(name => !selection.length || selection.some(pattern => name.includes(pattern))).sort();
const results = [];
let reportWrite = Promise.resolve();
async function run(name) {
  const started = Date.now(), log = createWriteStream(resolve(directory, name + '.log'));
  const args = ['--require', resolve('scripts/browser-test-runtime.cjs'), ...(name.includes('.test.') ? ['--test'] : []), resolve('scripts', name)];
  const child = spawn(process.execPath, args, { windowsHide: true,
    env: { ...process.env, VERIFY_BROWSER: process.env.VERIFY_BROWSER || 'chrome', BROWSER_CHANNEL: 'chrome', PLAYWRIGHT_CHANNEL: 'chrome', MOBILE_ENGINES: process.env.MOBILE_ENGINES || 'chromium' } });
  child.stdout.pipe(log, { end: false });child.stderr.pipe(log, { end: false });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  }, Number(process.env.VERIFY_TIMEOUT_MS) || (name === 'verify-combat-simulation-browser.mjs' ? 600000
    : name === 'verify-combat-simulation-performance.mjs' ? 3600000 : 240000));
  const code = await new Promise(done => { child.once('error', error => { log.write(String(error));done(-1); });child.once('close', done); });
  clearTimeout(timeout);await new Promise(done => log.end(done));
  const result = { name, status: timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail', code, seconds: (Date.now() - started) / 1000 };
  results.push(result);
  const report = JSON.stringify({ browser: process.env.VERIFY_BROWSER || 'chrome', total: tests.length, finished: results.length, results }, null, 2);
  reportWrite = reportWrite.then(() => writeFile(resolve(directory, 'summary.json'), report));
  await reportWrite;
  console.log(`${result.status.toUpperCase()} ${name} (${result.seconds.toFixed(1)} s)`);
}
const exclusive = name => /performance|verify-combat-simulation-browser/.test(name);
const ordinary = tests.filter(name => !exclusive(name));
let cursor = 0;
await Promise.all(Array.from({ length: Number(process.env.VERIFY_WORKERS) || 3 }, async () => {
  while (cursor < ordinary.length) await run(ordinary[cursor++]);
}));
// Timing/performance measurements run without other test browsers competing.
for (const name of tests.filter(exclusive)) await run(name);
const failures = results.filter(result => result.status !== 'pass');
console.log(`${results.length - failures.length}/${tests.length} scripts passed; ${failures.length} failed or timed out.`);
process.exitCode = failures.length ? 1 : 0;
