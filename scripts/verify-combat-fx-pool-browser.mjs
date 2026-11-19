import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs'), output = resolve('outputs/combat-fluidity/pool-visuals');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try {
    let data = await readFile(file);
    if (file === resolve(root, "js/rendering/animations.js")) {
      data = data.toString() + '\nexport const testRenderer = () => ({active:phaserMelees.size,textures:Object.keys(phaserLayer?.scene?.textures?.list || {}).filter(k=>k.startsWith("melee:")).length,objects:phaserLayer?.scene?.children?.list.length || 0});\n';
    }
    res.setHeader('Content-Type', ({ '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' })[extname(file)] || 'application/octet-stream'); res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
await mkdir(output, { recursive: true });
let browser;
const results = {};
try {
  browser = await chromium.launch({ headless:true, channel:'chrome' });
  const page=await browser.newPage({viewport:{width:1000,height:700}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{
    window.A=await import('/js/rendering/animations.js');window.C=await import('/js/combat/clock.js');
    const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:#111';document.body.append(host);
    window.actors=[{id:98901,side:'A',type:'sbire'},{id:98902,side:'B',type:'sbire'}];
    actors.forEach((a,i)=>{const body=document.createElement('div');body.id=`DragSprite_${a.id}`;body.style.cssText=`position:absolute;left:${100+i*650}px;top:250px`;
      const canvas=document.createElement('canvas');canvas.id=`spriteCanvas_${a.id}`;canvas.width=canvas.height=64;body.append(canvas);host.append(body);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#f84';ctx.fillRect(8,8,48,48);});
    A.prepareCombatRenderer();
  });
  await page.waitForSelector('#phaser-projectiles canvas',{state:'attached'});
  const baseline=await page.evaluate(()=>A.testRenderer());
  for(let run=0;run<4;run++) {
    await page.evaluate(()=>{window.copies=Array.from({length:100},()=>A.animationMelee(actors[0],actors[1],true,{duration:2500}));});
    await page.waitForFunction(()=>copies.every(c=>c.ready));
    const active=await page.evaluate(()=>A.testRenderer());
    assert.equal(active.active,100);assert.equal(active.textures,100);
    await page.evaluate(()=>C.freezeCombatClock());
    const snapshot=await page.evaluate(()=>C.captureCombatState().melee);
    await page.waitForTimeout(160);
    assert.deepEqual(await page.evaluate(()=>C.captureCombatState().melee),snapshot);
    await page.evaluate(()=>{
      copies.slice(0,99).forEach(c=>c.cancel());
      if(getComputedStyle(document.getElementById('DragSprite_98901')).opacity!=='0')throw Error('Concurrent owner released the last visibility lock');
      copies[99].cancel();A.clearProjectileEffects(actors);C.resumeCombatClock();
      window.dispatchEvent(new Event('combatResumed'));
    });
    const end=await page.evaluate(()=>A.testRenderer());
    assert.deepEqual(end,baseline,'Copies release their textures and display objects after each burst');
    assert.equal(await page.locator('#phaser-projectiles canvas').count(),1);
    assert.equal(await page.locator('#phaser-projectiles').evaluate(n=>n.hidden),true);
    results['burst'+run]={active,end};
  }
  assert.deepEqual(errors,[]);
  console.log('PASS Phaser effects: four bursts of 100 simultaneous copies, independent visibility locks, pause, released textures and one idle canvas');

} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));
  await browser?.close(); await new Promise(done=>server.close(done));
}
