import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs'), output = resolve('outputs/damage-popup');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try {
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.addStyleTag({ url: `http://127.0.0.1:${server.address().port}/css/battle-infos.css` });
  await page.addStyleTag({ content: 'body{background:#15191d!important} #popup-audit{position:fixed;inset:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;overflow:auto;color:white} .popup-case{background:#252a2f;padding:8px;text-align:center;font:13px Arial} #popup-audit .damage-popup{position:relative;animation:none!important;transform:none!important;opacity:1;margin:8px 0}' });
  const failures = await page.evaluate(async () => {
    const { PopUpDamages } = await import('/js/dom.js');
    document.body.innerHTML = '<main id="popup-audit"></main>';
    const natures = ['physicalDamage', 'magicalDamage', 'transpiercingDamage', 'hybridalDamage',
      'physicalPiercingDamage', 'magicalPiercingDamage', 'hybridalPiercingDamage', 'inerte'];
    const cases = natures.flatMap(nature => ['normal', 'critical'].map(kind => ({ nature, kind, hp: 23, armor: 0 })));
    cases.push({ nature: 'magicalDamage', kind: 'normal', hp: 0, armor: 9 },
      { nature: 'hybridalPiercingDamage', kind: 'normal', hp: 12, armor: 3 },
      { nature: 'physicalDamage', kind: 'critical', hp: 12, armor: 3 },
      { nature: 'inerte', kind: 'critical', hp: 0, armor: 0 },
      { nature: 'physicalDamage', kind: 'execution-critical', hp: 17, armor: 0 },
      { nature: '', expected: 'hybridalPiercingDamage', kind: 'normal', hp: 7, armor: 0 });
    const failures = [];
    for (const [index, test] of cases.entries()) {
      const card = document.createElement('section'); card.className = 'popup-case';
      card.textContent = `${test.expected || test.nature} · ${test.kind}`;
      const container = document.createElement('div'); container.id = `PopUp_${index}`;
      const status = document.createElement('div'); status.id = `PopDow_${index}`; status.className = 'combat-popup-status';
      card.append(container, status); document.getElementById('popup-audit').append(card);
      const target = { id: index, stats: { HP: { current: 50, max: 100 }, armor: { current: 0, max: 9 } } };
      const before = JSON.stringify(target);
      PopUpDamages(target, test.hp, [], '', { physical: 100, magical: 200, piercingDamage: 300 }, test.kind, test.armor, test.nature);
      const popup = container.querySelector('.damage-popup--nature');
      const nature = test.expected || test.nature;
      const icon = popup?.firstElementChild, value = popup?.querySelector('.damage-popup-value');
      const critical = test.kind === 'critical' || test.kind === 'execution-critical';
      const criticalIcon = test.kind === 'execution-critical' ? 'execution-critical' : 'criticalPower';
      const criticalAsset = test.kind === 'execution-critical' ? 'picto-critical-bloodFury%20.svg' : 'picto-crit-power.svg';
      const colorReference = document.createElement('span');
      colorReference.className = nature;
      card.appendChild(colorReference);
      if (!icon?.matches(`.picto-stat.${critical ? criticalIcon : nature}`) || !value?.matches(`.damage-popup-value.${nature}`)
        || value.textContent !== `−${test.hp + test.armor}` || popup.children.length !== (critical ? 3 : 2)
        || (critical && popup.querySelector('.combat-popup-critical-suffix')?.textContent !== '!!!')
        || getComputedStyle(icon).backgroundImage === 'none'
        || (critical && !getComputedStyle(icon).backgroundImage.includes(criticalAsset))
        || popup.classList.contains('damage-popup--execution-critical') !== (test.kind === 'execution-critical')
        || Number.parseFloat(getComputedStyle(value).fontSize) !== (test.kind === 'execution-critical' ? 40 : critical ? 32 : 24)
        || getComputedStyle(value).color !== getComputedStyle(colorReference).color
        || !getComputedStyle(value).getPropertyValue('--stat-color').trim()
        || getComputedStyle(value).color === 'rgb(255, 255, 255)'
        || container.querySelector('.damage-popup.detail') || JSON.stringify(target) !== before) failures.push(test);
      if (test.armor > 0 && !status.querySelector('.damage-popup--armor-destroyed')) failures.push({ missingArmorNotice: index });
    }
    return failures;
  });
  assert.deepEqual(failures, []);
  const feedback = await page.evaluate(async () => {
    const F = await import('/js/rendering/damageFeedback.js');
    const id = 'damage-feedback-audit';
    const host = document.createElement('section');
    host.innerHTML = `<div id="PopDow_${id}" class="combat-popup-status"></div><div id="effectsContainer_${id}"></div>`;
    document.body.append(host);
    const target = { id, name: 'Feedback', stats: { HP: { current: 50, max: 100 }, armor: { current: 9, max: 9 } } };
    const before = JSON.stringify(target);
    const result = Object.freeze({ indestructPercent: 40, minIndestructFloor: 0, roll: 10, success: false });
    F.presentIndestructibilityResult(target, result);
    const noFalseProc = !host.querySelector('.indestructibility');
    F.presentIndestructibilityResult(target, { ...result, success: true });
    F.presentEsoterismResult(target, { esoterismPercent: 40, roll: 10, success: true });
    F.presentDodgeResult(target, target, { partial: true, boostedDodgeFlat: 0, boostedDodgePercent: 0,
      baseDodgePercent: 40, totalDodgePercent: 40, precisionPercent: 0, adjustedDodgeChance: 40,
      adjustedHitChance: 60, roll: 10, dodgeSuccess: true });
    F.showResilienceCancellation(target, 'resilienceCancel');
    F.presentBrokenSpell(target, 12.5);
    F.AmbidextryVFX(target);
    F.presentExecutionImpact(target);
    F.attemptBattleRegen(target, 17);
    const effects = ['indestructibility', 'esoterism', 'resilience', 'broken-spell', 'ambidextry', 'bloodfuryexec'];
    const checks = { noFalseProc, visuals: effects.every(name => host.querySelector('img.' + name)),
      partialDodge: host.textContent.includes('Esquive partielle !'),
      resilience: host.textContent.includes('Résilience totale !'),
      regen: host.querySelector('.battle-regen-hp-vfx')?.textContent.trim() === '+17 HP',
      unchanged: JSON.stringify(target) === before, resultUnchanged: result.success === false };
    host.remove();
    return checks;
  });
  assert.ok(Object.values(feedback).every(Boolean), JSON.stringify(feedback));
  const vitals = await page.evaluate(async () => {
    const R = await import('/js/rendering/vitalFeedback.js');
    const A = await import('/js/combat/vitalApplication.js');
    const V = await import('/js/combat/vitalRules.js');
    const id = 'vital-boundaries-audit';
    const host = document.createElement('section');
    host.innerHTML = '<div id="HeadsupLifeBars_' + id + '"><div class="health-bar" data-stat="hp-bar" data-entity-id="' + id + '"><div class="health-fill"></div></div></div>'
      + '<span class="HP-counter" data-stat="HP" data-entity-id="' + id + '"></span>'
      + '<div id="PopUp_' + id + '"></div><div id="PopDow_' + id + '"></div>';
    document.body.append(host);
    const entity = { id, name: 'Vitals', totalHeal: 0, stats: { HP: { current: 50, max: 100 }, armor: { current: 16, max: 0 } },
      armorLayers: { consumable: { current: 16, max: 16 }, spell: { current: 0, max: 0 },
        external: { current: 0, max: 0 }, robustness: { current: 0, max: 0 }, stuff: {} } };
    const before = JSON.stringify(entity);
    const hp = Object.freeze(V.calculateHpDamage(50, 13));
    const calculationReadOnly = JSON.stringify(entity) === before;
    A.applyHpChange(entity, hp);
    const armor = A.applyArmorDamage(entity, 7);
    const noPrematureDisplay = !host.querySelector('.damage-popup') && host.querySelector('.HP-counter').textContent === '';
    const applied = JSON.stringify(entity);
    const storageBefore = JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]));
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    freeze(entity);
    const outcome = freeze({ hpDamage: 13, armorDamage: 7, effects: [], sources: { physical: 13 },
      content: '', nature: 'physicalDamage', execution: true, critical: true });
    R.presentEntityVitals(entity);
    R.presentDamageOutcome(entity, outcome);
    R.presentEntityVitals(entity);
    const checks = { calculationReadOnly, noPrematureDisplay,
      hpAppliedOnce: entity.stats.HP.current === 37, armorAppliedOnce: entity.stats.armor.current === 9 && armor.absorbed === 7,
      bar: host.querySelector('.HP-counter').textContent === 'HP : 37 / 100',
      armorBar: host.querySelector('.armor-bar').dataset.prevArmor === '9',
      combinedDamage: host.querySelector('.damage-popup-value').textContent === '−20',
      executionCritical: !!host.querySelector('.damage-popup--execution-critical'),
      unchanged: JSON.stringify(entity) === applied,
      noStorageWrite: JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])) === storageBefore };
    R.presentSupportHealing(entity, entity, 5);
    R.presentExecutionHealing(entity, 5);
    checks.healDisplayReadOnly = JSON.stringify(entity) === applied;
    host.remove();
    return checks;
  });
  assert.ok(Object.values(vitals).every(Boolean), JSON.stringify(vitals));
  await page.screenshot({ path: resolve(output, 'nature-and-totals.png') });
  assert.deepEqual(errors, []);
  console.log('PASS damage popups: eight nature colors, critical icons and !!!, size tiers, execution criticals, zero damage, armor + HP totals, separate armor notice and unchanged gameplay data.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
