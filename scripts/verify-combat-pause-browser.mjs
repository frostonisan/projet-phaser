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
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream'); let data = await readFile(file);
    if (file === resolve(root, 'js/combat/vitals.js')) {
      // The player journal omits flight ids. Expose the existing id only in
      // this test server, to distinguish saved hits from nature effects or later turns.
      const source = data.toString(), marker = /attack: \{\r?\n  functionName: attackDetail/;
      assert.match(source, marker);
      data = source.replace(marker, 'attack: {\n  launchContextId: attackDetail?.launchContextId,\n  functionName: attackDetail');
    }
    if (file === resolve(root, 'js/rendering/entities.js')) {
      data=data.toString().replace('return {command,update,capture,restore,destroy};',`return {command,update,capture,restore,destroy,
        inspect:()=>records.map(r=>({kind:r.kind,packed:r.asset?.packed,texture:r.asset?.name,frame:r.image?.frame?.name,type:r.image?.type,visible:r.image?.visible}))};`)
        .replace('box._monsterView={invalidateGeometry}', `box._monsterView={invalidateGeometry,
        inspectFX:()=>[...layers.values()].filter(l=>l.kind==='panel'||l.asset?.packed).map(l=>({kind:l.kind,
          packed:l.asset?.packed,texture:l.asset?.name,frame:l.image?.frame?.name,parts:l.image?.list?.length,roleIcons:l.image?.list?.filter(p=>p.updateMonsterIntro).length,
          type:l.image?.type,visible:l.image?.visible})).concat(presentation.inspect()),
        inspect:()=>[...layers.values()].filter(l=>l.kind==='body'||l.kind==='bar'||l.kind==='text').map(l=>({
          kind:l.kind,bar:l.bar,text:l.text,x:l.image?.x,y:l.image?.y,alpha:l.image?.alpha,
          width:l.image?.displayWidth,height:l.image?.displayHeight,visible:l.image?.visible}))}`);
    }
    if(file===resolve(root,'js/combat/pause.js')) {
      // Rebuilding the view must neither reroll rewards nor replay random effects.
      data=data.toString().replace('async function rebuildCombatScene(checkpoint) {',
        `async function rebuildCombatScene(checkpoint) {
          const random=Math.random;
          Math.random=()=>{throw Error('Random draw during scene reconstruction');};
          try { return await rebuildCombatSceneChecked(checkpoint); } finally { Math.random=random; }
        }
        async function rebuildCombatSceneChecked(checkpoint) {`);
    }
    if(process.env.CANVAS_BOARD_ONLY&&file===resolve(root,'js/rendering/boardAdapter.js'))data=data.toString().replace('  const now=paint.now','  globalThis.__boardRoots=roots;\n  const now=paint.now');
    res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });

const errors = [];
async function readPauseSnapshot(page) {
  return page.evaluate(async () => {
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('DarkPitPausedCombat',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try { return await new Promise((resolve,reject)=>{
      const r=db.transaction('pause').objectStore('pause').get(sessionStorage.getItem('DarkPitPausedCombat'));
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }); } finally { db.close(); }
  });
}
async function fixture(config = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.testLog=[];page.on('console',message=>page.testLog.push(message.text()));
  page.on('console', message => { if (message.type()==='error' && !message.text().includes('Failed to load resource')) console.error(message.text()); });
  if (config.rendererMode) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    page.releaseRenderer = release;
    // Drag input now warms Phaser when the board appears, before combat starts.
    await page.route('**/vendor/phaser-3.90.0.esm.min.js', async route => {
      if (config.rendererMode === 'unavailable') return route.abort();
      await gate; await route.continue();
    });
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html${process.env.MONSTER_WEBGL === "1" ? "?monsters=webgl" : ""}`);
  await page.evaluate(async config => {
    // Ambidextry's base chance caps at 50%; force a successful roll in its fixture.
    if (config.double || config.successfulSpell) {
      // Choose the branch under test without making generated IDs constant.
      let seed = 1701;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (config.double ? .2 : .9) + seed / 4294967296 * .05; };
    }
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
    const templates=(await import("/js/data/entityTemplates.js")).entitesNest;
    const template = templates.find(e => e.serial === 900013);
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
      const entity = E.enrichEntityStats({ ...structuredClone(config.serials?templates.find(e=>e.serial===config.serials[i]):template), id: 999820 + i, name: `Simultané ${side}`, side,
        type: 'sbire', role: 'gueux', position: String(i+1), level: 1, awakening: 1, stuff: {}, stats: {}, modifierStats: {},
        baseStats: { HP: 1000, strength: 0, intelligence: 0, agility: 0, physicalDamage: 40, magicalDamage: 40,
          speed: config.speed ?? 100, ambidextry: config.double ? 100000 : 0, extraLife: own.extraLife || 0 },
        attacks: [{ functionName: config.phaserMelee ? 'shot-p-c' : config.phaser ? 'shot-p-r' : 'simultaneous-test', attackId: 'simultaneous-test', displayName: 'Impact simultané', attackAsset: './media/assets/spells/tir',
          combatFunction: own.support ? 'Support' : 'Attaquant', attacknature: own.natures || [magic ? 'magicalDamage' : 'physicalDamage'],
          attackRange: [own.range || 'melee'], attackTarget: [own.support ? 'ally' : 'enemy'], deadTarget: ['no'], type: [], effets: own.effects || (own.support ? ['heal'] : []), selfEffects: [],
          preparationTime: own.preparation ?? 500, executionTime: own.execution ?? 1800, recoveryTime: own.recovery ?? 300, cooldown: 20000,
          ...(config.double ? {essenceSlots:['red','yellow','yellow','yellow'].map(color=>({color}))} : {}),
          physicalRatio: magic ? 0 : 1, magicalRatio: magic ? 1 : 0, piercingRatio: 0 }] });
      entity.statut = ['alive']; entity.isDEAD = false; E.entites.push(entity);
      const created = C.createEntiteInDOM(entity); hex.append(created.element); await created.spriteReady;
    }
    const boardController = await import('/js/board/controller.js');
    boardController.invalidateFootprintGeometry(grid); boardController.rebuildBoardOccupancy(grid);
    if (config.double) {
      const S = await import('/js/combat/statistics.js');
      if (E.entites.some(e=>S.calculateAmbidextryTotalChance(S.createAttackStatView(e,e.attackDetails[0])) <= 25))
        throw Error('Double-hit fixture needs compatible yellow essences and a successful proc roll');
    }
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
  if (process.env.MONSTER_WEBGL === '1' && !config.rendererMode) await page.waitForFunction(() => document.querySelectorAll('[data-monster-webgl="ready"]').length === 2);
  return page;
}

try {
  if(process.env.MONSTER_WEBGL==='1'){
    const page=await fixture({speed:20000});
    const panels=await page.evaluate(async()=>{
      const R=await import('/js/rendering/entities.js'),V=await import('/js/rendering/vitalFeedback.js'),UI=await import('/js/ui/attacks.js'),H=await import('/js/rendering/hud.js');
      G.startGame();Clock.freezeCombatClock();const e=E.entites[0];
      R.createHeadUpInDom(e.id);const command=UI.showCombatAttackControlPanel(e.id);await Promise.resolve();
      const hiddenBars=document.querySelector(`#Box_Entite_${e.id} .life-bars-container`),before=hiddenBars.innerHTML;
      e.stats.HP.current=600;e.stats.armor={current:200,max:200};V.presentEntityVitals(e);
      const read=root=>({hp:root.querySelector('.HP-counter').textContent,hpWidth:root.querySelector('.health-bar').style.width,armorWidth:root.querySelector('.armor-bar').style.width});
      const headsup=read(document.getElementById(`HeadsupLifeBars_${e.id}`)),control=read(command),unchanged=hiddenBars.innerHTML===before;
      document.querySelector('.AllEntitiesHud').remove();UI.hideCombatAttackControlPanel();const disposed=!R.hasExternalLifeBars(e.id);
      const attack=e.attackDetails[0],attacks=e.attacks;H.updateEntityAttackTargetDisplay(e,attack,E.entites[1]);
      H.clearBattleTargetDisplays([e]);e.currentAttack=null;e.attacks=[];H.updateEntityAttackTargetDisplay(e);
      const neutral=document.getElementById(`TargetroleContainer_${e.id}`).classList.contains('no-target');
      e.attacks=attacks;H.updateEntityAttackTargetDisplay(e,attack,E.entites[1]);
      const restored=!document.getElementById(`TargetroleContainer_${e.id}`).classList.contains('no-target');
      const paint=()=>new Promise(r=>globalThis.requestAnimationFrame(()=>globalThis.requestAnimationFrame(r)));
      e.stats.HP.current=200;V.presentEntityVitals(e);await paint();
      const presentation=()=>Clock.captureCombatState().phaserPresentation.find(row=>row.id===String(e.id)).state;
      const blink=presentation().bindings.flatMap(b=>b.animations).find(a=>a.vitalBlink);
      if(!blink)throw Error('Low HP must blink without changing hidden HTML');
      Clock.restoreCombatClock(blink.start+blink.duration/2);await paint();
      const dim=document.getElementById(`Box_Entite_${e.id}`)._monsterView.inspect().find(l=>l.bar==='hp').alpha;
      e.stats.HP.current=600;V.presentEntityVitals(e);await paint();
      const healed=!presentation().bindings.some(b=>b.animations.some(a=>a.vitalBlink));
      return {headsup,control,unchanged,disposed,neutral,restored,dim,healed};
    });
    for(const name of ['headsup','control'])assert.deepEqual(panels[name],{hp:'HP : 600 / 1000',hpWidth:'60%',armorWidth:'20%'});
    for(const name of ['unchanged','disposed','neutral','restored','healed'])assert.equal(panels[name],true,name);
    assert.ok(Math.abs(panels.dim-.1)<.01,'Native low-HP blink reaches the theme opacity');
    await page.close();console.log('PASS native vitals: open HUD/command panels update, hidden actor bars stay unchanged, target reset works');
  }
  if(process.env.CANVAS_BOARD_ONLY){
    const page=await fixture({speed:20000});
    await page.evaluate(async()=>{
      const B=await import('/js/board/controller.js'),R=await import('/js/rendering/entities.js');
      const boxes=E.entites.map(e=>document.getElementById(`Box_Entite_${e.id}`));boxes.forEach(n=>document.getElementById('game-container').append(n));document.getElementById('hexGrid').remove();
      document.dispatchEvent(new CustomEvent('biomeUpdated',{detail:'prison'}));B.StageLoading();B.createHexGrid();B.applyBiomeRealtime('prison');
      const grid=document.getElementById('hexGrid');for(const [i,e] of E.entites.entries()){boxes[i].remove();const hex=grid.querySelectorAll(`.Side${e.side}`)[5];e.position=hex.dataset.position;const created=R.createEntiteInDOM(e);hex.append(created.element);await created.spriteReady;}
      B.syncEntityFootprints(grid);(await import('/js/ui/display.js')).resetParallaxView({force:true});
      document.querySelectorAll('.entitylootContainer,.worldmap,.menu-map-container').forEach(n=>n.remove());
    });
    await page.waitForTimeout(5000);
    for(const biome of ['prison','marecage','desert','glacier']){
      await page.evaluate(async biome=>(await import('/js/board/controller.js')).applyBiomeRealtime(biome),biome);
      await page.waitForFunction(()=>document.querySelector('.ground[data-canvas-painted]')&&document.querySelector('.foreground-img[data-canvas-painted]'));
      await page.waitForTimeout(500);
      const geometry=await page.evaluate(async()=>{const A=await import('/js/rendering/boardAdapter.js');return [...__boardRoots.values()].filter(e=>e.node.isConnected).map(e=>{const actual=A.sampleCanvasPlane(e.node);return {node:e.node.className,error:Math.max(...[[0,0],[128,128]].map(([x,y])=>{const a=e.project(x,y),b=actual(x,y);return Math.hypot(a.x-b.x,a.y-b.y);})),kind:e.kind,meshSizeOK:e.objects.every(o=>o.type!=='Mesh'||o.width===innerWidth&&o.height===innerHeight)};});});
      assert.ok(geometry.every(e=>e.meshSizeOK),'Mesh pixel scale follows the viewport after texture changes');
      assert.ok(geometry.every(e=>e.error<.5),JSON.stringify(geometry.filter(e=>e.error>=.5)));
      await page.evaluate(()=>{window.weatherDraws=0;const draw=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.matches('#meteo-fx canvas,#ground-fx canvas'))weatherDraws++;return draw.apply(this,args);};});
      await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>weatherDraws),0,'Native weather does not repaint hidden 2D canvases');
      assert.equal(await page.locator('#phaser-projectiles canvas').count(),1);
      await page.screenshot({path:resolve(output,`canvas-board-${biome}.png`)});
    }
    await page.evaluate(()=>document.getElementById('hexGrid').style.transform='perspective(2000px) rotateX(65deg)');
    for(let i=0;i<4;i++){await page.waitForTimeout(250);assert.equal(await page.locator('[data-monster-webgl="ready"]').count(),2,'Camera never falls back to HTML actors');}
    await page.waitForTimeout(500);await page.evaluate(async()=>{(await import('/js/ui/display.js')).resetParallaxView({force:true});});await page.waitForTimeout(1600);
    await page.evaluate(async()=>{
      const S=await import('/js/storage/gameStorage.js'),L=await import('/js/items/loot.js'),B=await import('/js/board/controller.js');
      const stage={id:'pause-test',level_type:'admin',reward:'chest'};S.saveToLocalStorage('GameStages',{stages:[stage]});
      const chest=S.getOrCreateStageChest(stage);window.testChestId=chest.id;L.createChestLoot(chest,{stageId:stage.id,spawnMode:'in-place'});
      const hex=[...document.querySelectorAll('#hexGrid .hex.SideA')].find(n=>!n.classList.contains('occupied'));
      const M=await import('/js/combat/summons.js');M.placeGroundItem(hex,{itemId:'canvas-test-item',itemAsset:'./media/assets/misc/glitter-loot.svg',displayName:'Canvas test'}, {infinite:true,durationMs:20000});
    });
    await page.waitForFunction(()=>document.querySelector('.chest-container[data-canvas-painted] canvas')?._canvasNative&&document.querySelector('.consommable-container[data-canvas-painted]'));
    await page.waitForTimeout(2200);
    assert.ok(await page.evaluate(()=>[...__boardRoots.values()].filter(e=>e.node.matches('.chest-container,.consommable-container')).every(e=>e.recipe.parts.some(p=>p.mesh&&p.mesh.visible))),'Passive objects have native meshes');
    await page.locator('.chest-loot').dispatchEvent('click');await page.waitForTimeout(100);
    assert.ok(await page.evaluate(()=>document.querySelector('.chest-loot')._canvasTint?.opacity>0),'Locked chest click animates the native tint');
    await page.waitForTimeout(700);await page.screenshot({path:resolve(output,'canvas-board-loot.png')});
    await page.evaluate(async()=>{(await import('/js/combat/summons.js')).releaseGroundItem('canvas-test-item');});await page.waitForTimeout(100);
    await page.evaluate(async()=>{const e=E.entites[0],V=await import('/js/rendering/vitalFeedback.js');e.stats.HP.current=200;e.stats.armor={current:200,max:200};V.presentEntityVitals(e);e.stats.armor.current=100;V.presentEntityVitals(e);G.startGame();await P.pauseCombat();});
    const checkpoint=await readPauseSnapshot(page);
    assert.ok(checkpoint.visuals.scene&&!('html' in checkpoint.visuals),'Full native board restores from data');
    const savedVitals=await page.evaluate(()=>Clock.captureCombatState().phaserPresentation.map(r=>({id:r.id,flash:r.state.armorFlashAt,blink:r.state.bindings.flatMap(b=>b.animations).filter(a=>a.vitalBlink)})));
    const saved=await page.evaluate(()=>({weather:Clock.captureCombatState().weather,board:Clock.captureCombatState().canvasBoard.map(rows=>rows.map(r=>({key:r.key,epoch:r.epoch})).sort((a,b)=>a.key.localeCompare(b.key)))}));
    await page.reload();await page.waitForFunction(()=>document.getElementById('hexGrid')?._canvasBoardView&&document.querySelectorAll('[data-monster-webgl="ready"]').length===2);
    await page.evaluate(async()=>{window.Clock=await import('/js/combat/clock.js');window.P=await import('/js/combat/pause.js');});
    assert.deepEqual(await page.evaluate(()=>Clock.captureCombatState().weather),saved.weather,'F5 retains paused weather particles');
    assert.deepEqual(await page.evaluate(()=>Clock.captureCombatState().phaserPresentation.map(r=>({id:r.id,flash:r.state.armorFlashAt,blink:r.state.bindings.flatMap(b=>b.animations).filter(a=>a.vitalBlink)}))),savedVitals,'F5 retains native HP blink and armor impact phase');
    assert.deepEqual(await page.evaluate(()=>Clock.captureCombatState().canvasBoard.map(rows=>rows.map(r=>({key:r.key,epoch:r.epoch})).sort((a,b)=>a.key.localeCompare(b.key)))),saved.board,'F5 retains board animation epochs');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.screenshot({path:resolve(output,'canvas-board-mobile-paused.png')});
    assert.equal(await page.locator('#phaser-projectiles canvas').count(),1);
    await page.evaluate(async()=>{const B=await import('/js/board/controller.js');B.applyBiomeRealtime('prison',{size:B.getBoardSizeOptions().at(-1).key});});await page.waitForTimeout(1500);
    assert.ok(await page.evaluate(()=>{const grid=document.getElementById('hexGrid');return grid._canvasBoardView.screenCells.size===grid.querySelectorAll('.hex[data-position]').length;}),'Resizing the board refreshes every native cell');
    assert.deepEqual(errors,[]);await page.close();
    console.log('PASS full canvas board: four biomes, native weather, camera, chests/items, pause/F5, mobile resize');
  } else {
  {
    const page=await fixture({speed:20000});
    const result=await page.evaluate(async()=>{
      const wait=()=>new Promise(resolve=>globalThis.requestAnimationFrame(resolve));
      const calls=[];Clock.freezeCombatClock();
      let second;
      Clock.requestAnimationFrame(()=>{
        calls.push('first');Clock.cancelAnimationFrame(second);
        Clock.requestAnimationFrame(()=>calls.push('next'));
        Clock.freezeCombatClock();
      });
      second=Clock.requestAnimationFrame(()=>calls.push('cancelled'));
      Clock.requestAnimationFrame(()=>calls.push('remaining'));
      await wait();const frozen=[...calls];Clock.resumeCombatClock();
      await wait();const interrupted=[...calls];
      await wait();const stillFrozen=[...calls];Clock.resumeCombatClock();
      await wait();const resumed=[...calls];
      Clock.requestAnimationFrame(()=>calls.push('cleared'));Clock.clearCombatClock();
      await wait();return {frozen,interrupted,stillFrozen,resumed,final:calls};
    });
    assert.deepEqual(result,{frozen:[],interrupted:['first'],stillFrozen:['first'],
      resumed:['first','remaining','next'],final:['first','remaining','next']});
    await page.close();console.log('PASS shared animation frame: cancellation, pause within a batch, resume and cleanup');
  }
  if(process.env.MONSTER_WEBGL==='1') {
    for(const serials of [[1,2],[9,10],[12,666],[4568773,20]]){
      const mixed=await fixture({speed:20000,serials});
      await mixed.waitForFunction(()=>document.querySelectorAll('[data-monster-webgl="ready"]').length===2);
      assert.ok(await mixed.evaluate(()=>[...document.querySelectorAll('[data-monster-webgl="ready"]')].every(n=>n._monsterView.inspect().some(l=>l.kind==='body'&&l.width>0&&l.height>0&&l.visible))));
      await mixed.close();
    }
    console.log('PASS eight monster species on the shared canvas');
    const page=await fixture({speed:20000});
    await page.waitForFunction(()=>document.querySelectorAll('[data-monster-webgl="ready"]').length===2);
    await page.evaluate(async()=>{
      window.ambidextry= (await import('/js/rendering/damageFeedback.js')).AmbidextryVFX;
      window.readPacked=()=>[...document.querySelectorAll('[data-monster-webgl="ready"]')].flatMap(n=>n._monsterView.inspectFX()).filter(l=>l.packed);
      ambidextry(E.entites[0]);
    });
    await page.waitForFunction(()=>readPacked().length===1&&readPacked()[0].visible);
    await page.waitForTimeout(150);
    await page.evaluate(()=>ambidextry(E.entites[1]));
    await page.waitForFunction(()=>readPacked().length===2&&readPacked().every(l=>l.visible));
    const frames=await page.evaluate(()=>readPacked());
    assert.ok(frames.every(l=>l.type==='Image'&&l.frame.startsWith('frame_')));
    assert.equal(frames[0].texture,frames[1].texture,'Ambidextry instances share the supplied PNG');
    await page.waitForFunction(()=>readPacked()[0].frame!==readPacked()[1].frame);
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll('[data-monster-webgl="ready"]')].every(n=>n._monsterView.inspectFX().some(l=>l.kind==='panel'&&l.type==='Container'&&l.parts>0&&l.roleIcons===2))), 'Native Phaser panel components are present');
    await page.evaluate(()=>{Clock.freezeCombatClock();window.pausedAtlasFrame=readPacked()[0].frame;});
    await page.waitForFunction(()=>readPacked()[0].frame!==pausedAtlasFrame);
    await page.waitForTimeout(2100);
    assert.equal(await page.evaluate(()=>readPacked().length),2,'Pause freezes effect lifetime, as with the original looping GIF');
    await page.evaluate(()=>Clock.resumeCombatClock());
    await page.waitForFunction(()=>readPacked().length===0);
    await page.evaluate(async()=>{
      const {PopUpDamages}=await import('/js/rendering/hud.js');
      for(let i=0;i<30;i++)PopUpDamages(E.entites[0],123+i,'hit',null,{physical:123},'critical');
      const state=Clock.captureCombatState().phaserPresentation.find(v=>v.id===String(E.entites[0].id));
      if(state.state.presentation.records.filter(r=>r.channel==='damage').length!==8)throw Error('Unbounded damage feed');
      if(document.querySelectorAll('.combat-popup-card,.effect-vfx.ambidextry').length)throw Error('Canvas feedback created live HTML');
      const menu=document.createElement('div');menu.className='menu-map-container';menu.innerHTML='<div style="background:#233344;width:300px;height:200px">Canvas overlay test</div>';document.querySelector('.Game-UI').append(menu);
    });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('[data-monster-webgl="ready"]').count(),2,'Menus keep the native battlefield alive');
    assert.equal(await page.evaluate(()=>document.getElementById('phaser-projectiles').parentElement.id),'game-windows');
    await page.screenshot({path:resolve(output,'canvas-menu-and-feedback.png')});
    const readPose=()=>page.evaluate(()=>Clock.captureCombatState().phaserPresentation.find(v=>v.id===String(E.entites[0].id)).state.bindings
      .filter(b=>b.overrides?.transform?.includes('23px')).map(b=>({overrides:b.overrides,values:b.values})));
    await page.evaluate(async()=>{
      Clock.freezeCombatClock();(await import('/js/rendering/animations.js')).writeCombatVisualStyle(
        document.getElementById(`DragSprite_${E.entites[0].id}`),{transform:'translateX(23px) scale(1.07)',opacity:'.7'});
    });
    const poseBefore=await readPose();assert.equal(poseBefore.length,1);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
    assert.deepEqual(await readPose(),poseBefore,'Viewport calibration retains the paused native pose');
    await page.close();console.log('PASS native Phaser panels and ambidextry atlas: shared PNG, independent frames, pause and cleanup');
  }
  if (!process.env.PAUSE_EXTRA_ONLY) {
  for (const mode of (process.env.PAUSE_TEST_MODE ? process.env.PAUSE_TEST_MODE.split(',') : ['range', 'melee', 'phaser', 'phaser-melee', 'magical', 'mixed', 'triple', 'melee-magical', 'melee-mixed', 'melee-triple', 'melee-double-pending', 'melee-double-active'])) {
  const natures = mode.endsWith('magical') ? ['magicalDamage'] : mode.endsWith('mixed') ? ['hybridalDamage']
    : mode.endsWith('triple') ? ['hybridalDamage', 'piercingDamage'] : ['physicalDamage'];
  const own = { range: mode.includes('melee') ? 'melee' : 'range', natures,
    execution: 4000, magic: mode.endsWith('magical') };
  const page = await fixture({ phaser: mode === 'phaser', phaserMelee: mode === 'phaser-melee', double:mode.includes('double'), successfulSpell:mode==='magical', A: own, B: own });
  await page.evaluate(async mode => {
    if (mode === 'melee-double-pending') {
      const watch = setInterval(() => {
        if (Clock.captureCombatState().flights.delayed.length !== 2) return;
        clearInterval(watch); void P.pauseCombat();
      }, 1);
    }
    G.startGame();
    const {poison} = await import("/js/combat/effects.js");
    poison(E.entites[0], { effectDot: 9, effectDuration: 4, type: ['alteration'] }, E.entites[1]);
  }, mode);
  try {
    await page.waitForFunction(mode => mode.includes('melee')
      ? Clock.captureCombatState().melee.active.length >= 2
      : E.entites.filter(e => e.projectiles?.some(p => p.status === 'in-flight')).length === 2, mode);
  } catch (error) {
    console.error('Missing simultaneous flights', mode, await page.evaluate(() => E.entites.map(e => ({
      id:e.id, hp:e.stats.HP.current, action:e._combatAction, phase:e.currentPhase, attack:e.currentAttack,
      flights:e.projectiles, paused:Clock.isCombatPaused(),
    }))));
    console.error(page.testLog.slice(-80).join('\n')); throw error;
  }
  if (mode === 'melee-double-active') await page.waitForFunction(() => Clock.captureCombatState().melee.active.filter(e=>e.isAmbidextry).length===2);
  if (mode !== 'melee-double-pending') {
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
  }
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
      phaserMelee: clock.captureCombatState().melee.active.filter(entry => entry.renderer === 'phaser'),
      flightIds: [...clock.captureCombatState().flights.active.map(e=>e.flight.id),...clock.captureCombatState().flights.delayed.map(e=>e.id)].sort(),
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
  if (mode.includes('melee')) {
    assert.equal(before.phaserMelee.length, mode === 'melee-double-active' ? 4 : 2);
    if(mode === 'melee-double-pending') assert.equal(await page.evaluate(()=>Clock.captureCombatState().flights.delayed.length),2);
    assert.ok(before.phaserMelee.every(entry => entry.resume.progress >= (mode === 'melee-double-pending' ? 0 : Number.EPSILON) && entry.resume.progress < 1));
    assert.equal(before.melee.length, 0);
    await page.screenshot({path:resolve(output,'phaser-melee-paused.png')});
  }
  assert.equal(before.paused,true); if (mode === 'range') assert.equal(before.phaser.length,2);
  let monsterPose;
  const readMonsters=()=>page.evaluate(()=>[...document.querySelectorAll('[data-monster-webgl="ready"]')].map(box=>box._monsterView.inspect()));
  if(process.env.MONSTER_WEBGL==='1'){
    await page.waitForFunction(()=>document.querySelectorAll('[data-monster-webgl="ready"]').length===2);
    await page.waitForTimeout(100);
    monsterPose=await readMonsters();
    assert.ok(monsterPose.every(layers=>layers.some(layer=>layer.kind==='body')));
  }
  await page.waitForTimeout(2600);
  if(monsterPose)assert.deepEqual(await readMonsters(),monsterPose,'WebGL body, bars and text remain frozen during tactical pause');
  assert.deepEqual(await read(),before,'live pause freezes deadlines, positions, damage and phases');
  await page.evaluate(async expectDataScene => {
    const name = (await indexedDB.databases()).find(db => db.name?.toLowerCase().includes('pause'))?.name;
    if (!name) throw Error('Missing pause database');
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pause', 'readwrite'), store = tx.objectStore('pause'), request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        const snapshot = cursor.value;
        if (!snapshot.board?.placements.length) throw Error('Checkpoint lacks combat board data');
        if (expectDataScene && !snapshot.visuals.scene) throw Error('Native reload unexpectedly used the HTML checkpoint');
        if (snapshot.visuals.scene) {
          if ('html' in snapshot.visuals) throw Error('Native checkpoint must not serialize the scene HTML');
          if (!snapshot.visuals.scene.properties.length) throw Error('Missing view properties');
        } else snapshot.visuals.html = snapshot.visuals.html.map(html => {
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
  }, process.env.MONSTER_WEBGL === '1');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#combat-pause-control')?.textContent === 'Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
  await page.waitForSelector('#phaser-projectiles:not([hidden]) canvas');
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
  if (monsterPose) {
    await page.waitForFunction(() => document.querySelectorAll('[data-monster-webgl="ready"]').length === 2);
    await page.waitForTimeout(100);
    const currentPose = await readMonsters();
    assert.equal(currentPose.length, monsterPose.length);
    currentPose.forEach((layers, i) => {
      assert.equal(layers.length, monsterPose[i].length);
      layers.forEach((layer, j) => {
        const expected = monsterPose[i][j];
        for (const [key, value] of Object.entries(expected)) {
          if (typeof value === 'number') assert.ok(Math.abs(layer[key] - value) < .001,
            `Restored ${layer.kind}/${layer.bar || ''} ${key}: ${layer[key]} != ${value}`);
          else assert.equal(layer[key], value, `Restored ${layer.kind} ${key}`);
        }
      });
    });
  }
  await page.waitForTimeout(1800);
  compare(await read(),before,'reload does not restart timers');
  await page.screenshot({path:resolve(output,'restored-paused.png')});
  await page.evaluate(savedIds => {
    window.resumedImpacts = [];
    window.addEventListener('combatLogEntry', event => {
      if (event.detail.type === 'damage_resolution' && savedIds.includes(event.detail.data.attack?.launchContextId))
        resumedImpacts.push(event.detail.data.attack.launchContextId);
    });
  }, before.flightIds);
  await page.keyboard.press('Space');
  await page.waitForFunction(async () => !(await import("/js/combat/clock.js")).isCombatPaused());
  await page.waitForFunction(count => resumedImpacts.length >= count, before.flightIds.length, {timeout:10000});
  await page.waitForTimeout(100);
  // Freeze before an ordinary next turn can resolve another legitimate attack.
  await page.evaluate(async () => (await import('/js/combat/pause.js')).pauseCombat());
  const after = await read();
  assert.ok(after.e.every((e,i)=>e.hp<before.e[i].hp),'both saved impacts apply after resume: '+JSON.stringify({mode,before:before.e,after:after.e,impacts:await page.evaluate(()=>resumedImpacts)}));
  assert.deepEqual(await page.evaluate(()=>resumedImpacts.sort()), before.flightIds, 'Each saved attack resolves exactly once, for every nature');
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
      const nativeState=(await import('/js/combat/clock.js')).captureCombatState().phaserPresentation;
      return entites.map(e=>({hp:e.stats.HP.current,speed:e.speedTimer,prep:e.preparationTime,recovery:e.recoveryTime,turn:e.turnCount,
        action:e._combatAction,boosts:Object.values(e.battleBoosts||{}).flat().map(b=>({id:b.id,value:b.value,expiresAt:b.expiresAt})),
        filter:document.getElementById(`spriteCanvas_${e.id}`).style.filter,
        popup:document.getElementById(`PopUp_${e.id}`).textContent,
        native:nativeState?.find(v=>v.id===String(e.id))?.state.presentation.records.map(r=>({kind:r.kind,key:r.key,channel:r.channel,content:r.content,start:r.start,duration:r.duration,motion:r.motion}))}));
    });
    const before=await read();await page.waitForTimeout(1400);assert.deepEqual(await read(),before);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    if(process.env.MONSTER_WEBGL==='1')await page.waitForFunction(()=>document.querySelectorAll('[data-monster-webgl="ready"]').length===2);
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
      const nativeState=(await import('/js/combat/clock.js')).captureCombatState().phaserPresentation;
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
    const page=await fixture({speed:20000});
    await page.evaluate(async()=>{
      const R=await import('/js/rendering/entities.js'),B=await import('/js/board/controller.js');
      const grid=document.getElementById('hexGrid'),hex=grid.querySelector('.hex').cloneNode(false);
      hex.className='hex SideB';hex.dataset.position='3';hex.style.left='700px';grid.append(hex);
      const survivor={...Clock.combatData(E.entites[1]),id:999822,name:'Survivant',position:'3',battlePosition:'3'};
      E.entites.push(survivor);const view=R.createEntiteInDOM(survivor);hex.append(view.element);await view.spriteReady;
      B.invalidateFootprintGeometry(grid);B.rebuildBoardOccupancy(grid);G.startGame();
      const V=await import('/js/combat/vitals.js');E.entites[1].stats.HP.current=1;V.applyDamage(E.entites[1],100000,E.entites[0],E.entites[0].attackDetails[0]);
    });
    await page.waitForFunction(()=>E.entites[1].isDEAD&&document.querySelector('[data-corpse-loot-id] .dead-sprite'));
    await page.waitForTimeout(150);await page.evaluate(()=>P.pauseCombat());
    const read=()=>page.evaluate(async()=>{
      const E=await import('/js/entities/runtime.js'),S=await import('/js/storage/sessionStorage.js');
      return {entities:E.entites.map(e=>({id:e.id,hp:e.stats.HP.current,armor:e.stats.armor,isDEAD:e.isDEAD,
        statut:e.statut,kills:e.kills,hasDeathBeenLogged:e.hasDeathBeenLogged,extraLife:e.stats.extraLife})),
        deathEffect:(await import('/js/combat/clock.js')).captureCombatState().phaserPresentation
          .flatMap(row=>row.state.presentation.records).filter(r=>r.key==='death-blood').map(({gifElapsed,...r})=>r),
        loot:S.gameStorage.getItem('PersistentCorpseLootSources'),
        corpses:[...document.querySelectorAll('[data-corpse-loot-id]')].map(n=>n.dataset.corpseLootId)};
    });
    const before=await read();assert.ok(before.loot&&before.corpses.length===1);
    if(process.env.MONSTER_WEBGL==='1')assert.equal(before.deathEffect.length,1,'Death blood is native and retains its timeline');
    const checkpoint=await readPauseSnapshot(page);
    if(process.env.MONSTER_WEBGL==='1')assert.ok(checkpoint.visuals.scene&&!('html' in checkpoint.visuals),'A dead actor and corpse loot restore from data');
    await page.reload();
    await page.waitForFunction(()=>document.getElementById('combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre'&&!document.getElementById('combat-pause-control').disabled);
    assert.deepEqual(await read(),before,'Death, depleted HP/lives, kill count and resolved corpse loot survive F5 without replay');
    await page.locator('[data-corpse-loot-id]').dispatchEvent('click');
    await page.waitForSelector('.loot-interface',{state:'attached'});
    await page.close();console.log('PASS definitive death: exact resources/kill count/loot and usable corpse after F5');
  }
  if (process.env.MONSTER_WEBGL === '1') {
    const page = await fixture({ speed: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-monster-webgl="ready"]').length === 2);
    await page.evaluate(async () => {
      G.startGame();
      (await import('/js/rendering/damageFeedback.js')).showResilienceCancellation(E.entites[0], 'resilienceCancel');
      await P.pauseCombat();
    });
    const checkpoint = await readPauseSnapshot(page);
    assert.ok(checkpoint.visuals.html && !checkpoint.visuals.scene, 'Unported effects retain the HTML checkpoint');
    const deadline = await page.locator('.effect-vfx.resilience').getAttribute('data-combat-remove-at');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#combat-pause-control')?.textContent === 'Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.equal(await page.locator('.effect-vfx.resilience').getAttribute('data-combat-remove-at'), deadline);
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('.effect-vfx.resilience').count(), 1, 'Unported effect remains frozen');
    await page.keyboard.press('Space'); await page.waitForTimeout(2200);
    assert.equal(await page.locator('.effect-vfx.resilience').count(), 0, 'Unported effect retains its removal deadline');
    await page.close(); console.log('PASS native board with an unported effect: fallback retains the visual and expiry');
  }
  for (const shortcut of ['F5', 'Control+r', 'Control+Shift+r']) {
    const page=await fixture({phaser:true,A:{range:'range',execution:5000},B:{range:'range',execution:5000}});
    await page.evaluate(()=>G.startGame());
    await page.waitForFunction(()=>E.entites.every(e=>e.projectiles?.some(p=>p.status==='in-flight')));
    const before=await page.evaluate(()=>E.entites.map(e=>({id:e.id,hp:e.stats.HP.current,action:e._combatAction})));
    await Promise.all([page.waitForEvent('load'),page.keyboard.press(shortcut)]);
    await page.waitForFunction(async()=>{
      const P=await import('/js/combat/pause.js'),C=await import('/js/combat/clock.js');
      return C.isCombatPaused()&&!P.isCombatCheckpointBusy()&&document.getElementById('combat-pause-resume');
    });
    assert.deepEqual(await page.evaluate(async()=>(await import('/js/entities/runtime.js')).entites.map(e=>({id:e.id,hp:e.stats.HP.current,action:e._combatAction}))),before,
      shortcut+' checkpoints the running attack before reloading');
    await page.close();console.log('PASS live keyboard reload: '+shortcut);
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
    await page.waitForFunction(()=>E.entites.filter(e=>e.projectiles?.some(p=>p.status==='in-flight')).length===2);await page.evaluate(()=>P.pauseCombat());
    const before=await page.evaluate(()=>E.entites.map(e=>({id:e.id,hp:e.stats.HP.current,action:e._combatAction})));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre' && !document.querySelector('#combat-pause-control').disabled);
    assert.deepEqual(await page.evaluate(async()=>(await import("/js/entities/runtime.js")).entites.map(e=>({id:e.id,hp:e.stats.HP.current,action:e._combatAction}))),before,'normal battle restored');
    assert.equal(await page.evaluate(async()=>(await import("/js/storage/sessionStorage.js")).isAdminSessionActive()),false,'normal restored game stays outside admin');
    await page.evaluate(async()=>{window.RestoredRuntime=await import('/js/entities/runtime.js');});
    await page.keyboard.press('Space');await page.waitForFunction(()=>RestoredRuntime.entites.length===2 && RestoredRuntime.entites.every(e=>e.stats.HP.current<1000),null,{timeout:10000});
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
  for (const range of ['range','melee']) {
    const page = await fixture({phaser:range==='range',phaserMelee:range==='melee',A:{range,execution:4000},B:{range,execution:4000}});
    await page.evaluate(() => G.startGame());
    await page.waitForFunction(range => range === 'melee' ? Clock.captureCombatState().melee.active.length === 2 : E.entites.filter(e=>e.projectiles?.some(p=>p.status==='in-flight')).length===2, range);
    await page.waitForTimeout(120);
    await page.evaluate(() => P.pauseCombat());
    const readVisuals = () => page.evaluate(() => ({projectiles:E.entites.flatMap(e => (e.projectiles || []).map(p => p.visual)),melee:Clock.captureCombatState().melee}));
    const before = await readVisuals();
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(() => document.querySelector('#phaser-projectiles canvas')?.width === 390);
    assert.deepEqual(await readVisuals(), before,
      'Resizing the paused viewport does not advance the flight');
    assert.equal(await page.locator('#phaser-projectiles').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => !!document.elementFromPoint(20,20)?.closest('#phaser-projectiles')), false);
    await page.screenshot({path:resolve(output,`phaser-${range}-mobile-paused.png`)});
    await page.evaluate(() => G.StopGame({preserveScene:true}));
    assert.equal(await page.locator('#phaser-projectiles').evaluate(node => node.hidden), process.env.MONSTER_WEBGL !== '1');
    await page.close(); console.log('PASS Phaser '+range+': paused mobile resize, transparent input and stop cleanup');
  }
  {
    const page = await fixture({speed:20000});
    await page.evaluate(async () => {
      window.An = await import('/js/rendering/animations.js');
      An.prepareCombatRenderer();
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
    assert.equal(await page.locator('#phaser-projectiles').evaluate(node=>node.hidden), process.env.MONSTER_WEBGL !== '1');
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
  {
    const page=await fixture({speed:20000});
    const result=await page.evaluate(async()=>{
      G.startGame();
      const {eventEntityAttack}=await import('/js/events/runtime.js');
      (await import('/js/combat/attackResolution.js')).setEntityAttackDefinitions(E.entites[0],['shot-p-c'],(await import('/js/data/attackList.js')).attackDetails);
      const target=E.entites[1],hp=target.stats.HP.current;
      const done=eventEntityAttack({side:'B',attackerSide:'A',targetId:target.id,attackerId:E.entites[0].id,attackFunction:'shot-p-c',percent:10,executionTime:600,shakescreen:false});
      // Freeze immediately: a cold Phaser import can stall wall-clock timers.
      // The early confirmation must retain the charge even beyond its wall deadline.
      Clock.freezeCombatClock();
      await new Promise(r=>setTimeout(r,700));
      const visual=Clock.captureCombatState().melee.active[0],before=target.stats.HP.current;
      const renderer=visual?.renderer,phase=visual?.resume.phase;
      Clock.resumeCombatClock();
      await done;
      return {hp,before,after:target.stats.HP.current,renderer,phase};
    });
    assert.equal(result.renderer,'phaser');assert.equal(result.phase,'flight','Early event confirmation keeps the full charge');
    assert.equal(result.before,result.hp);assert.equal(result.after,result.hp*.9,'Event applies only its requested damage');
    await page.close();console.log('PASS melee event: Phaser charge waits for the existing damage deadline');
  }
  for (const phase of ['cancelled','blood']) {
    const page=await fixture({speed:20000});
    await page.evaluate(async()=>{
      window.An=await import('/js/rendering/animations.js');G.startGame();
      window.copy=An.animationMelee(E.entites[0],E.entites[1],true,{duration:2500});
    });
    await page.waitForFunction(()=>copy.ready);
    await page.evaluate(()=>copy.abortOnDeath());
    await page.waitForTimeout(phase==='blood'?1100:120);
    await page.evaluate(()=>P.pauseCombat());
    const read=()=>page.evaluate(async()=>(await import('/js/combat/clock.js')).captureCombatState().melee);
    const before=await read();assert.equal(before.active[0].resume.phase,'cancelled');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#combat-pause-control')?.textContent==='Pause tactique · Espace pour reprendre'&&!document.querySelector('#combat-pause-control').disabled);
    await page.waitForSelector('#phaser-projectiles:not([hidden]) canvas');
    assert.deepEqual(await read(),before,'Death effect restores its exact phase and time');
    await page.waitForTimeout(900);assert.deepEqual(await read(),before);
    await page.keyboard.press('Space');
    await page.evaluate(async()=>{window.RestoredClock=await import('/js/combat/clock.js');});
    await page.waitForFunction(()=>RestoredClock.captureCombatState().melee.active.length===0);
    await page.close();console.log('PASS melee '+phase+': frozen copy and blood survive F5 without duplicate damage');
  }
  for (const range of ['range','melee']) for (const mode of ['slow','unavailable']) {
    const page = await fixture({rendererMode:mode,phaser:range==='range',phaserMelee:range==='melee',A:{range,preparation:100,execution:500},B:{range,preparation:100,execution:500}});
    await page.evaluate(() => G.startGame());
    await page.waitForFunction(() => E.entites.every(e => e.stats.HP.current < 1000), null, {timeout:5000});
    assert.equal(await page.locator('#phaser-projectiles canvas').count(), 0,
      'Damage completes even when the renderer cannot load');
    assert.ok(await page.evaluate(() => E.entites.every(e => Number(getComputedStyle(document.getElementById(`DragSprite_${e.id}`)).opacity) > 0)), 'Unavailable renderer never hides the original fighters');
    await page.evaluate(() => G.StopGame({preserveScene:true}));
    page.releaseRenderer();
    if (mode === 'slow') {
      await page.waitForSelector('#phaser-projectiles', {state:'attached'});
      if(process.env.MONSTER_WEBGL==='1')await page.waitForFunction(()=>document.querySelectorAll('[data-monster-webgl="ready"]').length===2);
      assert.equal(await page.locator('#phaser-projectiles').evaluate(node => node.hidden), process.env.MONSTER_WEBGL !== '1',
        'A late boot cannot revive cleared projectiles');
    }
    await page.close(); console.log('PASS Phaser '+range+': '+mode+' renderer cannot delay combat or survive stop');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: space, frozen ranged flights and poison, F5 exact paused restoration, resume with no duplicate damage, repeated checkpoint, stop.');
}
} finally { await browser.close(); await new Promise(done=>server.close(done)); }
