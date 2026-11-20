import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs');
const webgl = process.env.LEVEL_WEBGL === '1';
const counts = new Map();
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  counts.set(url.pathname, (counts.get(url.pathname) || 0) + 1);
  const path = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', mime[extname(path)] || 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    let data = await readFile(path === root ? resolve(root, 'index.html') : path);
    if (path === resolve(root, 'js/rendering/animations.js')) data = data.toString()
      + '\nexport const testLevelRenderer = () => phaserLayer;';
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/${webgl ? "?monsters=webgl" : ""}`);
  const result = await page.evaluate(async () => {
    const { collectLevelResources, prepareLevelResources } = await import('/js/data/loaderList.js');
    const { entitesNest } = await import("/js/data/entityTemplates.js");
    const { enrichEntityStats } = await import("/js/entities/runtime.js");
    const actor = enrichEntityStats({ ...structuredClone(entitesNest.find(e => e.serial === 900013)), id: 987123, side: 'A', level: 1 });
    const sources = collectLevelResources({ entities: [actor], biome: 'prison' });
    const progress = [];
    try { await prepareLevelResources(sources, { onProgress: state => progress.push(state) }); }
    catch (error) { return { errors: (error.errors || [error]).map(e => e.message), count: sources.size }; }
    const cache = await import('/js/data/loaderList.js');
    const img = document.createElement('img'); document.body.append(img);
    await cache.playCachedGif(img, './media/assets/effects/heal-green.gif');
    const first = img.src;
    await cache.playCachedGif(img, './media/assets/effects/heal-green.gif');
    if (first === img.src || !img.src.startsWith('blob:')) throw Error('GIF did not restart from cached bytes');
    await prepareLevelResources(sources);
    return { count: sources.size, progress: progress.at(-1), errors: [] };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.errors, []);
  assert.equal(counts.get('/media/assets/effects/heal-green.gif'), 1);
  const launch = await page.evaluate(async () => {
    const { entitesNest } = await import("/js/data/entityTemplates.js");
    const { enrichEntityStats } = await import("/js/entities/runtime.js");
    const actor = enrichEntityStats({ ...structuredClone(entitesNest.find(e => e.serial === 900013)), id: 987124, side: 'A', level: 1 });
    const enemy = enrichEntityStats({ ...structuredClone(entitesNest.find(e => e.serial === 900013)), id: 987125, side: 'B', level: 1 });
    localStorage.setItem('selectedArmyA', JSON.stringify([actor]));
    localStorage.setItem('ArmyB', JSON.stringify({ armies: { 'ArmyB_loader-test': { entities: [enemy], ArmyB_id: 'ArmyB_loader-test' } } }));
    localStorage.setItem('GameStages', JSON.stringify({ stages: [{ id: 'loader-test', biome_serial: 'prison', difficulty: 1, level_type: 'scripted' }] }));
    window.currentStageId = 'loader-test'; window.levelRunning = 'scripted';
    const { launchLevel } = await import("/js/app/stages.js");
    return await Promise.race([
      launchLevel({ biome: 'prison', difficulty: 1, levelId: 'loader-test' }).then(loaded => ({ loaded, progress: document.getElementById('loadingProgressBar')?.style.width })),
      new Promise(resolve => setTimeout(() => resolve({ error: document.querySelector('.loading-resource-errors')?.textContent || document.querySelector('.loading-h2')?.textContent || 'timeout' }), 25000))
    ]);
  });
  console.log('Launch:', launch);
  assert.equal(launch.loaded, true);
  assert.equal(launch.progress, '100%');
  assert.equal(await page.locator('.battle-satchel--combat').count(), 0);
  await page.evaluate(() => {
    window.satchelAppearance = null;
    const observer = new MutationObserver(() => {
      const bag = document.querySelector('.battle-satchel--combat');
      if (!bag) return;
      window.satchelAppearance = {
        correctParent: bag.parentElement.classList.contains('Game-UI'),
        hasStartButton: Boolean(document.querySelector('#startButton')),
        loadingScreen: Boolean(document.getElementById('loadingScreen')),
      };
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.locator('.loading-h2.loaded').click();
  await page.waitForFunction(() => {
    const hud = document.querySelector('.hud-ingame');
    return !document.querySelector('.loading-screen') && hud
      && hud.style.opacity === '1' && hud.style.transition === '';
  });
  // Exercise the live level and the persistent Phaser scene, not a synthetic
  // combat fixture. Screen teardown detaches the host but keeps that scene.
  const shoot = async label => {
    await page.evaluate(async () => {
      const R = await import('/js/rendering/animations.js');
      const { entites } = await import('/js/entities/runtime.js');
      window.testLevelHits = 0;
      void R.animationProjectile(entites[0], entites[1], () => {
        window.testLevelHits++; return 'hit';
      }, { executionTime: 1200, effectProjectile: 'profanation-fx' });
    });
    await page.waitForTimeout(180);
    const view = await page.evaluate(async () => {
      const l = (await import('/js/rendering/animations.js')).testLevelRenderer();
      return { connected: l.host.isConnected, hidden: l.host.hidden,
        canvas: Boolean(document.querySelector('#phaser-projectiles canvas')) };
    });
    assert.deepEqual(view, { connected: true, hidden: false, canvas: true }, label);
    await page.waitForFunction(() => window.testLevelHits === 1);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.testLevelHits), 1, 'One impact per visual');
  };
  await shoot('First level projectile');
  await page.evaluate(async () => (await import('/js/rendering/animations.js')).testLevelRenderer().host.remove());
  await shoot('Projectile after screen teardown');
  if (webgl) {
    await page.waitForFunction(() => document.getElementById('hexGrid')?.dataset.canvasBoard === 'ready');
    const vertices = () => page.evaluate(async () => {
      const l = (await import('/js/rendering/animations.js')).testLevelRenderer();
      return l.scene.children.list.filter(o => o.type === 'Mesh' && o.depth === 1000)
        .reduce((total, mesh) => total + mesh.vertices.length, 0);
    });
    const before = await vertices(); assert.ok(before > 0);
    await page.evaluate(() => { document.querySelector('.foreground-img').style.left = '4000px'; });
    await page.waitForTimeout(350);
    assert.equal(await vertices(), before, 'Offscreen foreground retains its geometry');
    await page.evaluate(() => {
      const fg = document.querySelector('.foreground');
      fg.style.transition = 'transform 300ms linear'; fg.style.transform = 'translateX(-4000px)';
    });
    await page.waitForTimeout(600);
    assert.equal(await vertices(), before, 'Foreground returns complete');
    await page.evaluate(() => {
      const fg = document.querySelector('.foreground'); fg.style.removeProperty('transition'); fg.style.removeProperty('transform'); document.querySelector('.foreground-img').style.removeProperty('left');
    });
  }
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 },
    { width: 390, height: 740 }, { width: 1536, height: 900 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(350);
    const bounds = await page.evaluate(async () => {
      const l = (await import('/js/rendering/animations.js')).testLevelRenderer();
      return { root: document.getElementById('game-windows').getBoundingClientRect().toJSON(),
        body: document.body.getBoundingClientRect().toJSON(),
        canvas: { width: l.game.canvas.width, height: l.game.canvas.height } };
    });
    assert.equal(bounds.body.width, size.width); assert.equal(bounds.body.height, size.height);
    assert.deepEqual(bounds.canvas, size, 'One canvas follows the viewport');
    assert.ok(bounds.root.x >= -1 && bounds.root.y >= -1 && bounds.root.right <= size.width + 1
      && bounds.root.bottom <= size.height + 1, 'Logical game fits the visible surface');
  }
  console.log('PASS: projectile lifecycle, unique impacts and portrait/landscape viewport');
  assert.equal(await page.locator('.battle-satchel--combat').count(), 0, 'Satchel stays hidden until combat starts');
  assert.equal(await page.evaluate(() => window.satchelAppearance), null);
  await page.evaluate(() => document.querySelectorAll('.entitylootContainer, #black-overlay').forEach(node => node.remove()));
  await page.locator('#startButton').click();
  await page.waitForFunction(() => window.satchelAppearance !== null);
  assert.deepEqual(await page.evaluate(() => window.satchelAppearance), {
    correctParent: true, hasStartButton: false, loadingScreen: false,
  });
  console.log('PASS: satchel appears inside Game-UI after starting combat, never during loading or placement');
  await page.evaluate(async () => {
    const state = await import("/js/app/state.js");
    const items = await import('/js/items/itemManager.js');
    const { ItemDetails } = await import('/js/data/itemList.js');
    const init = await import("/js/ui/application.js");
    window.levelRunning = 'worldmap'; state.refreshStageAccess();
    for (const [index, serial] of ['i8', 'i4', 'i4', 'i0'].entries()) {
      items.moveBattleItem(items.acquireItem(ItemDetails.find(item => item.serial === serial), 'visual-test').itemId, index);
    }
    window.levelRunning = 'scripted'; state.refreshStageAccess();
    init.closeStagePlayerMenus();
    // Fresh-browser starter selection is unrelated to this loaded-stage fixture.
    document.querySelectorAll('.entitylootContainer, #black-overlay').forEach(node => node.remove());
    const distance = node => {
      const rect = node.getBoundingClientRect();
      return Math.hypot(rect.x + rect.width / 2 - innerWidth * 0.4, rect.y + rect.height / 2 - innerHeight * 0.4);
    };
    const hex = [...document.querySelectorAll('.hex.SideA')]
      .filter(node => !node.querySelector('.entite-box'))
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!items.dropBattleItemOnHex(items.getBattleInventoryState().battleSlots[3], hex)) throw Error('Ground visual setup failed');
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.battle-ground-item, .battle-satchel-item')].every(img => img.complete && img.naturalWidth > 0));
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.battle-satchel--combat')).opacity) > 0.99);
  const ground = page.locator('.battle-ground-item');
  await ground.waitFor({ state: 'visible' });
  const groundBounds = await ground.boundingBox();
  assert.ok(groundBounds.x >= 0 && groundBounds.y >= 0 && groundBounds.x + groundBounds.width <= 1536 && groundBounds.y + groundBounds.height <= 900);
  await mkdir('outputs/battle-inventory', { recursive: true });
  await page.screenshot({ path: 'outputs/battle-inventory/real-level-ground.png' });
  const groundItemId = await ground.getAttribute('data-drag-item-id');
  // The loot floats continuously; a native drag must not wait for a stable animation frame.
  await ground.dragTo(page.locator('.battle-satchel--combat [data-battle-slot="3"]'), { force: true });
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('PlayerSave')).battleSlots[3] === id, groundItemId);
  assert.equal(await ground.count(), 0);
  console.log('PASS: native ground-to-satchel drag on a loaded level');
  await page.evaluate(async () => (await import('/js/items/itemManager.js')).clearBattleGroundItems());
  const failure = await page.evaluate(async () => {
    const state = await import("/js/app/state.js");
    const { launchLevel } = await import("/js/app/stages.js");
    const createElement = document.createElement;
    document.createElement = function(tag, ...args) {
      if (tag === 'h2') throw Error('Injected loader initialization failure');
      return createElement.call(this, tag, ...args);
    };
    let loaded;
    try { loaded = await launchLevel({ biome: 'prison', difficulty: 1, levelId: 'loader-test' }); }
    finally { document.createElement = createElement; }
    const failedAccess = state.getStageAccess();
    window.levelRunning = 'worldmap'; state.refreshStageAccess();
    const mapAccess = state.getStageAccess();
    return { loaded, failedAccess, mapAccess };
  });
  assert.equal(failure.loaded, false);
  assert.equal(failure.failedAccess.loading, false);
  assert.equal(failure.failedAccess.unavailable, true);
  assert.equal(failure.mapAccess.unavailable, false);
  assert.equal(failure.mapAccess.menusAllowed, true);
  const retryPage = await browser.newPage();
  let attempts = 0;
  await retryPage.route('**/media/assets/effects/heal-green.gif', route => ++attempts === 1
    ? route.fulfill({ status: 503, body: 'Temporary failure' }) : route.continue());
  await retryPage.goto(`http://127.0.0.1:${server.address().port}/`);
  await retryPage.evaluate(async () => {
    (await import("/js/storage/gameStorage.js")).setAdminMode(true);
    window.levelRunning = 'admin';
    const { launchLevel } = await import("/js/app/stages.js");
    window.loaderResult = launchLevel({ biome: 'prison', difficulty: 1, levelId: 'retry-test' });
  });
  assert.equal(await retryPage.evaluate(() => window.loaderResult), true);
  assert.ok(attempts >= 2, 'Failed resources are retried after the other loading work');
  assert.equal(await retryPage.locator('.loading-retry, .loading-resource-errors').count(), 0);
  assert.equal(await retryPage.locator('#loadingProgressBar').evaluate(node => node.style.width), '100%');
  await retryPage.close();

  const ignoredPage = await browser.newPage();
  let failedAttempts = 0;
  await ignoredPage.route('**/media/assets/effects/heal-green.gif', route => {
    failedAttempts += 1;
    return route.fulfill({ status: 404, body: 'Missing asset' });
  });
  await ignoredPage.goto(`http://127.0.0.1:${server.address().port}/`);
  const ignored = await ignoredPage.evaluate(async () => {
    (await import("/js/storage/gameStorage.js")).setAdminMode(true);
    window.levelRunning = 'admin';
    const { launchLevel } = await import("/js/app/stages.js");
    return launchLevel({ biome: 'prison', difficulty: 1, levelId: 'ignored-resource-test' });
  });
  assert.equal(ignored, true);
  assert.ok(failedAttempts >= 2, 'Permanently missing resource was retried before being ignored');
  assert.equal(await ignoredPage.locator('.loading-retry, .loading-resource-errors').count(), 0);
  assert.equal(await ignoredPage.locator('#loadingProgressBar').evaluate(node => node.style.width), '100%');
  await ignoredPage.close();

  // Cold first visit must exercise the actual world-map click and ArmyB factory.
  const firstVisit = await browser.newPage();
  const visitErrors = [];
  firstVisit.on('pageerror', error => visitErrors.push(error.message));
  await firstVisit.goto(`http://127.0.0.1:${server.address().port}/`);
  const fixture = await firstVisit.evaluate(async () => {
    (await import("/js/storage/gameStorage.js")).setAdminMode(true);
    const { entitesNest } = await import("/js/data/entityTemplates.js");
    const { enrichEntityStats } = await import("/js/entities/runtime.js");
    const actor = enrichEntityStats({ ...structuredClone(entitesNest.find(entity => entity.serial === 900013)), id: 987126, side: 'A', level: 1 });
    localStorage.setItem('selectedArmyA', JSON.stringify([actor]));
    const map = await import("/js/app/worldMap.js");
    map.rebuildWorldMapLevelButtons();
    const button = document.querySelector('.level-button.scripted');
    const stageId = button.dataset.storageid;
    const data = JSON.parse(localStorage.getItem('GameStages'));
    const other = data.stages.find(stage => stage.id !== stageId && stage.biome_serial === 'prison');
    data.stages = [other, ...data.stages.filter(stage => stage !== other)];
    localStorage.setItem('GameStages', JSON.stringify(data));
    const otherDifficulty = JSON.stringify(other.difficulty);
    map.initializeButtonClicks();
    map.initializeButtonClicks();
    button.click();
    document.querySelector('.level-button.admin').click();
    return { stageId, otherId: other.id, otherDifficulty };
  });
  await firstVisit.locator('.loading-h2.loaded').waitFor();
  const readFirstVisit = () => firstVisit.evaluate(async ({ stageId, otherId }) => {
    const { entites } = await import("/js/entities/runtime.js");
    const army = JSON.parse(localStorage.getItem('ArmyB')).armies[`ArmyB_${stageId}`];
    const other = JSON.parse(localStorage.getItem('GameStages')).stages.find(stage => stage.id === otherId);
    return {
      stageId: window.currentStageId, mode: window.levelRunning,
      army: army.entities.map(entity => ({ id: entity.id, serial: entity.serial, level: entity.level.current })),
      runtimeB: entites.filter(entity => entity.side === 'B').map(entity => ({ id: entity.id, level: entity.level.current, hp: entity.stats.HP.current })),
      spriteReady: [...document.querySelectorAll('.sprite-canvas.side-B')].some(canvas => canvas.width > 0 && canvas.height > 0),
      otherDifficulty: JSON.stringify(other.difficulty),
      mapFetch: performance.getEntriesByType('resource').some(entry => entry.initiatorType === 'fetch' && entry.name.endsWith('/media/worldmap.jpg')),
      loaders: document.querySelectorAll('.loading-screen').length,
    };
  }, fixture);
  const generated = await readFirstVisit();
  assert.equal(generated.stageId, fixture.stageId);
  assert.equal(generated.mode, 'scripted');
  assert.equal(generated.army.length, 1);
  assert.equal(generated.army[0].serial, 7);
  assert.equal(generated.army[0].level, 5);
  assert.equal(generated.runtimeB[0].level, 5);
  assert.ok(generated.runtimeB[0].hp > 0);
  assert.ok(generated.spriteReady);
  assert.equal(generated.otherDifficulty, fixture.otherDifficulty);
  assert.equal(generated.mapFetch, false);
  assert.equal(generated.loaders, 1);
  await firstVisit.reload();
  await firstVisit.locator('.loading-h2.loaded').waitFor();
  const restored = await readFirstVisit();
  assert.deepEqual(restored.army, generated.army);
  assert.deepEqual(restored.runtimeB, generated.runtimeB);
  const missingArmy = await firstVisit.evaluate(async () => {
    const data = JSON.parse(localStorage.getItem('GameStages'));
    data.stages.push({ id: 'missing-army-test', biome_serial: 'prison', level_type: 'scripted', difficulty: {}, scripted_entites: { sbires: [{ serial: 7, level: 5 }], lords: [] } });
    localStorage.setItem('GameStages', JSON.stringify(data));
    document.addEventListener('difficultyUpdated', event => event.stopImmediatePropagation(), { capture: true, once: true });
    const { launchLevel } = await import("/js/app/stages.js");
    const loaded = await launchLevel({ levelId: 'missing-army-test', biome: 'prison', difficulty: {} });
    return { loaded, message: [...document.querySelectorAll('.loading-h2')].at(-1).textContent };
  });
  assert.equal(missingArmy.loaded, false);
  assert.match(missingArmy.message, /Armée B.*absente ou incomplète/);
  assert.deepEqual(visitErrors, []);
  await firstVisit.close();
  console.log('PASS: cold scripted click, level-5 side B, shared-biome isolation, duplicate clicks, reload identity, missing-army guard and no world-map preload');
  assert.deepEqual(errors, []);
  console.log('PASS: level resources and independent cached GIF replay');
} finally { await browser.close(); server.close(); }
