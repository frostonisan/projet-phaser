import assert from 'node:assert/strict';
import test from 'node:test';
import { DAMAGE_SOURCE_KEYS, splitDamageByNature, roundAttackDamageSources, buildScaledDamageSources,
  reduceCriticalSupplement, resolveCriticalDamage, calculateDamageComposition } from '../docs/js/combat/damageRules.js';
const sources = changes => ({ piercingDamage: 0, physical: 0, magical: 0, hybridalDamage: 0, ...changes });
const sum = values => DAMAGE_SOURCE_KEYS.reduce((n, key) => n + values[key], 0);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const input = changes => ({ attack: { attacknature: ['physicalDamage'] },
  natureRules: { key: 'red', natures: ['physicalDamage'], colors: ['red'], isInert: false,
    profile: { red: 1, blue: 0, yellow: 0, total: 1 } }, flags: {}, physicalDamageBase: 20,
  magicalDamageBase: 10, piercingDamageBase: 4, physicalBase: 20, magicalBase: 10, agility: 0,
  transpiercingBonus: 0, hypercognitionBonus: 0, powerRatios: { physical: 1, magical: 1, piercing: 1 },
  resonance: { bonus: 0 }, inertRatioReductionPercent: 50, ...changes });

test('damage rules work with no browser or implicit random draw', () => {
  assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  const original = Math.random;
  try {
    Math.random = () => { throw Error('The caller owns randomness'); };
    assert.equal(calculateDamageComposition(input()).sources.physical, 34);
    assert.deepEqual(resolveCriticalDamage(100, 25, 50, 24), { isCritical: true, finalDamage: 150 });
  } finally { Math.random = original; }
});

test('nature chooses damage channels independently of the contributing powers', () => {
  const hybrid = { key: 'hybrid', profile: { red: 1, blue: 1, yellow: 0, total: 2 } };
  assert.deepEqual(splitDamageByNature(hybrid, 9), sources({ hybridalDamage: 9 }));
  assert.deepEqual(splitDamageByNature({ key: 'none', profile: { total: 0 } }, 9), sources({ physical: 9 }));
  const prism = { key: 'prism', profile: { red: 1, blue: 2, yellow: 1, total: 4 } };
  assert.deepEqual(splitDamageByNature(prism, 20), sources({ physical: 5, magical: 10, piercingDamage: 5 }));
  assert.deepEqual(splitDamageByNature(hybrid, -5), sources());
});

test('rounding floors the total once and preserves a stable residual order', () => {
  assert.deepEqual(roundAttackDamageSources({ physical: 2.6, magical: 3.6 }), sources({ physical: 3, magical: 3 }));
  assert.deepEqual(roundAttackDamageSources({ physical: 2.9, magical: 3.2, piercingDamage: 1.8 }), sources({ physical: 3, magical: 3, piercingDamage: 1 }));
  assert.equal(sum(roundAttackDamageSources({ physical: 19.999999999999996 })), 20);
  assert.deepEqual(roundAttackDamageSources({ physical: -2, magical: NaN, piercingDamage: Infinity }), sources());
});

test('secondary attacks keep their target total, distribution and input data', () => {
  const original = freeze(sources({ physical: 3, magical: 1 }));
  assert.deepEqual(buildScaledDamageSources(original, 7), sources({ physical: 5, magical: 2 }));
  assert.deepEqual(buildScaledDamageSources(original, 0), sources());
  assert.deepEqual(buildScaledDamageSources({}, 5), sources({ physical: 5 }));
  assert.equal(sum(original), 4);
});

test('critical chance is strict and critical resistance only removes the supplement', () => {
  assert.deepEqual(resolveCriticalDamage(100, 25, 50, 25), { isCritical: false, finalDamage: 100 });
  assert.deepEqual(resolveCriticalDamage(19, 100, 50, 0), { isCritical: true, finalDamage: 29 });
  assert.deepEqual(resolveCriticalDamage(19.5, 0, 50, 0), { isCritical: false, finalDamage: 19.5 });
  assert.equal(reduceCriticalSupplement(150, 100, 50), 125);
  assert.equal(reduceCriticalSupplement(150, 100, 1000), 100);
  assert.equal(reduceCriticalSupplement(150, 100, -10), 150);
});

test('flat contributions are not multiplied by attack ratios', () => {
  const result = calculateDamageComposition(freeze(input({
    powerRatios: { physical: 2, magical: 0, piercing: 0 },
    transpiercingBonus: 7, hypercognitionBonus: 11, flags: { isTranspiercing: true },
  })));
  assert.equal(result.sources.physical, 58);
  assert.deepEqual(result.details.powerSources, { physical: 40, magical: 0, piercing: 0,
    resonance: 0, transpiercing: 7, hypercognition: 11 });
});

test('inert ratio reduction leaves flat contributions intact', () => {
  const base = input();
  const result = calculateDamageComposition(freeze(input({ natureRules: { ...base.natureRules, key: 'none',
    isInert: true, colors: [], profile: { red: 0, blue: 0, yellow: 0, total: 0 } }, hypercognitionBonus: 7 })));
  assert.equal(result.sources.physical, 24);
  assert.deepEqual(result.details.ratios, { physicalRatio: .5, magicalRatio: .5, piercingRatio: .5 });
});

test('resonance is counted once even when no physical or magical ratio is used', () => {
  const base = input();
  const natureRules = { ...base.natureRules, key: 'hybrid', colors: ['red', 'blue'], natures: ['hybridalDamage'],
    profile: { red: 1, blue: 1, yellow: 0, total: 2 } };
  const result = calculateDamageComposition(freeze(input({ natureRules, resonance: { bonus: 6 },
    powerRatios: { physical: 0, magical: 0, piercing: 1 } })));
  assert.equal(result.sources.hybridalDamage, 10);
  assert.equal(result.details.hybridal.physicalPart, 5);
  assert.equal(result.details.hybridal.magicalPart, 5);
  const withRatios = calculateDamageComposition(input({ natureRules, resonance: { bonus: 6 } }));
  assert.equal(withRatios.sources.hybridalDamage, 40);
  assert.equal(withRatios.details.powerSources.resonance, 0);
});
