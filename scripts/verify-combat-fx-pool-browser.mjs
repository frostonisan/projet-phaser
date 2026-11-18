import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const prototype = require('./combat-fx-pool-prototype.cjs');
const root = resolve('docs'), output = resolve('outputs/combat-fluidity/pool-visuals');
let pool = false;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try {
    let data = await readFile(file);
    if (file === resolve(root, 'js/entitesAnimation.js')) {
      data = pool ? prototype(data.toString()) : data.toString();
      data += '\nexport { playMeleeImpactFx as testPlay, releaseMeleeImpactFx as testRelease };\n';
      data += `export const testPool = () => ${pool ? 'measuredMeleeImpactPool' : '[]'};`;
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
  for (const variant of ['current','pool']) {
    pool = variant === 'pool';
    const page = await browser.newPage({ viewport:{width:1000,height:700} });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    results[variant] = await page.evaluate(async pooled => {
      const A = await import('/js/entitesAnimation.js');
      const parent = document.createElement('div'); parent.className = 'BattleFX'; parent.style.cssText = 'position:fixed;inset:0;background:#111'; document.body.append(parent);
      const target = document.createElement('div'); target.style.cssText = 'position:absolute;left:300px;top:300px;width:60px;height:60px;background:#567;transform:translate(7px,9px) scale(1.2)'; parent.append(target);
      const samples = [], counts = [];
      const sample = layer => [target,layer,...layer.children].map(node => {
        const css = getComputedStyle(node);
        return { transform:css.transform, opacity:css.opacity, left:css.left, top:css.top, width:css.width, height:css.height, filter:css.filter,
          frames:node.getAnimations().map(a => ({frames:a.effect.getKeyframes(),timing:a.effect.getTiming()})) };
      });
      let first;
      for (let run = 0; run < 8; run++) {
        const layer = A.testPlay(parent,target,330,330,1,0,140);
        first ||= layer;
        if (pooled && layer !== first) throw Error('Reusable layer was not reused');
        for (const time of [0,20,70,110,140]) {
          layer._animations.forEach(a => { a.pause(); a.currentTime = time; });
          samples.push(sample(layer));
        }
        A.testRelease(layer);
        if (target.getAnimations().length) throw Error('Released target shake still running');
      }
      // Max pool size, concurrent owners and stale cancellation checks.
      const burst = Array.from({length:100},(_,i)=>A.testPlay(parent,target,100+i,100,1,0,140));
      if (new Set(burst).size !== 100) throw Error('Two concurrent hits share a layer');
      const newest = target._damageImpactVibration;
      A.testRelease(burst[0]);
      if (newest.playState === 'idle') throw Error('Releasing an old hit cancelled the latest hit');
      burst.slice(1).forEach(A.testRelease);
      counts.push(A.testPool().length);
      if (A.testPool().length > 64 || A.testPool().some(n=>n.isConnected || n._animations.length)) throw Error('Pool retains active or unbounded effects');
      const held = A.testPlay(parent,target,330,330,1,0,140);
      held._animations.forEach(a=>{a.pause();a.currentTime=50;});
      const paused = sample(held); await new Promise(done=>setTimeout(done,150));
      if (JSON.stringify(paused)!==JSON.stringify(sample(held))) throw Error('Paused effect moved');
      A.testRelease(held);
      return { samples, counts, remaining:parent.querySelectorAll('.melee-impact-fx').length };
    }, pool);
    assert.deepEqual(errors, []); assert.equal(results[variant].remaining,0);
    await page.close();
  }
  assert.deepEqual(results.pool.samples, results.current.samples, 'Every sampled frame, duration, transform and opacity matches, including recycled layers');
  console.log('PASS pool prototype: identical animation samples; 100 simultaneous layers; cap 64; no lingering animations; pause preserved');
} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));
  await browser?.close(); await new Promise(done=>server.close(done));
}
