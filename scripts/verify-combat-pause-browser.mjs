import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs'), output = resolve('outputs/paused-combat');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });

const errors = [];
async function fixture(config = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.testLog=[];page.on('console',message=>page.testLog.push(message.text()));
  page.on('console', message => { if (message.type()==='error' && !message.text().includes('Failed to load resource')) console.error(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.evaluate(async config => {
    window.P = await import("/js/combat/pause.js"); await P.restorePausedCombat();
    window.Clock = await import("/js/combat/clock.js");
    const { loadResource } = await import('/js/data/loaderList.js');
    const gif = await loadResource('/media/assets/effects/ambidextry.gif');
    const bytes = new Uint8Array(await gif.blob.arrayBuffer());
    const marker = new TextDecoder('latin1').decode(bytes).indexOf('NETSCAPE2.0');
    if (marker < 0 || bytes[marker + 13] || bytes[marker + 14]) throw Error('GIF should loop while combat time is paused');

    const U = await import("/js/ui/application.js");
    const E = await import("/js/entities/runtime.js");
    const C = await import("/js/rendering/entities.js");
    const S = await import("/js/storage/gameStorage.js");
    const template = (await import("/js/data/entityTemplates.js")).entitesNest.find(e => e.serial === 900013);
    U.createGameContainer(); U.GameUi(); S.setAdminMode(true); window.levelRunning = 'admin';
    document.querySelector('.worldmap')?.remove();
    const store = await import("/js/storage/sessionStorage.js");
    store.beginAdminSession(); window.currentStageId = 'pause-test';
    store.gameStorage.setItem('GameStages', JSON.stringify({stages:[{id:'pause-test',level_type:'admin'}]}));
    store.gameStorage.setItem('currentLevel','pause-test');
    window.baseStorage = JSON.stringify(Object.entries(window.localStorage).sort());
    const grid = document.createElement('div'); grid.id = 'hexGrid';
    grid.style.cssText = 'position:absolute;top:100px;left:180px;width:850px;height:500px';
    document.getElementById('game-container').append(grid); E.entites.length = 0;
    for (const [i, side] of ['A', 'B'].entries()) {
      const hex = document.createElement('div'); hex.className = `hex Side${side} occupied`; hex.dataset.position = String(i + 1);
      hex.style.cssText = `position:absolute;left:${i * 400}px;top:50px;width:180px;height:200px`; grid.append(hex);
      const own = config[side] || {};
      const magic = own.magic || false;
      const entity = E.enrichEntityStats({ ...structuredClone(template), id: 999820 + i, name: `Simultané ${side}`, side,
        type: 'sbire', role: 'gueux', position: String(i+1), level: 1, awakening: 1, stuff: {}, stats: {}, modifierStats: {},
        baseStats: { HP: 1000, strength: 0, intelligence: 0, agility: 0, physicalDamage: 40, magicalDamage: 40,
          speed: config.speed ?? 100, extraLife: own.extraLife || 0 },
        attacks: [{ functionName: config.phaser ? 'shot-p-r' : 'simultaneous-test', attackId: 'simultaneous-test', displayName: 'Impact simultané',
          combatFunction: own.support ? 'Support' : 'Attaquant', attacknature: own.natures || [magic ? 'magicalDamage' : 'physicalDamage'],
          attackRange: [own.range || 'melee'], attackTarget: [own.support ? 'ally' : 'enemy'], deadTarget: ['no'], type: [], effets: own.effects || (own.support ? ['heal'] : []), selfEffects: [],
          preparationTime: own.preparation ?? 500, executionTime: own.execution ?? 1800, recoveryTime: own.recovery ?? 300, cooldown: 20000,
          physicalRatio: magic ? 0 : 1, magicalRatio: magic ? 1 : 0, piercingRatio: 0 }] });
      entity.statut = ['alive']; entity.isDEAD = false; E.entites.push(entity);
      const created = C.createEntiteInDOM(entity); hex.append(created.element); await created.spriteReady;
    }
    const boardController = await import('/js/board/controller.js');
    boardController.invalidateFootprintGeometry(grid); boardController.rebuildBoardOccupancy(grid);
    window.E = E; window.G = await import("/js/app/state.js"); window.F = await import("/js/combat/loop.js");
    G.configureBattleActionManager({ createStartButton: container=>container, createFleeButton: container=>container, createQuitButton: container=>container });
    window.Timeline = await import("/js/combat/timeline.js"); window.Attacks = await import('/js/combat/attacks.js');
    window.Sim = await import("/js/debug/simulation.js"); window.snapshot = Sim.captureSimulationBoard();
    window.entries = [];
    window.addEventListener('combatLogEntry', event => {
      const { type, data } = event.detail;
      entries.push({ type, at: Timeline.combatNow(), side: data.attacker?.side || data.entity?.side, damage: data.damage });
    });
  }, config);
  return page;
}

try {
  if (!process.env.PAUSE_EXTRA_ONLY) {
  for (const mode of (process.env.PAUSE_TEST_MODE ? [process.env.PAUSE_TEST_MODE] : ['range', 'melee', 'phaser', 'magical', 'mixed', 'triple'])) {
  const natures = mode === 'magical' ? ['magicalDamage'] : mode === 'mixed' ? ['hybridalDamage']
    : mode === 'triple' ? ['hybridalDamage', 'piercingDamage'] : ['physicalDamage'];
  const own = { range: mode === 'melee' ? 'melee' : 'range', natures,
    execution: mode === 'phaser' ? 6000 : 1800, magic: mode === 'magical' };
  const page = await fixture({ phaser: mode === 'phaser', A: own, B: own });
  await page.evaluate(async () => {
    G.startGame();
    const {poison} = await import("/js/combat/effects.js");
    poison(E.entites[0], { effectDot: 9, effectDuration: 4, type: ['alteration'] }, E.entites[1]);
  });
  await page.waitForSelector(mode !== 'melee' ? '#phaser-projectiles:not([hidden]) canvas' : 'canvas[id^=meleeClone_]');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#combat-pause-control')?.textContent === 'Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
  const read = () => page.evaluate(async () => {
    const { entites } = await import("/js/entities/runtime.js");
    const clock = await import("/js/combat/clock.js");
    return { paused: clock.isCombatPaused(), now: clock.clockNow(),
      board: (await import('/js/board/controller.js')).getBoardSnapshot(),
      positions: entites.map(entity => document.getElementById(`Box_Entite_${entity.id}`)?.closest('.hex')?.dataset.position),
      e: entites.map(e => ({ id:e.id,hp:e.stats.HP.current,turn:e.turnCount,prep:e.preparationTime,speed:e.speedTimer,action:e._combatAction,cooldowns:e.attackSelection?.readyAt })),
      projectiles:[...document.querySelectorAll('.projectile-parent')].map(el=>({id:el.id,transform:el.style.transform})),
      phaser: entites.flatMap(entity => (entity.projectiles || []).filter(p => p.status === 'in-flight' && p.visual?.renderer === 'phaser').map(p => ({id:p.id, visual:p.visual}))),
      effects: [...document.querySelectorAll('.effect-vfx')].map(el=>el.id),
      melee: [...document.querySelectorAll('canvas[id^=meleeClone_]')].map(el=>({id:el.id, transform:getComputedStyle(el).transform,opacity:getComputedStyle(el).opacity})),
    };
  });
  const before = await read();
  if (mode === 'phaser') {
    assert.equal(before.phaser.length, 2);
    assert.ok(before.phaser.every(p => p.visual.progress > 0 && p.visual.progress < 1));
    assert.equal(await page.locator('.projectile-parent').count(), 0);
    await page.screenshot({path:resolve(output,'phaser-paused.png')});
  }
  assert.equal(before.paused,true); if (mode === 'range') assert.equal(before.phaser.length,2);
  await page.waitForTimeout(2600);
  assert.deepEqual(await read(),before,'live pause freezes deadlines, positions, damage and phases');
  await page.evaluate(async () => {
    const name = (await indexedDB.databases()).find(db => db.name?.toLowerCase().includes('pause'))?.name;
    if (!name) throw Error('Missing pause database');
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pause', 'readwrite'), store = tx.objectStore('pause'), request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        const snapshot = cursor.value;
        if (!snapshot.board?.placements.length) throw Error('Checkpoint lacks combat board data');
        snapshot.visuals.html = snapshot.visuals.html.map(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const first = doc.querySelector('#hexGrid .hex');
          if (first) doc.querySelectorAll('#hexGrid .entite-box').forEach(box => { first.append(box); box.dataset.position = 'wrong'; });
          return doc.body.innerHTML;
        });
        cursor.update(snapshot); cursor.continue();
      };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#combat-pause-control')?.textContent === 'Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
  if (mode !== 'melee') await page.waitForSelector('#phaser-projectiles:not([hidden]) canvas');
  const restored = await read();
  const compare=(actual,expected,message)=>{
    const {melee:am,...a}=actual,{melee:bm,...b}=expected;assert.deepEqual(a,b,message);
    assert.equal(am.length,bm.length);
    for(let i=0;i<am.length;i++) {
      assert.equal(am[i].id,bm[i].id);
      const x=am[i].transform.match(/-?\d*\.?\d+/g).map(Number),y=bm[i].transform.match(/-?\d*\.?\d+/g).map(Number);
      x.forEach((v,j)=>assert.ok(Math.abs(v-y[j]) < (j < 4 ? 0.00001 : 0.01),'CSS matrix serialization precision: '+JSON.stringify({x,y})));
      assert.ok(Math.abs(Number(am[i].opacity)-Number(bm[i].opacity))<0.00001);
    }
  };
  compare(restored,before,'F5 restores the exact paused fight');
  await page.waitForTimeout(1800);
  compare(await read(),before,'reload does not restart timers');
  await page.screenshot({path:resolve(output,'restored-paused.png')});
  await page.evaluate(() => {
    window.resumedImpacts = [];
    window.addEventListener('combatLogEntry', event => {
      if (event.detail.type === 'damage_resolution' && ['simultaneous-test','shot-p-r'].includes(event.detail.data.attack?.functionName))
        resumedImpacts.push(event.detail.data.attacker.id);
    });
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(async () => !(await import("/js/combat/clock.js")).isCombatPaused());
  await page.waitForFunction(() => resumedImpacts.length >= 2, null, {timeout:10000});
  await page.waitForTimeout(100);
  // Freeze before an ordinary next turn can resolve another legitimate attack.
  await page.evaluate(async () => (await import('/js/combat/pause.js')).pauseCombat());
  const after = await read();
  assert.ok(after.e.every((e,i)=>e.hp<before.e[i].hp),'both saved impacts apply after resume');
  assert.deepEqual(await page.evaluate(()=>resumedImpacts.sort()), before.e.map(e=>e.id).sort(), 'Each saved attack resolves exactly once, for every nature');
  await page.evaluate(async () => (await import("/js/combat/pause.js")).pauseCombat());
  const pausedAgain = await read();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#combat-pause-control')?.textContent === 'Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
  compare(await read(),pausedAgain,'second pause/reload retains elapsed combat time');
  await page.evaluate(async () => (await import("/js/app/state.js")).StopGame({preserveScene:true}));
  assert.equal(await page.evaluate(async () => (await import("/js/combat/clock.js")).isCombatPaused()),false);
  await page.close();
  console.log('PASS pause/restoration: '+mode);
  }
  for (const phase of ['speed', 'preparation', 'recovery']) {
    const page = await fixture({ speed: phase === 'speed' ? 2000 : 100,
      A: { range: 'melee', preparation: phase === 'preparation' ? 2000 : 100, execution: 250, recovery: 2000 },
      B: { range: 'melee', preparation: phase === 'preparation' ? 2000 : 100, execution: 250, recovery: 2000 } });
    await page.evaluate(() => G.startGame());
    await page.waitForFunction(phase => E.entites[0]._combatAction?.stage === phase || phase === 'speed' && E.entites[0]._turnStage === 'speed',phase);
    if (phase === 'speed') {
      await page.evaluate(() => { const i=document.createElement('input');i.id='pause-text-test';document.body.append(i);i.focus(); });
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(()=>Clock.isCombatPaused()),false,'typing space does not pause');
      await page.evaluate(()=>document.getElementById('pause-text-test').remove());
    }
    await page.evaluate(async () => {
      const U=await import("/js/ui/display.js"), An=await import("/js/rendering/animations.js");
      U.EffectMessage(E.entites[0], 'Test pause');
      An.animateEsoterism(E.entites[0].id);
      const {entityBattleBooste}=await import("/js/entities/rules.js");
      entityBattleBooste(E.entites[0],{stat:'strength',value:7,durationMs:1200,source:'pause-test'});
    });
    await page.waitForTimeout(90);
    await page.evaluate(()=>P.pauseCombat());
    const read=()=>page.evaluate(async()=>{
      const {entites}=await import("/js/entities/runtime.js");
      return entites.map(e=>({hp:e.stats.HP.current,speed:e.speedTimer,prep:e.preparationTime,recovery:e.recoveryTime,turn:e.turnCount,
        action:e._combatAction,boosts:Object.values(e.battleBoosts||{}).flat().map(b=>({id:b.id,value:b.value,expiresAt:b.expiresAt})),
        filter:document.getElementById(`spriteCanvas_${e.id}`).style.filter,
        popup:document.getElementById(`PopUp_${e.id}`).textContent}));
    });
    const before=await read();await page.waitForTimeout(1400);assert.deepEqual(await read(),before);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.deepEqual(await read(),before,phase+' restore');
    await page.keyboard.press('Space');
    await page.waitForTimeout(2300);
    assert.ok((await read()).every(e=>!e.boosts.some(b=>b.value===7)),'restored boost expires');
    await page.evaluate(async()=>(await import("/js/app/state.js")).StopGame({preserveScene:true}));
    await page.close();console.log('PASS phase: '+phase+' with popup, canvas tint and timed boost');
  }
  }
  {
    const page = await fixture({speed:500,A:{support:true},B:{support:true}});
    await page.evaluate(()=>G.startGame());
    await page.waitForFunction(()=>E.entites[1].orderPhase==='orderDecision');
    await page.waitForTimeout(200); await page.evaluate(()=>P.pauseCombat());
    const read=()=>page.evaluate(async()=>{
      const {entites}=await import("/js/entities/runtime.js");
      return entites.map(e=>({id:e.id,phase:e.orderPhase,timer:e._phaseTimer,hp:e.stats.HP.current,stats:e.combatStats}));
    });
    const before=await read();await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.deepEqual(await read(),before,'flee phase restores without a new order or roll');
    await page.waitForTimeout(2300); assert.deepEqual(await read(),before);
    await page.keyboard.press('Space');
    await page.evaluate(async()=>{window.RestoredState=await import("/js/app/state.js");});
    await page.waitForFunction(()=>RestoredState.battleOutcome==='victory',null,{timeout:20000});
    await writeFile(resolve(output,'flee-reload-log.txt'),page.testLog.join('\n'));
    const fleeResult=await page.evaluate(async()=>({message:document.querySelector('#gameOverMessage')?.textContent,paused:(await import("/js/combat/clock.js")).isCombatPaused(),outcome:(await import("/js/app/state.js")).battleOutcome,started:(await import("/js/app/state.js")).gameStarted,entities:(await import("/js/entities/runtime.js")).entites.map(e=>({id:e.id,side:e.side,hasFled:e.hasFled,isDEAD:e.isDEAD,hp:e.stats.HP.current,phase:e.orderPhase}))}));
    assert.equal(fleeResult.entities.filter(e=>e.side==='B'&&!e.hasFled&&!e.isDEAD).length,0,JSON.stringify(fleeResult));
    await page.close();console.log('PASS flee: F5 during decision, paused remaining time, normal victory after resume');
  }
  {
    const page=await fixture({speed:10000});
    await page.evaluate(async()=>{
      const hex=document.createElement('div');hex.className='hex Neutral';hex.dataset.position='3';hex.id='pause-ground-hex';
      document.getElementById('hexGrid').append(hex);
      const board=await import('/js/board/controller.js');
      board.invalidateFootprintGeometry(document.getElementById('hexGrid')); board.syncEntityFootprints();
      const {summons}=await import('/js/data/summons.js');
      const template=summons.find(s=>s.summonType==='consommable');
      const {spawnConsumableSummon}=await import("/js/combat/summons.js");
      G.startGame();
      window.groundId=spawnConsumableSummon(hex,{...template,summonDuration:2},{attacker:E.entites[0]}).summonId;
      (await import("/js/rendering/animations.js")).animateDodge(E.entites[0].id);
    });
    await page.waitForTimeout(40);await page.evaluate(()=>P.pauseCombat());
    const id=await page.evaluate(()=>groundId), base=await page.evaluate(()=>baseStorage);
    const style=await page.locator('#imgContainer_999820').getAttribute('style');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.equal(await page.locator('#imgContainer_999820').getAttribute('style'),style,'dodge position restored');
    await page.waitForTimeout(2400);
    assert.equal(await page.locator('[id="'+id+'"]').count(),1,'ground lifetime frozen');
    assert.equal(await page.evaluate(()=>JSON.stringify(Object.entries(localStorage).sort())),base,'admin checkpoint never writes ordinary saves');
    await page.keyboard.press('Space');
    await page.waitForTimeout(2300);
    assert.equal(await page.locator('[id="'+id+'"]').count(),0,'saved remaining ground lifetime expires after resume');
    assert.equal(await page.locator('#imgContainer_999820').evaluate(el=>el.style.transform),'','dodge returns to original position');
    await page.evaluate(async()=>(await import("/js/app/state.js")).StopGame({preserveScene:true}));
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('DarkPitPausedCombat:available')),null);
    await page.reload();
    assert.equal(await page.locator('#combat-pause-control').count(),0,'stop clears saved battle');
    await page.close();console.log('PASS ground expiry, dodge, admin storage isolation, stopped checkpoint invalidation');
  }
  {
    const page=await fixture({A:{range:'range'},B:{range:'range'}});
    await page.evaluate(async()=>{
      (await import("/js/storage/sessionStorage.js")).endAdminSession();
      (await import("/js/storage/gameStorage.js")).setAdminMode(false);
      window.levelRunning='scripted'; F.initFightEntites(); G.startGame();
    });
    await page.waitForSelector('#phaser-projectiles:not([hidden]) canvas');await page.evaluate(()=>P.pauseCombat());
    const before=await page.evaluate(()=>E.entites.map(e=>({id:e.id,hp:e.stats.HP.current,action:e._combatAction})));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.deepEqual(await page.evaluate(async()=>(await import("/js/entities/runtime.js")).entites.map(e=>({id:e.id,hp:e.stats.HP.current,action:e._combatAction}))),before,'normal battle restored');
    assert.equal(await page.evaluate(async()=>(await import("/js/storage/sessionStorage.js")).isAdminSessionActive()),false,'normal restored game stays outside admin');
    await page.keyboard.press('Space');await page.waitForTimeout(2400);
    assert.ok(await page.evaluate(async()=>(await import("/js/entities/runtime.js")).entites.every(e=>e.stats.HP.current<1000)),'normal restored impacts complete');
    await page.close();console.log('PASS ordinary combat F5 outside admin');
  }
  {
    const page=await fixture({speed:10000});
    await page.evaluate(async()=>{
      const C=await import("/js/rendering/entities.js");
      const third=structuredClone(E.entites[1]);third.id=999822;third.position='3';
      const hex=document.createElement('div');hex.className='hex SideB occupied';hex.dataset.position='3';hex.id='survivor-hex';
      document.getElementById('hexGrid').append(hex);E.entites.push(third);
      const created=C.createEntiteInDOM(third);hex.append(created.element);await created.spriteReady;
      const board=await import('/js/board/controller.js');
      board.invalidateFootprintGeometry(document.getElementById('hexGrid')); board.syncEntityFootprints();
      G.startGame();
      (await import("/js/combat/effects.js")).poison(E.entites[0],{effectDot:40,effectDuration:4,type:['alteration']},E.entites[1]);
      const caster=E.entites[1];caster.hasFled=true;(await import("/js/combat/orders.js")).fledEntities.push(caster);E.RemoveEntite(caster,'runaway');
    });
    await page.evaluate(()=>P.pauseCombat());await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.deepEqual(await page.evaluate(async()=>(await import("/js/combat/orders.js")).fledEntities.map(e=>e.id)),[999821]);
    await page.keyboard.press('Space');await page.waitForTimeout(2500);
    assert.ok(await page.evaluate(async()=>(await import("/js/entities/runtime.js")).entites.find(e=>e.side==='A').stats.HP.current<1000),'poison persists after its caster left');
    assert.equal(await page.locator('#Box_Entite_999821').count(),0,'saved departure visual finishes');
    await page.close();console.log('PASS departed caster: poison continues and partial retreat is retained');
  }
  {
    const page = await fixture({phaser:true,A:{range:'range',execution:4000},B:{range:'range',execution:4000}});
    await page.evaluate(() => G.startGame());
    await page.waitForSelector('#phaser-projectiles:not([hidden]) canvas');
    await page.waitForTimeout(120);
    await page.evaluate(() => P.pauseCombat());
    const before = await page.evaluate(() => E.entites.flatMap(e => e.projectiles.map(p => p.visual)));
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(() => document.querySelector('#phaser-projectiles canvas')?.width === 390);
    assert.deepEqual(await page.evaluate(() => E.entites.flatMap(e => e.projectiles.map(p => p.visual))), before,
      'Resizing the paused viewport does not advance the flight');
    assert.equal(await page.locator('#phaser-projectiles').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => !!document.elementFromPoint(20,20)?.closest('#phaser-projectiles')), false);
    await page.screenshot({path:resolve(output,'phaser-mobile-paused.png')});
    await page.evaluate(() => G.StopGame({preserveScene:true}));
    assert.equal(await page.locator('#phaser-projectiles').evaluate(node => node.hidden), true);
    await page.close(); console.log('PASS Phaser: paused mobile resize, transparent input and stop cleanup');
  }
  {
    const page = await fixture({speed:20000});
    await page.evaluate(async () => {
      window.An = await import('/js/rendering/animations.js');
      An.prepareProjectileRenderer();
    });
    await page.waitForSelector('#phaser-projectiles canvas', {state:'attached'});
    await page.evaluate(() => G.startGame());
    await page.evaluate(() => {
      void An.animationProjectile(E.entites[0], E.entites[1], () => {throw Error('Dispel cannot hit');}, {
        id:'paused-magic-burst', executionTime:1000, attacknature:['magicalDamage'],
        flight:{mode:'magical',casterLost:true,sample(){},consumeMagicalLoss(){return false;},expired(){return false;},cancelled(){return true;}},
      });
    });
    await page.waitForFunction(() => Clock.captureCombatState()['projectile-effects'].some(e=>e.visual.kind==='burst'));
    await page.evaluate(() => {
      void An.animationProjectile(E.entites[0], E.entites[1], () => 'miss', {
        id:'paused-jarret-tail', executionTime:120, effectProjectileClasses:['jarret-fx'], attacknature:['physicalDamage'],
      });
    });
    await page.waitForFunction(() => Clock.captureCombatState()['projectile-effects'].some(e=>e.visual.kind==='miss'));
    await page.evaluate(() => P.pauseCombat());
    const read = () => page.evaluate(async () => (await import('/js/combat/clock.js')).captureCombatState()['projectile-effects']);
    const before = await read();
    assert.ok(before.some(e=>e.visual.kind==='burst' && e.visual.particleCount===7));
    assert.ok(before.some(e=>e.visual.kind==='miss'));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    await page.waitForSelector('#phaser-projectiles:not([hidden]) canvas');
    assert.deepEqual(await read(), before, 'F5 restores detached magic particles and Jarret overshoot');
    await page.waitForTimeout(900);
    assert.deepEqual(await read(), before, 'Detached effects stay frozen past their normal lifetime');
    await page.keyboard.press('Space');
    await page.evaluate(async () => { window.RestoredClock = await import('/js/combat/clock.js'); });
    await page.waitForFunction(() => !RestoredClock.isCombatPaused() && RestoredClock.captureCombatState()['projectile-effects'].length===0);
    assert.equal(await page.locator('#phaser-projectiles').evaluate(node=>node.hidden), true);
    await page.close(); console.log('PASS Phaser: detached dispersion and miss tail survive pause/F5 and expire once');
  }
  {
    const page = await fixture({speed:20000});
    const result = await page.evaluate(async () => {
      G.startGame();
      const {eventEntityAttack} = await import('/js/events/runtime.js');
      (await import('/js/combat/attackResolution.js')).setEntityAttackDefinitions(E.entites[0], ['soin'], (await import('/js/data/attackList.js')).attackDetails);
      const target = E.entites[1], hp = target.stats.HP.current;
      const done = eventEntityAttack({side:'B',attackerSide:'A',targetId:target.id,attackerId:E.entites[0].id,
        attackFunction:'soin',percent:10,executionTime:400,shakescreen:false});
      await new Promise(resolve=>setTimeout(resolve,80));
      const projectile = E.entites[0].projectiles.find(p=>p.cosmeticOnly && p.status==='in-flight');
      const before = target.stats.HP.current;
      const profile = projectile?.visual.profile, renderer = projectile?.visual.renderer;
      await done;
      return {hp,before,after:target.stats.HP.current,profile,renderer};
    });
    assert.equal(result.renderer,'phaser');
    assert.equal(result.profile.color,0xcdfdff,'Event spell keeps its original healing visual');
    assert.equal(result.before,result.hp,'Event damage waits for the configured deadline');
    assert.equal(result.after,result.hp*.9,'Event keeps exactly its requested damage, without triggering healing');
    await page.close();console.log('PASS Phaser: scripted ranged event keeps its visual and cosmetic-only combat contract');
  }
  for (const mode of ['slow','unavailable']) {
    const page = await fixture({phaser:true,A:{range:'range',preparation:100,execution:500},B:{range:'range',preparation:100,execution:500}});
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/vendor/phaser-3.90.0.esm.min.js', async route => {
      if (mode === 'unavailable') return route.abort();
      await gate; await route.continue();
    });
    await page.evaluate(() => G.startGame());
    await page.waitForFunction(() => E.entites.every(e => e.stats.HP.current < 1000), null, {timeout:5000});
    assert.equal(await page.locator('#phaser-projectiles canvas').count(), 0,
      'Damage completes even when the renderer cannot load');
    await page.evaluate(() => G.StopGame({preserveScene:true}));
    release();
    if (mode === 'slow') {
      await page.waitForSelector('#phaser-projectiles', {state:'attached'});
      assert.equal(await page.locator('#phaser-projectiles').evaluate(node => node.hidden), true,
        'A late boot cannot revive cleared projectiles');
    }
    await page.close(); console.log('PASS Phaser: '+mode+' renderer cannot delay combat or survive stop');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: space, frozen ranged flights and poison, F5 exact paused restoration, resume with no duplicate damage, repeated checkpoint, stop.');
} finally { await browser.close(); await new Promise(done=>server.close(done)); }
