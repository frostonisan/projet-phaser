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
    if (file === resolve(root, "js/data/loaderList.js")) {
      data = data.toString() + `
export const testGifs = () => ({ active: animatedImages.size, ticking: sharedGifTick !== null, frameUrls: sharedGifSources.size });
export const testGif = image => animatedImages.get(image);
export const testGifFrames = source => sharedGifFrames(touchResource(source).value);
export const testGifSeek = (image, elapsed) => {
  cancelAnimationFrame(sharedGifTick); sharedGifTick = null;
  animatedImages.get(image).startedAt = performance.now() - elapsed; tickSharedGifs();
};`;
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
  const originalPixels = await page.locator('#spriteCanvas_98901').evaluate(canvas => canvas.toDataURL());
  for(let run=0;run<4;run++) {
    await page.evaluate(()=>{window.copies=Array.from({length:100},()=>A.animationMelee(actors[0],actors[1],true,{duration:2500}));});
    await page.waitForFunction(()=>copies.every(c=>c.ready));
    const active=await page.evaluate(()=>A.testRenderer());
    assert.equal(active.active,100);assert.equal(active.textures,1, "Simultaneous neutral copies share one GPU texture");
    await page.evaluate(()=>C.freezeCombatClock());
    const snapshot=await page.evaluate(()=>C.captureCombatState().melee);
    assert.ok(snapshot.active.every(copy => copy.resume.pixels === originalPixels), 'Shared copies keep exact neutral pixels across impacts and texture release');
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
    await page.evaluate(() => A.applyEntityTint(document.getElementById('spriteCanvas_98901'), 'damageImpact', .6));
  }
  // Compare every decoded effect frame against Chromium's independent GIF decoder,
  // including disposal/transparency. Keep original dimensions and native 0/10ms delays.
  results.gifPixels = await page.evaluate(async () => {
    const L = window.L = await import('/js/data/loaderList.js');
    const counts = {};
    for (const name of ['blood-impact-1', 'blood-impact-2', 'blood-impact-3', 'blood-impact-4',
      'armor-impact', 'recovery', 'death-blood', 'dodge-smoke', 'mysticism', 'mysticism-attack']) {
      const source = `/media/assets/effects/${name}.gif`, resource = await L.loadResource(source);
      const frames = await L.testGifFrames(source);
      const playback = new Image(); document.body.append(playback);
      await L.playCachedGif(playback, source, { shared: true });
      if (L.testGif(playback).frames !== frames) throw Error(`${name}: prepared frames must actually be used`);
      playback.remove();
      const decoder = new ImageDecoder({ data: await resource.blob.arrayBuffer(), type: 'image/gif' });
      await decoder.tracks.ready;
      if (decoder.tracks.selectedTrack.frameCount !== frames.urls.length) throw Error(`${name}: frame count`);
      const canvas = document.createElement('canvas'); canvas.width = resource.image.naturalWidth; canvas.height = resource.image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      for (let index = 0; index < frames.urls.length; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); image.close();
        const expected = context.getImageData(0, 0, canvas.width, canvas.height).data;
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(frames.images[index], 0, 0);
        const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
        if (actual.some((value, pixel) => value !== expected[pixel])) throw Error(`${name}: pixels differ at frame ${index}`);
      }
      decoder.close(); counts[name] = frames.urls.length;
    }
    return counts;
  });
  results.gifPlayback = await page.evaluate(async () => {
    const host = document.createElement('div'); document.body.append(host);
    const source = '/media/assets/effects/recovery.gif', frames = await L.testGifFrames(source);
    const images = Array.from({ length: 80 }, () => { const image = new Image(); host.append(image); return image; });
    await Promise.all(images.map(image => L.playCachedGif(image, source, { shared: true })));
    if (!images.every(image => L.testGif(image).frames === frames)) throw Error('Instances must share frames');
    L.testGifSeek(images[0], frames.durations[0] + 1);
    if (L.testGif(images[0]).frame !== 1 || L.testGif(images[1]).frame !== 0) throw Error('Independent GIF epochs');
    await L.playCachedGif(images[0], source, { shared: true });
    if (L.testGif(images[0]).frame !== 0) throw Error('GIF restart');
    const persisted = L.persistentMediaMarkup(host.outerHTML);
    if (persisted.includes('blob:') || !persisted.includes('recovery.gif')) throw Error('Durable media for F5');
    host.remove(); await new Promise(resolve => setTimeout(resolve, 50));
    const cleaned = L.testGifs();
    if (cleaned.active || cleaned.ticking) throw Error('Detached images must release playback and RAF');
    return { count: images.length, sharedFrames: frames.urls.length, nativeDelay: frames.durations[0], cleaned };
  });
  results.gifLifecycle = await page.evaluate(async () => {
    const source = '/media/assets/effects/blood-impact-5.gif', recovery = '/media/assets/effects/recovery.gif';
    await L.loadResource(source);
    const image = new Image(); document.body.append(image);
    await L.playCachedGif(image, source, { shared: true });
    await L.playCachedGif(image, recovery, { shared: true });
    await L.testGifFrames(source);
    if (!L.testGif(image).key.endsWith('/recovery.gif')) throw Error('Old async decode replaced a newer effect');
    const cached = L.testGif(image).frames, now = Date.now;
    try {
      Date.now = () => now() + 360001;
      L.evictUnusedResources();
      if (L.testGif(image).frames !== cached || !L.testGifs().frameUrls) throw Error('Active shared frames were evicted');
      image.remove(); await new Promise(resolve => setTimeout(resolve, 30));
      Date.now = () => now() + 720002;
      L.evictUnusedResources();
      if (L.testGifs().frameUrls || L.testGifs().ticking) throw Error('Unused shared frames/RAF retained');
    } finally { Date.now = now; image.remove(); }
    await L.loadResource('/media/assets/effects/blood-impact-6.gif');
    const cold = new Image(); document.body.append(cold);
    await L.playCachedGif(cold, '/media/assets/effects/blood-impact-6.gif', { shared: true }); cold.remove();
    await L.testGifFrames('/media/assets/effects/blood-impact-6.gif');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (L.testGifs().active || L.testGifs().ticking) throw Error('Late decode resurrected a removed effect');
    await L.prepareLevelResources(new Set([recovery]), { retryOnly: true });
    const prepared = new Image(); document.body.append(prepared);
    const createURL = URL.createObjectURL; let allocations = 0;
    URL.createObjectURL = (...args) => { allocations++; return createURL.apply(URL, args); };
    try { await L.playCachedGif(prepared, recovery, { shared: true }); }
    finally { URL.createObjectURL = createURL; }
    if (allocations || !L.testGif(prepared).frames) throw Error('Level loader must prepare frames before the first hit');
    prepared.remove(); await new Promise(resolve => setTimeout(resolve, 30));
    const large = new Image(); document.body.append(large);
    await L.playCachedGif(large, '/media/assets/effects/castingfx-base.gif', { shared: true });
    if (L.testGif(large).frames || !L.testGif(large).url) throw Error('Large GIF must keep bounded native fallback');
    large.remove(); await new Promise(resolve => setTimeout(resolve, 30));
    return { asyncReplacement: true, activeCacheProtected: true, cacheEvicted: true, coldRemoval: true, preparedBeforeCombat: true, largeFallback: true };
  });
  assert.deepEqual(errors,[]);
  console.log('PASS Phaser effects: four bursts of 100 simultaneous copies, independent visibility locks, pause, released textures and one idle canvas');

} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));
  await browser?.close(); await new Promise(done=>server.close(done));
}
