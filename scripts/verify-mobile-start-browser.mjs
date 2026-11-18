import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, webkit, firefox, devices } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs');
const targetUrl = process.argv.find(argument => argument.startsWith('--url='))?.slice(6);
const substituteScale = process.argv.includes('--test-mobile-scale-fix');
const useWebKit = process.argv.includes('--webkit');
const useFirefox = process.argv.includes('--firefox');
const output = (targetUrl ? 'outputs/mobile-start-remote' : 'outputs/mobile-start')
  + (substituteScale ? '-corrected' : '') + (useWebKit ? '-webkit' : '') + (useFirefox ? '-firefox' : '');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const file = path === root ? resolve(root, 'index.html') : path;
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = useWebKit ? await webkit.launch({ headless: true })
  : useFirefox ? await firefox.launch({ headless: true })
  : await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--host-resolver-rules=MAP mobile.test 127.0.0.1', '--no-proxy-server'] });
const results = [];
try {
  await mkdir(output, { recursive: true });
  for (const [name, options, hostname = '127.0.0.1'] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['mobile-390', { ...devices['iPhone 13'], defaultBrowserType: undefined }],
    ['mobile-android', { ...devices['Pixel 7'], defaultBrowserType: undefined }],
    ['mobile-landscape', { ...devices['Pixel 7 landscape'], defaultBrowserType: undefined }],
    ['mobile-http', { ...devices['Pixel 7'], defaultBrowserType: undefined }, 'mobile.test'],
  ]) {
    if ((targetUrl || useWebKit || useFirefox) && name === 'mobile-http') continue;
    // Playwright's Firefox supports touch and viewport sizing, not mobile-layout emulation.
    const context = await browser.newContext(useFirefox ? { ...options, isMobile: false } : options);
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    const cancelledImages = [];
    const consoleErrors = [];
    if (targetUrl && substituteScale) {
      await page.route(url => url.origin === new URL(targetUrl).origin && url.pathname === '/js/admin.js', async route => {
        const response = await route.fetch();
        const source = await response.text();
        assert.ok(source.includes('const windowWidth = window.innerWidth;')
          && source.includes('const windowHeight = window.innerHeight;'), 'Remote scaling code changed');
        await route.fulfill({ response, body: source
          .replace('const windowWidth = window.innerWidth;', 'const windowWidth = document.documentElement.clientWidth;')
          .replace('const windowHeight = window.innerHeight;', 'const windowHeight = document.documentElement.clientHeight;') });
      });
    }
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('requestfailed', request => {
      const failure = { url: request.url(), failure: request.failure() };
      // WebKit may cancel a CSS image when its element is hidden or removed.
      if (request.resourceType() === 'image' && request.failure()?.errorText === 'Load request cancelled') {
        cancelledImages.push(failure);
      } else failedRequests.push(failure);
    });
    page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(targetUrl || `http://${hostname}:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => {
      const game = document.querySelector('#game-windows');
      return game && Number(getComputedStyle(game).opacity) >= 0.99;
    }, null, { timeout: 15000 }).catch(error => errors.push(error.message));
    const state = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      visible: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      secure: isSecureContext,
      screen: { width: screen.width, height: screen.height },
      text: document.body.innerText.slice(0, 1000),
      children: document.body.childElementCount,
      game: [...document.querySelectorAll('#game-windows, .Game-UI, .map-container, .level-button')].slice(0, 12).map(node => ({
        class: node.className, id: node.id, bounds: node.getBoundingClientRect().toJSON(),
        display: getComputedStyle(node).display, opacity: getComputedStyle(node).opacity,
      })),
    }));
    await page.screenshot({ path: `${output}/${name}.png`, scale: 'css' });
    results.push({ name, url: page.url(), state, errors, failedRequests, cancelledImages, consoleErrors });
    try {
      if (!state.game.some(node => node.id === 'game-windows')) throw Error('Game did not initialize');
      const choose = page.locator('.entity-loot').first();
      if (options.hasTouch) await choose.tap();
      else await choose.click();
      const confirm = page.locator('.starter-select-button:not([hidden])');
      if (options.hasTouch) await confirm.tap();
      else await confirm.click();
      await page.locator('.entitylootContainer').waitFor({ state: 'detached' });
      const roster = await page.evaluate(() => JSON.parse(localStorage.getItem('selectedArmyA')));
      assert.equal(roster.length, 1, `${name}: starter selection not saved`);
      await page.waitForLoadState('networkidle');
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => {
        const game = document.querySelector('#game-windows');
        return game && Number(getComputedStyle(game).opacity) >= 0.99;
      });
      assert.equal(await page.locator('.entitylootContainer').count(), 0, `${name}: starter lost on reload`);
      results.at(-1).selectionAndReload = true;
    } catch (error) { errors.push(error.message); }
    for (const url of new Set(cancelledImages.map(request => request.url))) {
      const response = await context.request.get(url);
      if (!response.ok()) failedRequests.push({ url, status: response.status() });
    }
    console.log(`${name}: ${errors.length} errors; game ${Math.round(state.game[0]?.bounds.width)}px / viewport ${state.visible.width}px; selection/reload ${!!results.at(-1).selectionAndReload}`);
    if (errors.length || failedRequests.length || consoleErrors.length) console.log(JSON.stringify({ errors, failedRequests, consoleErrors }));
    await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
    await context.close();
  }
  await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
  for (const result of results) {
    assert.equal(result.errors.length, 0, `${result.name}: ${result.errors.join('\n')}`);
    assert.equal(result.failedRequests.length, 0, `${result.name}: resource loading failed`);
    assert.ok(result.state.children > 0 && result.state.game.length > 0, `${result.name}: game missing`);
    assert.ok(result.state.text.length > 0, `${result.name}: empty screen`);
    const game = result.state.game.find(node => node.id === 'game-windows');
    assert.ok(game.bounds.width > 0 && game.bounds.height > 0
      && game.bounds.right <= result.state.visible.width + 1
      && game.bounds.bottom <= result.state.visible.height + 1,
    `${result.name}: game extends outside the visible viewport`);
  }
  console.log(`PASS: ${results.length} cold-start profiles`);
} finally {
  await browser.close();
  server.close();
}
