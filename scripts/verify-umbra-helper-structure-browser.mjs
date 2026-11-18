import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = resolve('docs'), output = resolve('outputs/umbra-helper-structure');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const setup = async () => {
    const E = await import('/js/entites.js'), D = await import('/js/damagesCalcul.js'), DDisplay = await import('/js/ui/statDetails.js');
    const UI = await import('/js/GameInit.js'), S = await import('/js/GameStorage.js');
    const { stats } = await import('/js/data/statsData.js');
    const umbras = stats.filter(stat => stat.nature === 'umbra');
    const entity = { id: 996711, name: 'Structure des Umbras', type: 'sbire', side: 'A', awakening: 3,
      level: { current: 20, max: 250 }, attacks: ['autoAttack'], stuff: {},
      baseStats: { HP: 120, strength: 25, intelligence: 25, agility: 25, physicalDamage: 30,
        physicalDamagePlus: 10, armor: 20, criticalChance: 7, attackPreparationReduc: 8,
        ...Object.fromEntries(umbras.map(stat => [stat.key, 12])) } };
    E.recomputeEntityStats(entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    E.entites.splice(0, E.entites.length, entity);
    S.saveToLocalStorage('equippedItems', []); S.saveToLocalStorage('selectedArmyA', [entity]);
    window.audit = { entity, D, DDisplay, E, UI, umbras, stats,
      show(key) {
        UI.closeOpenHelpers();
        document.body.innerHTML = '<div class="Game-helper"></div><main class="codex-entity-scan" id="audit" style="position:fixed;inset:0;padding:60px;background:#190707"></main>';
        const host = document.getElementById('audit');
        const stat = stats.find(stat => stat.key === key) || { key, name: key, nature: 'stat' };
        UI.createUmbraBlock(host, stat.name, () => this.entity.stats[key], this.entity, key);
        const row = host.querySelector('.stat-container');
        if (stat.nature !== 'umbra') {
          host.classList.add('codex-attack-stat-block');
          row.dataset.autonomousHelper = 'true';
        }
        UI.bindHelperEntity(row, this.entity);
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
    };
    const before = JSON.stringify(entity);
    for (const stat of umbras) {
      const value = DDisplay.calculateStatsDisplay(stat.key, entity);
      if (!value.helpContent.includes('data-umbra-section="introduction"')) throw Error(`Missing structure: ${stat.key}`);
    }
    if (JSON.stringify(entity) !== before) throw Error('Helper changed entity gameplay state');
    return umbras.map(stat => stat.key);
  };
  const keys = await page.evaluate(setup);
  const themes = { robustness: 'strenght', vigueur: 'strenght', constitution: 'strenght', esprit: 'intel', integrite: 'intel', finesse: 'agi', adresse: 'agi', vision: 'agi', criticalPower: 'agi' };
  const summaryLastKeys = Object.keys(themes);
  const attributes = { robustness: 'strength', vigueur: 'strength', constitution: 'strength', esprit: 'intelligence', integrite: 'intelligence', finesse: 'agility', adresse: 'agility', vision: 'agility', criticalPower: 'agility' };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    // Multi-capacity cards are covered by the dedicated resilience, equilibre, vivacite and astrality browser suites.
    for (const key of keys.filter(key => !['resilience', 'equilibre', 'vivacite', 'astrality'].includes(key))) {
      const framed = Object.hasOwn(themes, key);
      const summaryLast = summaryLastKeys.includes(key);
      await page.evaluate(key => audit.show(key), key);
      const card = page.locator('[data-umbra-pinned="true"]');
      await card.waitFor({ state: 'visible' });
      const title = await card.locator('.umbra-description').innerText();
      const name = await page.evaluate(key => audit.stats.find(stat => stat.key === key).name, key);
      if (framed) {
        assert.equal(await card.locator('.umbra-title-card .picto-stat + .umbra-header-name').innerText(), name);
        const titleFrame = await card.locator('.umbra-title-card').evaluate(node => {
          const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          const content = node.querySelector('.umbra-title-content').getBoundingClientRect();
          return { width: rect.width, height: rect.height, sprite: css.backgroundImage,
            fits: content.left >= rect.left + parseFloat(css.paddingLeft) - 1 && content.right <= rect.right - parseFloat(css.paddingRight) + 1
              && content.top >= rect.top + parseFloat(css.paddingTop) - 1 && content.bottom <= rect.bottom - parseFloat(css.paddingBottom) + 1,
            aboveDescription: rect.bottom <= node.parentElement.querySelector('.umbra-description').getBoundingClientRect().top };
        });
        assert.deepEqual([titleFrame.width, titleFrame.height], [140, 22], 'The title frame keeps fixed dimensions for every name');
        assert.ok(titleFrame.fits && titleFrame.aboveDescription, key + ': title fits in its frame above the taxonomy');
        assert.ok(titleFrame.sprite.includes('umbra-title-card-' + themes[key] + '.png'), key + ': title uses its attribute sprite');
      }
      assert.match(title, /^Umbra (d’attaque|de défense|utilitaire) (de Force|d’Intelligence|d’Agilité) niveau [123]$/);
      assert.match(await card.locator('[data-umbra-section="introduction"]').innerText(), /^Confère/);
      if (summaryLast) {
        assert.equal(await card.locator('[data-umbra-section="rounding"]').count(), 0);
        assert.equal(await card.locator('[data-umbra-section="ambiance"]').innerText(), await page.evaluate(key => audit.stats.find(stat => stat.key === key).ambiant, key));
        assert.equal(await card.locator('.umbra-capacity-panel [data-umbra-detail-toggle]').count(), 1);
        assert.equal(await card.locator('.umbra-capacity-panel [data-umbra-inline-detail]').count(), 1);
        assert.equal(await card.locator('.umbra-card-total .umbra-card-total-label').count(), 0);
        assert.equal(await card.locator('.stat-hover-body > .stat-source-details').count(), 0, 'No entity source summary below the Umbra lore');
        assert.equal(await card.locator('.umbra-card-line-short').count(), 0, 'No short duplicated separators');
        assert.equal(await card.locator('.umbra-card-totals > .umbra-card-line').count(), 0, 'Calculation and total share one compartment');
        assert.equal(await card.evaluate(node => [...node.querySelectorAll('[data-umbra-capacity]')].every(capacity =>
          capacity.nextElementSibling?.querySelector('[data-umbra-summary-for]')?.dataset.umbraSummaryFor === capacity.dataset.umbraCapacity)), true, 'Each ability is immediately followed by its own total');
        for (const ratio of await card.locator('[data-umbra-layout="card"] > .umbra-card-line').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width / node.parentElement.getBoundingClientRect().width))) {
          assert.ok(Math.abs(ratio - 1) < .001, 'Compartments use full-width separators');
        }
      } else assert.equal(await card.locator('[data-umbra-section="rounding"]').innerText(), 'La statistique peut être arrondie.');
      assert.equal(await card.evaluate(node => node.classList.contains('umbra-helper-card')), framed);
      const capacities = card.locator('[data-umbra-capacity]');
      assert.ok(await capacities.count() > 0, key);
      if (framed) assert.equal(await card.locator('[data-umbra-detail-toggle]').count(), ['vision', 'criticalPower'].includes(key) ? 2 : 1, 'Each passive gets a switch sharing the global detail preference');
      if (key === 'vision') {
        const passive = card.locator('[data-umbra-passive="bullsEye"]');
        assert.equal(await passive.locator('.umbra-passive-heading').innerText(), 'Passive exclusive');
        assert.equal(await passive.locator('.umbra-passive-corner').count(), 4);
        assert.match(await passive.locator('.umbra-passive-corner').first().evaluate(node => getComputedStyle(node).backgroundImage), /exclu-passiv-corner-agi\.png/);
        assert.equal(await passive.locator('.umbra-passive-icon .picto-stat.bullsEye').count(), 1);
        assert.equal(await passive.locator('.umbra-card-total').count(), 0, 'The passive has its own frame rather than a second total card');
        assert.doesNotMatch(await card.innerText(), /Bull’s Eye X/);
        assert.equal(await passive.evaluate(node => node.previousElementSibling.previousElementSibling.classList.contains('umbra-card-totals') && node.nextElementSibling.dataset.umbraSection === 'ambiance'), true);
        const value = await passive.evaluate(node => {
          const figure = node.querySelector('.helper-calculation-result');
          const model = node.closest('.stat-hover')._umbraCalculations[figure.dataset.umbraCalculation];
          return { actual: Number(figure.textContent.replace(/[^\d.\-]/g, '')), expected: model.contributions.find(part => part.kind === 'umbra').value };
        });
        assert.equal(value.actual, Math.round(value.expected*100)/100);
      }
      for (const capacity of await capacities.all()) {
        assert.deepEqual(await capacity.locator('[data-umbra-section]').evaluateAll(nodes => nodes.map(n => n.dataset.umbraSection)),
          framed ? ['capacity', 'calculation'] : ['capacity', 'calculation', 'total']);
        assert.match(await capacity.locator('[data-umbra-section="capacity"]').innerText(), framed ? /X\s*:/ : /^\+?\s*[\d.]+/);
        assert.doesNotMatch(await capacity.locator('[data-umbra-section="calculation"]').innerText(), /avant arrondi|au seuil|supplément conservé|Contributions arrondies/);
        const values = await capacity.evaluate(node => {
          const models = node.closest('.stat-hover')._umbraCalculations;
          const summary = node.closest('.stat-hover').querySelector(`[data-umbra-summary-for="${node.dataset.umbraCapacity}"]`) || node;
          const amount = section => (section === 'total' ? summary : node).querySelector('[data-umbra-section="' + section + '"] .helper-calculation-result');
          const number = element => Number(element.textContent.replace(/[^\d.\-]/g, ''));
          const total = models[amount('total').dataset.umbraCalculation];
          return { grant: number(amount('capacity')), expectedGrant: models[node.dataset.umbraCapacity].value,
            total: number(amount('total')), expectedTotal: total.umbraCardTotal ? total.contributions.find(part => part.kind === 'umbra').value : total.value,
            points: total.value, percent: !!total.effectiveness };
        });
        assert.equal(values.grant, Math.round(values.expectedGrant * 100) / 100, key + ': capability amount');
        assert.equal(values.total, Math.round(values.expectedTotal * 100) / 100, key + ': real total or converted efficacy');
        const summary = framed ? card.locator(`[data-umbra-summary-for="${await capacity.getAttribute('data-umbra-capacity')}"]`) : capacity;
        await summary.locator('[data-umbra-section="total"] .helper-calculation-result').focus();
        const detail = page.locator('[data-umbra-detail]');
        await detail.waitFor({ state: 'visible' });
        if (framed) {
          assert.match(await detail.locator('.helper-score-total').innerText(), /Total de l’entité/);
          assert.equal(Number((await detail.locator('.helper-score-total .helper-figure').innerText()).replace(/[^\d.\-]/g, '')), Math.round(values.points * 100) / 100);
          assert.equal(await detail.locator('.helper-total-sources').count(), 0, 'The balance hover contains the entity total and its effect only');
        }
        if (values.percent) {
          assert.doesNotMatch(await summary.locator('[data-umbra-section="total"]').innerText(), /%/);
          assert.match(await detail.locator('.helper-total-effect').innerText(), /%/);
          assert.equal(await detail.evaluate(node => node.querySelector('.helper-score-total').compareDocumentPosition(node.querySelector('.helper-total-effect')) & Node.DOCUMENT_POSITION_FOLLOWING), 4);
        }
      }
      const bounds = await card.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, key + ': horizontal bounds');
      if (framed) {
        assert.equal(await card.locator('.umbra-title-content > .picto-stat').evaluate((node, key) => node.classList.contains(key), key), true,
          'The main header uses its Umbra pictogram');
        assert.ok(bounds.width <= 400, 'Main helpers keep their compact width');
        if (summaryLast) await card.screenshot({ path: resolve(output, key + '-layout-' + width + '.png') });
        assert.ok(bounds.height < (['vision', 'criticalPower', 'robustness'].includes(key) ? 610 : 470), `${key}: compact height including the passive’s two-line formula (${bounds.height}px)`);
        assert.equal(await card.locator('[data-umbra-inline-detail]').first().evaluate(node => getComputedStyle(node).fontSize), '11.6px');
        const style = await card.evaluate(node => {
          const size = element => parseFloat(getComputedStyle(element).fontSize);
          const total = node.querySelector('.umbra-card-total');
          return { base: size(node), descriptions: [...node.querySelectorAll('.umbra-description, .short-descri, .umbra-detail-toggle, .helper-calculation-note')].map(size),
            totalLabel: size(node.querySelector('.umbra-card-total-label')),
            total: size(total.querySelector('.helper-calculation')), capacity: size(node.querySelector('[data-umbra-section="capacity"]')),
            firstName: size(node.querySelector('.short-descri [data-helper-effect]')),
            card: getComputedStyle(total, '::before').backgroundImage, opacity: getComputedStyle(total, '::before').opacity,
            borderOpacity: getComputedStyle(node, '::before').opacity,
            corner: getComputedStyle(node.querySelector('.umbra-card-corner')).backgroundImage,
            line: getComputedStyle(node.querySelector('.umbra-card-line')).backgroundImage };
        });
        for (const size of style.descriptions) assert.ok(Math.abs(size - style.base * .9) < .01, 'Description uses 0.9em');
        assert.ok(style.total <= 16.8 && style.total > 0);
        assert.ok(style.totalLabel <= style.base * .9 + .01 && style.totalLabel > 0);
        assert.equal(style.capacity, 14.5); assert.equal(style.firstName, style.base);
        assert.ok(style.card.includes('umbra-card-' + themes[key] + '.png'), key + ': card asset');
        assert.ok(style.line.includes('umbra-line-' + themes[key] + '.png'), key + ': line asset');
        assert.ok(style.corner.includes('umbra-corner-' + themes[key] + '.png'), key + ': corner asset');
        assert.equal(style.opacity, '0.9');
        assert.equal(style.borderOpacity, '0.4');
        assert.equal(await card.locator('.umbra-detail-check').count(), 0);
        for (const frame of await card.locator('.umbra-card-total').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))) {
          assert.deepEqual(frame, { width: 182, height: 42 }, 'All total frames have the same fixed compact size');
        }
        for (const fits of await card.locator('.umbra-card-total-content').evaluateAll(nodes => nodes.map(node => {
          const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
          const value = node.querySelector('.helper-figure').getBoundingClientRect();
          const labelNode = node.querySelector('.umbra-card-total-label');
          const range = document.createRange(); if (labelNode) range.selectNodeContents(labelNode);
          const label = labelNode ? range.getBoundingClientRect() : null;
          const fits = [value, label].filter(Boolean).every(content => content.left >= rect.left + parseFloat(css.paddingLeft) - 1
            && content.right <= rect.right - parseFloat(css.paddingRight) + 1 && content.top >= rect.top + parseFloat(css.paddingTop) - 1
            && content.bottom <= rect.bottom - parseFloat(css.paddingBottom) + 1);
          return { fits, rect: rect.toJSON(), value: value.toJSON(), label: label?.toJSON(), text: node.textContent };
        }))) assert.ok(fits.fits, `All content fits inside the fixed padded frame: ${JSON.stringify(fits)}`);
      }
      for (const ratio of await card.locator('[data-helper-ratio]').all()) {
        const value = await ratio.evaluate(node => ({ raw: Number(node.dataset.ratioValue), unit: node.dataset.ratioUnit }));
        assert.equal(await ratio.innerText(), value.raw.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + value.unit);
      }
      if (framed) {
        for (const selector of ['[data-umbra-section="total"] .helper-calculation-result', '[data-helper-ratio]', '[data-helper-picto-stat="' + attributes[key] + '"]']) {
          await card.locator(selector).first().focus();
          const detail = page.locator('[data-umbra-detail]');
          await detail.waitFor({ state: 'visible' });
          assert.deepEqual(await detail.evaluate(node => ({ decorated: node.classList.contains('umbra-helper-card'),
            background: getComputedStyle(node).backgroundImage, padding: getComputedStyle(node).padding,
            footer: getComputedStyle(node.querySelector('.stat-hover-footer')).display,
            ornaments: node.querySelectorAll('[data-umbra-layout="card"], .umbra-card-corner').length })),
            { decorated: false, background: 'none', padding: '12px', footer: 'block', ornaments: 0 });
        }
        await page.evaluate(() => document.activeElement?.blur());
        for (const result of await card.locator('[data-umbra-section="capacity"] .helper-calculation-result').all()) {
          await result.locator('.helper-figure > span:not(.picto-stat)').hover();
          assert.equal(await page.locator('[data-umbra-detail]').count(), 0, 'No verbose formula popup on the X result');
          assert.equal(await result.getAttribute('data-autonomous-calculation'), null);
        }
        const plain = await page.evaluate(key => audit.DDisplay.calculateStatsDisplay(key, audit.entity, undefined, { nestedHelper: true }).helpContent, key);
        assert.doesNotMatch(plain, /data-umbra-layout="card"|umbra-card-/, 'Nested Umbra content retains its ordinary presentation');
      }
      if (framed || ['haste', 'bloodFury'].includes(key)) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.mouse.move(2, 2);
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-umbra-pinned]')).opacity) >= .99);
        await card.screenshot({ path: resolve(output, key + '-' + width + '.png') });
        if (summaryLast) {
          const expandedWidth = (await card.boundingBox()).width;
          await card.locator('[data-umbra-detail-toggle]').first().click();
          assert.equal(await card.locator('[data-umbra-inline-detail]:visible').count(), 0);
          assert.equal((await card.boundingBox()).width, expandedWidth, 'Collapsing calculations preserves card width');
          await page.mouse.move(2, 2);
          await card.screenshot({ path: resolve(output, key + '-collapsed-' + width + '.png') });
          await card.locator('[data-umbra-detail-toggle]').last().click();
          assert.equal((await card.boundingBox()).width, expandedWidth, 'Opening calculations preserves card width');
          assert.equal(await card.locator('[data-umbra-inline-detail]:visible').count(), ['vision', 'criticalPower'].includes(key) ? 2 : 1);
          assert.equal(await card.locator('[data-umbra-detail-toggle][aria-expanded="true"]').count(), ['vision', 'criticalPower'].includes(key) ? 2 : 1);
        }
      }
    }
  }
  await page.evaluate(() => {
    audit.entity.baseStats.esprit = 1;
    audit.entity.baseStats.intelligence = 6;
    audit.entity.baseStats.magicalDamage = 6;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    audit.show('esprit');
  });
  const spiritCard = page.locator('[data-umbra-pinned]');
  assert.equal((await spiritCard.locator('[data-umbra-section="total"] .helper-calculation-result').innerText()).trim(), '+ 5', 'Esprit grants 1 direct point + 4 ratio points');
  await spiritCard.locator('[data-umbra-section="total"] .helper-calculation-result').focus();
  assert.match(await page.locator('[data-umbra-detail] .helper-score-total').innerText(), /Total de l’entité\s*:\s*11\s*$/);
  assert.equal(await page.locator('[data-umbra-detail] .helper-total-effect').count(), 0, 'A power stat has no extra percentage conversion');
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-umbra-detail]')).opacity) >= .99);
  await page.screenshot({ path: resolve(output, 'esprit-grant-5-total-11.png') });
  const ambientEditing = await page.evaluate(() => {
    const meta = audit.stats.find(stat => stat.key === 'esprit');
    const original = meta.ambiant;
    try {
      meta.ambiant = '';
      const empty = audit.DDisplay.calculateStatsDisplay('esprit', audit.entity).helpContent;
      meta.ambiant = 'Texte <personnalisé>\nDeuxième ligne.';
      const custom = audit.DDisplay.calculateStatsDisplay('esprit', audit.entity).helpContent;
      return { empty, custom };
    } finally { meta.ambiant = original; }
  });
  assert.doesNotMatch(ambientEditing.empty, /umbra-card-ambiance|data-umbra-section="rounding"/);
  assert.match(ambientEditing.custom, /Texte &lt;personnalisé&gt;<br>Deuxième ligne\./);
  await page.evaluate(() => {
    audit.entity.baseStats.esprit = 123456789012345;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    audit.show('esprit');
  });
  assert.equal(await spiritCard.locator('.umbra-card-total-content').evaluate(node => {
    const frame = node.closest('.umbra-card-total').getBoundingClientRect();
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    const figure = node.querySelector('.helper-figure').getBoundingClientRect();
    return frame.width === 182 && frame.height === 42
      && figure.left >= rect.left + parseFloat(css.paddingLeft) - 1
      && figure.right <= rect.right - parseFloat(css.paddingRight) + 1
      && figure.top >= rect.top + parseFloat(css.paddingTop) - 1
      && figure.bottom <= rect.bottom - parseFloat(css.paddingBottom) + 1;
  }), true, 'Huge signed grants fit the fixed frame with the label outside');
  await spiritCard.screenshot({ path: resolve(output, 'esprit-large-grant.png') });
  await page.evaluate(() => {
    audit.entity.baseStats.esprit = 1;
    audit.entity.baseStats.integrite = 3;
    audit.entity.baseStats.intelligence = 6;
    audit.entity.baseStats.magicalResistance = 50;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    audit.show('integrite');
  });
  const magicCard = page.locator('[data-umbra-pinned]');
  assert.equal((await magicCard.locator('[data-umbra-section="total"] .helper-calculation-result').innerText()).trim(), '+ 9');
  await magicCard.locator('[data-umbra-section="total"] .helper-calculation-result').focus();
  assert.match(await page.locator('[data-umbra-detail] .helper-total-effect').innerText(), /45.74 %/);
  assert.match(await page.locator('[data-umbra-detail] .helper-score-total').innerText(), /Total de l’entité\s*:\s*59\s*$/);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-umbra-detail]')).opacity) >= .99);
  await page.screenshot({ path: resolve(output, 'integrite-total-59.png') });
  await magicCard.locator('[data-umbra-section="capacity"] .picto-stat.magicalResistance').first().focus();
  const magicDescription = page.locator('[data-umbra-detail]');
  assert.match(await magicDescription.innerText(), /Ultime protection.*Intelligence et l’Intégrité/s);
  assert.doesNotMatch(await magicDescription.innerText(), /totale|59|45.74|%/);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-umbra-detail]')).opacity) >= .99);
  await page.screenshot({ path: resolve(output, 'integrite-capacity-description.png') });
  const descriptions = await page.evaluate(async () => {
    const H = await import('/js/data/helpers.js');
    return ['normal', '+', 'X'].map(state => H.buildStatDescriptionHelper('magicalResistance', state));
  });
  assert.match(descriptions[0], /Protection de base/);
  assert.match(descriptions[1], /Bonne protection.*Intelligence/s);
  assert.doesNotMatch(descriptions[1], /Intégrité/);
  assert.match(descriptions[2], /Ultime protection.*Intégrité/s);
  await page.evaluate(() => {
    audit.entity.baseStats.integrite = 123456789012345;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    const helper = document.querySelector('[data-umbra-pinned]');
    audit.UI.refreshStatHelper(helper, helper._helperHost, audit.entity);
  });
  const largeFit = await magicCard.locator('.umbra-card-total-content').evaluate(node => {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node), value = node.querySelector('.helper-figure').getBoundingClientRect();
    const frame = node.closest('.umbra-card-total').getBoundingClientRect();
    return frame.width === 182 && frame.height === 42 && value.left >= rect.left + parseFloat(css.paddingLeft) - 1
      && value.right <= rect.right - parseFloat(css.paddingRight) + 1 && value.bottom <= rect.bottom - parseFloat(css.paddingBottom) + 1;
  });
  assert.ok(largeFit, 'Even a very large total remains inside its padded frame');
  await page.evaluate(setup);
  await page.evaluate(() => {
    audit.entity.baseStats = { ...audit.entity.baseStats, finesse: 2, agility: 6, piercingDamage: 2 };
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    audit.show('finesse');
  });
  const gold = page.locator('.umbra-helper-card');
  const nestedFinesse = await page.evaluate(() => audit.DDisplay.calculateStatsDisplay('finesse', audit.entity, undefined, { nestedHelper: true }).helpContent);
  assert.doesNotMatch(nestedFinesse, /data-umbra-layout="card"|umbra-card-/,
    'Even Finesse itself keeps the ordinary layout when displayed as a nested helper');
  const readGoldValue = section => gold.locator(`[data-umbra-section="${section}"] .helper-calculation-result`).innerText().then(text => Number(text.replace(/[^\d.\-]/g, '')));
  assert.equal(await readGoldValue('capacity'), 5, 'The X line contains ratios only, excluding the direct gift');
  assert.equal(await readGoldValue('total'), 7, 'The card includes direct 2 + ratios 5, excluding the entity’s other 2 points');
  assert.equal(await gold.locator('[data-umbra-inline-detail] [data-helper-ratio]').count(), 2);
  await gold.screenshot({ path: resolve(output, 'finesse-grant-7-expanded.png') });
  const toggle = gold.locator('[data-umbra-detail-toggle]').first();
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await gold.locator('[data-umbra-inline-detail]').isVisible(), false);
  await page.mouse.move(2, 2);
  await gold.screenshot({ path: resolve(output, 'finesse-grant-7-collapsed.png') });
  await page.evaluate(() => audit.show('vision'));
  assert.equal(await page.locator('[data-umbra-inline-detail]:visible').count(), 0, 'The choice applies to other Umbra helpers');
  assert.equal(await page.locator('.umbra-helper-card').count(), 1, 'Vision shares the framed layout');
  assert.deepEqual(await page.locator('[data-umbra-detail-toggle]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-expanded'))), ['false', 'false']);
  await page.reload();
  await page.evaluate(setup);
  await page.evaluate(() => audit.show('finesse'));
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'The preference survives reload');
  assert.equal(await gold.locator('[data-umbra-inline-detail]').isVisible(), false);
  await toggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await gold.locator('[data-umbra-inline-detail]').isVisible(), true);
  for (const key of Object.keys(themes)) {
    await page.evaluate(setup);
    await page.evaluate(key => audit.show(key), key);
    for (const points of [0, 33, 151, 2000]) {
      const checks = await page.evaluate(({ key, points }) => {
        audit.entity.baseStats[key] = points;
        audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
        const helper = document.querySelector('[data-umbra-pinned]');
        audit.UI.refreshStatHelper(helper, helper._helperHost, audit.entity);
        return [...helper.querySelectorAll('[data-umbra-capacity], [data-umbra-passive]')]
          .filter(capacity => capacity.dataset.umbraPassive !== 'solarArmor').map(capacity => {
          if (capacity.dataset.umbraPassive) {
            const figure = capacity.querySelector('.helper-calculation-result');
            const model = helper._umbraCalculations[figure.dataset.umbraCalculation];
            const amount = Number(figure.textContent.replace(/[^\d.\-]/g, ''));
            const expected = capacity.dataset.umbraPassive==='criticalDamage' ? model.value : model.contributions.find(part=>part.kind==='umbra').value;
            return { total:amount,expectedTotal:expected,grant:amount,expectedGrant:expected };
          }
          const summary = helper.querySelector(`[data-umbra-summary-for="${capacity.dataset.umbraCapacity}"]`);
          const figure = section => (section === 'total' ? summary : capacity).querySelector(`[data-umbra-section="${section}"] .helper-calculation-result`);
          const model = helper._umbraCalculations[figure('total').dataset.umbraCalculation];
          return { total: Number(figure('total').textContent.replace(/[^\d.\-]/g, '')),
            expectedTotal: model.contributions.find(part => part.kind === 'umbra').value,
            grant: Number(figure('capacity').textContent.replace(/[^\d.\-]/g, '')), expectedGrant: model.system.conversion };
        });
      }, { key, points });
      for (const values of checks) {
        assert.equal(values.total, Math.round(values.expectedTotal * 100) / 100, `${key} ${points}: live total`);
        assert.equal(values.grant, Math.round(values.expectedGrant * 100) / 100, `${key} ${points}: live ratio gain`);
      }
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'Live refresh retains detail preference');
    }
  }
  await page.evaluate(setup);
  await page.evaluate(() => audit.show('haste'));
  assert.deepEqual(await page.locator('[data-umbra-capacity]').evaluateAll(nodes => nodes.map(n => n.dataset.umbraCapacity)),
    ['hastePreparation', 'hasteCDReduc', 'hasteExecutionReduc', 'hasteProjectilSpeed', 'hasteRecupReduc']);
  await page.evaluate(() => audit.show('vision'));
  await page.locator('[data-umbra-passive="bullsEye"] .helper-calculation-result').focus();
  assert.match(await page.locator('[data-umbra-detail]').innerText(), /Réduction du malus à distance/,
    'The second capacity shows its own statistical effect');
  await page.evaluate(() => {
    audit.entity.baseStats.vigueur = 33;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    audit.show('vigueur');
  });
  assert.match(await page.locator('[data-umbra-section="introduction"]').innerText(), /33/);
  const actualPower = await page.evaluate(() => audit.entity.stats.physicalDamage);
  const umbraPower = await page.evaluate(() => audit.DDisplay.calculateStatsDisplay('vigueur', audit.entity).umbraHelperCalculations.physicalDamageTotal.contributions.find(part => part.kind === 'umbra').value);
  assert.equal(Number((await page.locator('[data-umbra-section="total"] .helper-calculation-result').innerText()).replace(/[^\d.\-]/g, '')), umbraPower, 'The card excludes PP+ and fixed PP');
  await page.locator('[data-umbra-section="total"] .helper-calculation-result').focus();
  assert.equal(Number((await page.locator('[data-umbra-detail] .helper-score-total .helper-figure').innerText()).trim()), actualPower, 'The hover retains all entity sources');
  const armorTotal = await page.evaluate(() => {
    const armor = audit.entity.stats.armor;
    armor.stuffMax = (armor.stuffMax || 0) + 17;
    armor.totalMax = (armor.totalMax ?? armor.max) + 17;
    audit.show('robustness');
    return armor.totalMax;
  });
  await page.locator('.umbra-card-total .helper-calculation-result').hover();
  assert.ok((await page.locator('[data-umbra-detail]').innerText()).includes(String(armorTotal)),
    'Armor hover includes the separate equipment pool');
  for (const key of ['physicalDamage', 'criticalChance', 'armor', 'HP']) {
    await page.evaluate(key => audit.show(key), key);
    assert.equal(await page.locator('[data-umbra-pinned] [data-umbra-capacity]').count(), 0, `${key}: ordinary stat helper retains its presentation`);
    assert.match(await page.locator('[data-umbra-pinned] .umbra-description').innerText(), /^Statistique/);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => audit.show('vigueur'));
  const forceRatio = page.locator('[data-umbra-pinned] [data-helper-ratio][data-ratio-stat="strength"]').first();
  await forceRatio.hover();
  const preciseRatio = page.locator('[data-umbra-detail]');
  assert.equal(await preciseRatio.locator('.umbra-description').innerText(), 'Valeur du ratio de Force');
  const raw = Number(await forceRatio.getAttribute('data-ratio-value'));
  assert.equal(await preciseRatio.locator('.helper-figure').innerText(), raw.toLocaleString('fr-FR', { maximumFractionDigits: 4, useGrouping: false }));
  assert.match(await preciseRatio.innerText(), /Ratio réel avant arrondi au plus proche/);
  await forceRatio.focus();
  await page.evaluate(() => {
    audit.entity.baseStats.strength = 61;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
    const helper = document.querySelector('[data-umbra-pinned]');
    audit.UI.refreshStatHelper(helper, helper._helperHost, audit.entity);
  });
  const refreshedRaw = Number(await forceRatio.getAttribute('data-ratio-value'));
  assert.notEqual(refreshedRaw, raw);
  assert.equal(await preciseRatio.locator('.helper-figure').innerText(), refreshedRaw.toLocaleString('fr-FR', { maximumFractionDigits: 4, useGrouping: false }),
    'The focused ratio detail refreshes with the entity');
  const focusLayer = () => page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.Game-helper'), '::before');
    return { content: style.content, background: style.backgroundColor, pointerEvents: style.pointerEvents, zIndex: style.zIndex };
  });
  assert.deepEqual(await focusLayer(), { content: '""', background: 'rgba(0, 0, 0, 0.22)', pointerEvents: 'none', zIndex: '9' });
  await page.waitForFunction(() => ['[data-umbra-pinned]', '[data-umbra-detail]'].every(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return Number(style.opacity) >= .99 && Number(style.zIndex) > 9;
  }));
  await page.screenshot({ path: resolve(output, 'ratio-focus.png') });
  await page.evaluate(() => {
    window.outsideClicks = 0;
    const button = document.createElement('button'); button.id = 'outside-helper'; button.textContent = 'Action extérieure';
    button.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:100';
    button.onclick = () => outsideClicks++;
    document.body.append(button);
  });
  await page.locator('#outside-helper').click();
  assert.equal(await page.evaluate(() => outsideClicks), 1, 'The focus layer passes real clicks to the board');
  assert.equal(await page.locator('[data-umbra-pinned]').count(), 0);
  assert.equal((await focusLayer()).content, 'none', 'Clicking outside ends focus and removes its layer');
  await page.evaluate(() => audit.show('vigueur'));
  await page.keyboard.press('Escape');
  assert.equal((await focusLayer()).content, 'none', 'Escape removes the focus layer');
  await page.evaluate(() => {
    audit.show('vigueur');
    document.getElementById('audit').remove();
  });
  await page.waitForFunction(() => !document.querySelector('[data-umbra-pinned]'));
  assert.equal((await focusLayer()).content, 'none', 'Closing the Codex removes the focus layer');
  await page.evaluate(setup);
  await page.evaluate(() => {
    audit.entity.baseStats.vision = 81; audit.entity.baseStats.agility = 6;
    audit.E.recomputeEntityStats(audit.entity, { equippedItems: [], persistEquipment: false, skipReverseArchetype: true });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => audit.show('vision'));
    const card = page.locator('[data-umbra-pinned]');
    const toggle = card.locator('[data-umbra-detail-toggle]').first();
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-umbra-pinned]')).opacity) >= .99);
    await card.screenshot({ path: resolve(output, `vision-fixed-collapsed-${width}.png`) });
    assert.ok((await card.boundingBox()).height < 520, 'Vision stays compact with both summaries and its lore');
    assert.deepEqual(await card.locator('.umbra-card-total').evaluateAll(nodes => nodes.map(node => [node.offsetWidth, node.offsetHeight])), [[182,42]]);
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${keys.length} Umbras; Umbra grants in fixed cards, entity totals then effects on hover, Umbra header icons, nearest-rounding ratios, desktop/mobile and zero/overflow refresh.`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
