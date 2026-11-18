import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, relative, sep, posix } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs');
const modules = ['js/attackInterface.js', ...(await readdir(resolve(root, 'js/ui'))).filter(f => f.endsWith('.js')).map(f => `js/ui/${f}`)];
const graph = new Map();
for (const file of modules) {
  const source = await readFile(resolve(root, file), 'utf8');
  assert.doesNotMatch(source, /from\s*['"][^'"]*GameInit\.js/, `${file} must not depend on the bootstrap`);
  const imports = [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)]
    .map(([, ref]) => posix.normalize(posix.join(posix.dirname(file), ref)));
  graph.set(file, imports.filter(ref => modules.includes(ref)));
}
function visit(file, ancestors = []) {
  assert.ok(!ancestors.includes(file), `UI import cycle: ${[...ancestors, file].join(' -> ')}`);
  for (const child of graph.get(file) || []) visit(child, [...ancestors, file]);
}
for (const file of modules) visit(file);
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/module-fixture.html') return res.end('<!doctype html><html><head><title>Module fixture</title></head><body></body></html>');
  const file = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('..' + sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
try {
  // Import each public subsystem first in a fresh module graph. No bootstrap
  // ordering may be required to initialize its shared constants or registries.
  for (const entry of ['entites', 'attackResolution', 'damagesCalcul', 'entite/entityRules',
    'entite/statSystem', 'entite/reverseArchetype', 'dom', 'GameStorage', 'entityAttributs',
    'gameState', 'fight', 'essenceInventory', 'essenceur', 'items/resourceStocks',
    'items/itemManager', 'UpgradeEntity', 'entityUpdatesStorage', 'procedural/proc-bareme',
    'data/loaderList', 'combatSimulation', 'combatPause']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/module-fixture.html');
    console.log(`Checking independent entry: ${entry}`);
    await page.evaluate(async name => { await import(`/js/${name}.js`); }, entry);
    assert.deepEqual(errors, [], `Independent import: ${entry}`);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], requests = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) consoleErrors.push(message.text());
  });
  page.on('request', request => requests.push(new URL(request.url()).pathname + new URL(request.url()).search));
  await page.addInitScript(() => {
    window.__uiRegistrations = 0;
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(...args) { window.__uiRegistrations++; return add.apply(this, args); };
  });
  await page.goto(base + '/index.html');
  await page.locator('.Game-UI').waitFor({ state: 'attached' });
  const result = await page.evaluate(async () => {
    const game = await import('/js/GameInit.js');
    const entries = await Promise.all([
      import('/js/attackInterface.js'), import('/js/ui/codex.js'), import('/js/ui/codexProfile.js'),
      import('/js/ui/codexStats.js'), import('/js/ui/equipment.js'), import('/js/ui/inventory.js'),
      import('/js/ui/playerMenus.js'), import('/js/ui/powerViews.js'), import('/js/ui/statHelpers.js'),
    ]);
    const before = window.__uiRegistrations;
    for (let i = 0; i < 3; i++) for (const module of entries) {
      for (const [name, fn] of Object.entries(module)) if (/^initialize(?:AttackInterface|Codex|CodexProfile|CodexStats|Equipment|Inventory|PlayerMenus|PowerViews|StatHelpers)$/.test(name)) fn();
    }
    const attack = entries[0], codex = entries[1], inventory = entries[5], helpers = entries[8];
    const catalogue = await import('/js/data/attackList.js');
    const resolution = await import('/js/attackResolution.js');
    return { before, after: window.__uiRegistrations,
      shared: game.MultiAttackDisplay === attack.MultiAttackDisplay && game.createCodexEntityScan === codex.createCodexEntityScan
        && game.createInventory === inventory.createInventory && game.helperEntityByRoot === helpers.helperEntityByRoot,
      constants: catalogue.ATTACK_ESSENCE_COLORS === resolution.ATTACK_ESSENCE_COLORS
        && catalogue.ATTACK_ESSENCE_MAX_SLOTS === resolution.ATTACK_ESSENCE_MAX_SLOTS,
      gameContainers: document.querySelectorAll('#game-container').length };
  });
  assert.equal(result.after, result.before, 'Repeated UI initialization adds no handlers');
  assert.equal(result.shared, true, 'Entry exports and direct module imports share functions and helper state');
  assert.equal(result.constants, true, 'Essence constants have a single catalogue owner');
  assert.equal(result.gameContainers, 1);
  assert.deepEqual(requests.filter(url => /^\/js\/admin\.js(?:\?|$)/.test(url)), ['/js/admin.js'], 'One canonical admin module');
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Bootstrap and UI initialization emit no errors');
  await context.close();
  console.log(`PASS: ${modules.length} acyclic UI modules; independent entity entry; one admin; shared exports and idempotent listeners.`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
