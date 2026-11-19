import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs'), output = resolve('outputs/tactical-pause');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream'); let data = await readFile(file);
    if (file === resolve(root,'js/rendering/animations.js')) data = data.toString() + `
export const testBoardGesture = () => ({active:!!boardDrag,pending:!!boardDragPending,
  preview:phaserLayer?.scene.children.list.filter(o=>o.name==='board-drag-preview').length || 0,
  texture:phaserLayer?.scene.textures.exists('board-drag-preview') || false,
  x:boardDrag?.image.x,y:boardDrag?.image.y,objects:phaserLayer?.scene.children.list.length || 0});`;
    res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });

const errors = [];
async function fixture(config = {}) {
  const page = await browser.newPage({ viewport: { width: config.touch ? 390 : 1280, height: config.touch ? 844 : 800 }, hasTouch: !!config.touch, isMobile: !!config.touch });
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
    const template = (await import("/js/data/entityTemplates.js")).entitesNest.find(e => e.serial === (config.gesture ? 7 : 900013));
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
        attacks: [{ functionName: 'simultaneous-test', attackId: 'simultaneous-test', displayName: 'Impact simultané',
          combatFunction: own.support ? 'Support' : 'Attaquant', attacknature: [magic ? 'magicalDamage' : 'physicalDamage'],
          attackRange: [own.range || 'melee'], attackTarget: [own.support ? 'ally' : 'enemy'], deadTarget: ['no'], type: [], effets: own.support ? ['heal'] : [], selfEffects: [],
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


const ready = page => page.waitForFunction(async () => {
  window.P = await import("/js/combat/pause.js"); window.Clock = await import("/js/combat/clock.js");
  await P.restorePausedCombat(); // F5 also rebinds ground effects asynchronously.
  return Clock.isCombatPaused() && !P.isCombatCheckpointBusy() && sessionStorage.getItem('DarkPitPausedCombat:available') === '1';
});
async function attach(page) {
  await page.evaluate(async () => {
    window.E = await import("/js/entities/runtime.js"); window.G = await import("/js/app/state.js");
    window.M = await import('/js/items/itemManager.js'); window.R = await import("/js/combat/attackResolution.js");
    window.dropEntity = position => {
      const transfer = new DataTransfer(); transfer.setData('text', 'Box_Entite_999820');
      document.querySelector(`.hex[data-position="${position}"]`).dispatchEvent(new DragEvent('drop', {dataTransfer:transfer,bubbles:true,cancelable:true}));
    };
    window.readTactical = () => ({ now:Clock.clockNow(), entities:E.entites.map(e=>({id:e.id,position:e.position,hp:e.stats.HP.current,
      shift:e.stats.shift.current,selection:e.attackSelection,action:e._combatAction,poison:e.stats.poison})),
      inventory:M.getBattleInventoryState(), ground:Clock.captureCombatState().ground, orders:Clock.captureCombatState().orders });
  });
}
async function verifyPhaserGestures() {
  for (const mode of (process.env.DRAG_TEST_MODE ? [process.env.DRAG_TEST_MODE] : ['mouse','touch'])) {
    const touch=mode==='touch',page=await fixture({speed:50000,gesture:true,touch});await attach(page);
    await page.evaluate(async()=>{
      const B=await import('/js/board/controller.js'),S=await import('/js/storage/gameStorage.js');
      Math.random=()=>.99;window.B=B;
      for(const [position,left] of [['3',180],['4',390]]) {
        const hex=document.createElement('div');hex.className='hex SideA';hex.dataset.position=position;
        hex.style.cssText=`position:absolute;left:${left}px;top:280px;width:160px;height:180px`;
        hex.innerHTML='<div class="socle gueux"></div>';document.querySelector('#hexGrid').append(hex);
      }
      B.invalidateFootprintGeometry(document.getElementById('hexGrid'));B.syncEntityFootprints();
      document.querySelector('.entitylootContainer')?.remove();
      S.setAdminMode(false);window.levelRunning='scripted';
      S.saveToLocalStorage('GameStages',{stages:[{id:'pause-test',level_type:'scripted'}]});
      window.Drag=await import('/js/rendering/animations.js');
      (await import('/js/board/interaction.js')).restoreEntityDragAndDrop();
      (await import('/js/ui/display.js')).toggleScanEntityListener();
      G.startGame();(await import('/js/items/resourceStocks.js')).addMovementCharges(E.entites[0],40);
      window.moveCost=1+E.getMovementWeightMalus(E.entites[0]).shiftCostModifier;
      await P.pauseCombat();
    });
    await ready(page);await page.waitForFunction(()=>Drag.isPhaserBoardDragReady());
    const cdp=touch?await page.context().newCDPSession(page):null;
    const source=()=>page.evaluate(()=>{
      const r=document.getElementById('spriteCanvas_999820').getBoundingClientRect(),points=[];
      // Use the existing shaped hitbox, away from its subpixel boundary.
      for(let y=Math.max(1,Math.ceil(r.top+4));y<Math.min(innerHeight-1,r.bottom-4);y+=3)
        for(let x=Math.max(1,Math.ceil(r.left+4));x<Math.min(innerWidth-1,r.right-4);x+=3)
          if([[0,0],[2,0],[-2,0],[0,2],[0,-2]].every(([dx,dy])=>document.elementFromPoint(x+dx,y+dy)?.closest('#DragSprite_999820')))
            points.push({x,y});
      if(points.length)return points.sort((a,b)=>Math.hypot(a.x-r.left-r.width/2,a.y-r.top-r.height/2)-Math.hypot(b.x-r.left-r.width/2,b.y-r.top-r.height/2))[0];
      throw Error('Monster hitbox is not reachable');
    });
    const target=position=>page.evaluate(position=>{
      const r=document.querySelector(`.hex[data-position="${position}"]`).getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height*.65};
    },position);
    let current;
    const down=async()=>{current=await source();if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...current,id:0}]});
      else {await page.mouse.move(current.x,current.y);await page.mouse.down();}};
    const move=async point=>{const start=current;for(let i=1;i<=6;i++) {current={x:start.x+(point.x-start.x)*i/6,y:start.y+(point.y-start.y)*i/6};
      if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...current,id:0}]});else await page.mouse.move(current.x,current.y);}};
    const up=()=>touch?cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}):page.mouse.up();
    const state=()=>page.evaluate(()=>({now:Clock.clockNow(),positions:E.entites.map(e=>e.position),charges:E.entites.map(e=>e.stats.shift.current),hp:E.entites.map(e=>e.stats.HP.current)}));
    const clean=async()=>{await page.waitForFunction(()=>!Drag.testBoardGesture().active);const d=await page.evaluate(()=>Drag.testBoardGesture());
      assert.equal(d.preview,0);assert.equal(d.texture,false);assert.equal(await page.locator('body.drag-drop-active').count(),0,'Drag helper state is released');assert.equal(await page.locator('#hexGrid.phaser-dragging, #hexGrid .dragged').count(),0);};
    const gesture=async position=>{await down();await move(await target(position));await up();await clean();};
    const initial=await state(),cost=await page.evaluate(()=>moveCost);
    // Clicking and tiny movements are still inspection, never a paid placement.
    await page.evaluate(()=>{window.gestureClicks=0;document.getElementById('spriteContainer_999820').addEventListener('click',()=>gestureClicks++);});
    await down();await move({x:current.x+3,y:current.y});await up();await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>gestureClicks),1);assert.deepEqual(await state(),initial);
    await page.evaluate(async()=>{(await import('/js/ui/attacks.js')).hideCombatAttackControlPanel();});
    await down();await move(await target('3'));
    await page.waitForFunction(()=>Drag.testBoardGesture().active);
    const preview=await page.evaluate(()=>Drag.testBoardGesture());assert.equal(preview.preview,1);assert.equal(preview.texture,true);assert.equal(await page.locator('body.drag-drop-active').count(),1,'Hover helpers remain suppressed during Phaser drag');
    assert.deepEqual(await state(),initial,'Dragging never moves a logical occupant or spends a charge');
    await page.waitForTimeout(250);assert.deepEqual(await state(),initial,'UI gesture does not advance combat');
    await page.screenshot({path:resolve(output,`phaser-drag-${mode}.png`)});
    await up();await clean();await ready(page);
    const moved=await state();assert.equal(moved.positions[0],'3');assert.equal(moved.charges[0],initial.charges[0]-cost);assert.equal(moved.now,initial.now);
    assert.equal(await page.evaluate(()=>gestureClicks),1,'Releasing a drag cannot open the inspection panel');
    await gesture('3');assert.deepEqual(await state(),moved,'Same-cell drop is free');
    await gesture('2');assert.deepEqual(await state(),moved,'Enemy cell is rejected');
    await down();await move({x:5,y:750});await up();await clean();assert.deepEqual(await state(),moved,'Drop outside the board cancels');
    await down();await move(await target('1'));
    if(touch)await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});else {await page.keyboard.press('Escape');await up();}
    await clean();assert.deepEqual(await state(),moved,'Interrupted gesture is free');
    if(touch) {
      await down();await move(await target('1'));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...current,id:0},{x:current.x+30,y:current.y,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await clean();assert.deepEqual(await state(),moved,'A second finger cancels instead of issuing a second move');
    }
    await page.evaluate(()=>{E.entites[0].stats.shift.current=0;});await gesture('1');assert.equal((await state()).positions[0],'3');
    await page.evaluate(value=>{E.entites[0].stats.shift.current=value;},moved.charges[0]);
    await page.evaluate(async()=>{const C=await import('/js/combat/control.js');C.addEntityControl(E.entites[0],'immobilisation',Timeline.combatNow(),Timeline.combatNow()+5000);});
    await gesture('1');assert.deepEqual(await state(),moved,'Immobilisation retains its rule and charge');
    await page.evaluate(async()=>{(await import('/js/combat/control.js')).endEntityControl(E.entites[0],'immobilisation');});
    // Repeated reconstruction binds one gesture, with one cost per accepted drop.
    await page.evaluate(async()=>{const I=await import('/js/board/interaction.js');for(let i=0;i<5;i++)I.restoreEntityDragAndDrop();});
    await gesture('1');await ready(page);assert.equal((await state()).charges[0],moved.charges[0]-cost);
    await down();await move(await target('3'));
    await page.evaluate(()=>{E.entites[0].isDEAD=true;});await page.waitForFunction(()=>!Drag.testBoardGesture().active);
    await up();await clean();assert.equal((await state()).positions[0],'1');
    await page.evaluate(()=>{E.entites[0].isDEAD=false;});
    // A newly created ally participates without its own input listeners.
    await page.evaluate(async()=>{
      const template=(await import('/js/data/entityTemplates.js')).entitesNest.find(e=>e.serial===7);
      const ally=E.enrichEntityStats({...structuredClone(template),id:999822,side:'A',position:'4',type:'sbire',role:'gueux',level:1,awakening:1,stuff:{},stats:{},modifierStats:{},baseStats:{HP:1000,speed:50000},attacks:['shot-p-c']});
      ally.statut=['alive'];ally.isDEAD=false;E.entites.push(ally);
      const created=(await import('/js/rendering/entities.js')).createEntiteInDOM(ally);document.querySelector('.hex[data-position="4"]').append(created.element);await created.spriteReady;
      B.syncEntityFootprints();
    });
    const beforeSwap=await state();await gesture('4');await ready(page);
    const swapped=await state();assert.deepEqual(swapped.positions,['4','2','1']);assert.equal(swapped.charges[0],beforeSwap.charges[0]-cost);
    assert.equal(swapped.charges[2],beforeSwap.charges[2],'Only the dragged ally spends movement');
    await page.reload();await ready(page);await attach(page);
    await page.evaluate(async()=>{window.Drag=await import('/js/rendering/animations.js');});
    await page.waitForFunction(()=>Drag.isPhaserBoardDragReady());
    assert.deepEqual(await state(),swapped,'F5 preserves the committed placement and cost, never its drag preview');await clean();
    await gesture('3');await ready(page);assert.equal((await state()).positions[0],'3','A restored board remains draggable');
    const beforeBlocked=await state();
    await page.evaluate(()=>Clock.setCombatInteractionBlocked(true));await gesture('4');assert.deepEqual(await state(),beforeBlocked,'Absolute pause blocks placement');
    await page.evaluate(()=>Clock.setCombatInteractionBlocked(false));
    await page.keyboard.press('Space');await page.waitForFunction(()=>!Clock.isCombatPaused());
    // Let the restored swap's existing HTML animation settle before picking its moving hitbox.
    await page.waitForTimeout(650);
    const live=await state();await gesture('4');const afterLive=await state();assert.equal(afterLive.positions[0],'4');assert.equal(afterLive.charges[0],live.charges[0]-cost);
    await page.evaluate(()=>G.StopGame({preserveScene:true}));await clean();
    console.log('PASS Phaser '+mode+': real gesture, preview, costs, blocked moves, cancellation, swap, pause/F5, restored and live combat');
    await page.close();
  }
}

try {
  if (!process.env.DRAG_TEST_ONLY) {
  const page=await fixture({speed:50000}); await attach(page);
  await page.evaluate(async()=>{
    const S=await import("/js/storage/gameStorage.js");
    const actor=E.entites[0]; actor.baseStats.shift=10;actor.baseStats.charge=3;
    E.recomputeEntityStats(actor,{skipReverseArchetype:true}); actor.stats.HP.current=400;
    actor.attacks.push({...structuredClone(actor.attacks[0]),functionName:'second-test',attackId:'second-test',attackKey:'second-test',displayName:'Seconde attaque'});
    S.saveToLocalStorage('selectedArmyA',[actor]);window.selectedArmyA=[actor];
    S.saveToLocalStorage('PlayerSave',{Playerinventory:[],equippedItems:[]}); S.saveToLocalStorage('IngameItems',[]);
    M.setBattleSlotCount(2,{admin:true});
    const {ItemDetails}=await import('/js/data/itemList.js');
    window.movementItem=M.acquireItem(ItemDetails.find(i=>i.functionName==='MovementChargeSeven'),'pause-test');
    window.healItem=M.acquireItem(ItemDetails.find(i=>i.effets?.length===1 && i.effets[0]==='itemHeal'),'pause-test');
    if(!M.moveBattleItem(movementItem.itemId,0)||!M.moveBattleItem(healItem.itemId,1))throw Error('Pouch setup failed');
    for(const position of ['3','4']){
      const hex=document.createElement('div');hex.className='hex SideA';hex.dataset.position=position;
      hex.style.cssText=`position:absolute;left:${position==='3'?180:360}px;top:280px;width:160px;height:180px`;
      hex.innerHTML='<div class="socle gueux"></div>';document.querySelector('#hexGrid').append(hex);
    }
    // This fixture adds cells directly: explicitly publish its new geometry.
    const board=await import('/js/board/controller.js');
    board.invalidateFootprintGeometry(document.getElementById('hexGrid')); board.syncEntityFootprints();
    const drag=await import("/js/board/interaction.js");drag.restoreEntityDragAndDrop();
    document.querySelector('.entitylootContainer')?.remove();
    S.setAdminMode(false);window.levelRunning='scripted';
    S.saveToLocalStorage('GameStages',{stages:[{id:'pause-test',level_type:'scripted'}]});
    const {summons}=await import('/js/data/summons.js');const ground=await import("/js/combat/summons.js");
    G.startGame();
    (await import('/js/items/resourceStocks.js')).addMovementCharges(actor,20);
    window.moveCost=1+E.getMovementWeightMalus(actor).shiftCostModifier;
    ground.spawnConsumableSummon(document.querySelector('[data-position="3"].hex'),{...summons.find(s=>s.summonEffet?.includes('healConsommable')),summonDuration:20},{attacker:actor});
    ground.spawnConsumableSummon(document.querySelector('[data-position="4"].hex'),{...summons.find(s=>s.summonEffet?.includes('poisonConsommable')),summonDuration:20},{attacker:E.entites[1]});
  });
  await page.keyboard.press('Space');await ready(page);
  assert.deepEqual(await page.evaluate(()=>P.getCombatPauseReasons()),{tactical:true,absolute:false});
  const start=await page.evaluate(()=>readTactical()), moveCost=await page.evaluate(()=>moveCost);
  assert.equal(await page.evaluate(()=>G.getStageAccess().menusAllowed),false,'pause does not unlock safe menus');
  await page.evaluate(()=>{
    const sprite=document.querySelector('#Box_Entite_999820 .sprite');
    sprite.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));
    dropEntity('3');sprite.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
  });await ready(page);
  await page.waitForFunction(()=>[...document.querySelectorAll('.sprite')].every(e=>e.style.pointerEvents!=='none'));
  const moved=await page.evaluate(()=>readTactical());
  assert.equal(moved.entities[0].position,'3');assert.equal(moved.entities[0].shift,start.entities[0].shift-moveCost,'normal movement cost paid');
  assert.ok(moved.entities[0].hp>start.entities[0].hp,'ground healing resolves while time is frozen');
  assert.equal(moved.now,start.now);
  await page.evaluate(()=>dropEntity('4'));await ready(page);
  const poisoned=await page.evaluate(()=>readTactical());
  assert.equal(poisoned.entities[0].position,'4');assert.equal(poisoned.entities[0].shift,start.entities[0].shift-2*moveCost);
  await page.waitForTimeout(1200);
  assert.equal((await page.evaluate(()=>readTactical())).entities[0].hp,poisoned.entities[0].hp,'new poison waits for combat time');
  // Visible console/field focus stays tactical; only a hidden tab blocks actions.
  await page.evaluate(()=>{
    window.inspected=0;const btn=document.createElement('button');btn.id='inspect-test';btn.onclick=()=>inspected++;document.body.append(btn);
    const input=document.createElement('input');input.id='focus-test';document.body.append(input);input.focus();input.blur();btn.click();
  });
  assert.equal(await page.evaluate(()=>inspected),1);
  assert.equal(await page.evaluate(()=>P.getCombatPauseReasons().absolute),false);
  await page.evaluate(()=>{
    window.dispatchEvent(new Event('blur'));
    if(P.getCombatPauseReasons().absolute)throw Error('Console focus must not pause a visible page');
    window.testHidden=true;
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>testHidden});
    document.dispatchEvent(new Event('visibilitychange'));
  });await ready(page);
  assert.equal(await page.evaluate(()=>Clock.isCombatInteractionBlocked()),true);
  assert.equal(await page.evaluate(()=>{document.querySelector('#inspect-test').click();return inspected;}),1);
  assert.equal(await page.evaluate(async()=>(await M.useConsumableItem(movementItem.itemId,E.entites[0],{silent:true})).ok),false);
  await page.evaluate(()=>dropEntity('3'));
  assert.equal(await page.evaluate(()=>E.entites[0].position),'4');
  await page.evaluate(()=>{testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>Clock.isCombatInteractionBlocked()),true);
  await page.getByRole('button',{name:'Reprendre la partie',exact:true}).click();
  await ready(page);
  await page.waitForFunction(()=>!Clock.isCombatInteractionBlocked());
  assert.deepEqual(await page.evaluate(()=>P.getCombatPauseReasons()),{tactical:true,absolute:false});
  await page.evaluate(async()=>{
    const panel=await import("/js/ui/attacks.js");panel.showCombatAttackControlPanel(E.entites[0].id);
  });
  assert.ok(await page.locator('.combat-attack-control-card').count()>0,'real attack cards open during pause');
  const toggle=page.locator('.combat-attack-control-toggle').first();
  await toggle.click({force:true});await ready(page);
  assert.equal(await toggle.getAttribute('aria-pressed'),'false','attack toggle refreshes during pause');
  await toggle.click({force:true});await ready(page);
  console.log('PASS movement costs, immediate ground heal, frozen poison, inspection, hidden tab and stacked pauses');
  const result=await page.evaluate(async()=>{
    const move=await M.useConsumableItem(movementItem.itemId,E.entites[0],{silent:true});
    const heal=await M.useConsumableItem(healItem.itemId,E.entites[0],{silent:true});
    const definitions=R.readAttackDefinitionsForEntity(E.entites[0],(await import('/js/data/attackList.js')).attackDetails);
    const key=R.attackSelectionKey(definitions[1]);R.setAttackPriority(E.entites[0],definitions,key,1);
    R.setAttackEnabled(E.entites[0],definitions,key,false);
    (await import("/js/storage/entityStorage.js")).saveEntityAttackSelection(E.entites[0]);
    return {move,heal};
  });
  assert.equal(result.move.ok,true);assert.equal(result.heal.ok,true);await ready(page);
  const before=await page.evaluate(()=>readTactical());
  assert.equal(before.entities[0].shift,poisoned.entities[0].shift+7);
  assert.ok(before.entities[0].hp>poisoned.entities[0].hp);
  assert.deepEqual(before.inventory.battleSlots,[null,null]);
  assert.equal(before.now,start.now);
  await page.screenshot({path:resolve(output,'tactical-paused.png')});
  await page.reload();await ready(page);await attach(page);
  const after=await page.evaluate(()=>readTactical());
  assert.deepEqual(after,before,'F5 restores committed moves, charges, healing, poison, attack settings and spent items');
  await page.waitForTimeout(1200);assert.deepEqual(await page.evaluate(()=>readTactical()),after);
  console.log('PASS consumables, attack settings and F5 persist with no free charge or duplicate item');
  // Queue a flee order without touching current phase/projectiles until resume; persist it too.
  // The preceding absolute pause was dismissed and saved before F5.
  await page.waitForFunction(()=>!Clock.isCombatInteractionBlocked());
  assert.deepEqual(await page.evaluate(()=>P.getCombatPauseReasons()),{tactical:true,absolute:false});
  const queued=await page.evaluate(async()=>{
    const order=await import("/js/combat/orders.js");const phase=JSON.stringify(E.entites[0]._phaseTimer);
    await order.launchOrderCycleForSide('A','runaway');
    return {same:phase===JSON.stringify(E.entites[0]._phaseTimer),order:Clock.captureCombatState().orders.pendingPlayerOrder};
  });
  assert.equal(queued.same,true);assert.deepEqual(queued.order,{side:'A',orderType:'runaway'});await ready(page);
  await page.reload();await ready(page);await attach(page);
  assert.deepEqual(await page.evaluate(()=>Clock.captureCombatState().orders.pendingPlayerOrder),queued.order);
  await page.waitForFunction(()=>!Clock.isCombatInteractionBlocked());
  await page.keyboard.press('Space');await page.waitForFunction(()=>!Clock.isCombatPaused());
  await page.waitForFunction(()=>E.entites[0].orderPhase==='orderDecision');
  assert.equal(await page.evaluate(()=>Clock.captureCombatState().orders.pendingPlayerOrder),null);
  await page.evaluate(()=>G.StopGame({preserveScene:true}));
  console.log('PASS queued flee starts only after resume and survives F5');
  await page.close();
  }
  await verifyPhaserGestures();
  assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(done=>server.close(done));}
