import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateHpDamage, finalizeHpDamage, calculateHpHealing, calculateFullHpRestoration,
  calculateDamageAccounting, calculateArmorBypass, calculateArmorGate, calculateResilienceSources,
  calculateEsoterismSources, calculateFragilitySources, calculateDefensiveHpTotal } from '../docs/js/combat/vitalRules.js';
import { calculateArmorConsumption, calculateArmorAggregate, composeStuffArmorLayer } from '../docs/js/combat/armorRules.js';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const sources = changes => ({ piercingDamage: 0, physical: 0, magical: 0, hybridalDamage: 0, ...changes });
const pool = current => ({ current, max: current });
const layers = () => ({ consumable: pool(3), spell: pool(5), external: pool(7), robustness: pool(11),
  stuff: { e1: composeStuffArmorLayer(pool(2)), e2: composeStuffArmorLayer(pool(4)) } });

test('vital arithmetic needs no browser or implicit random draw', () => {
  assert.equal(typeof document, 'undefined');
  const original = Math.random;
  try {
    Math.random = () => { throw Error('The orchestrator owns chance'); };
    assert.equal(calculateHpDamage(30, 11, 50).hpAfter, 24);
    assert.equal(calculateDefensiveHpTotal(sources({ physical: 10 }), { critical: true, criticalBonus: 50 }), 15);
    assert.equal(calculateArmorConsumption(freeze(layers()), ['e1', 'e2'], 32, 10).outcome.absorbed, 10);
  } finally { Math.random = original; }
});

test('HP damage rounds after reduction, caps the loss and leaves survival to the caller', () => {
  const hit = freeze(calculateHpDamage(7, 40, 25));
  assert.equal(hit.finalDamage, 30); assert.equal(hit.hpAfter, 0); assert.equal(hit.hpLoss, 7);
  assert.equal(finalizeHpDamage(hit, 1).hpLoss, 6);
  assert.equal(hit.hpAfter, 0);
  assert.equal(calculateHpDamage(20, 1, 50).hpLoss, 1);
  assert.equal(calculateHpDamage(20, 99, 100).hpLoss, 0);
  assert.equal(calculateHpDamage(20, -10).hpAfter, 20);
});

test('healing is capped against the current HP when its deferred callback runs', () => {
  assert.equal(calculateHpHealing(90, 100, 30).healedHP, 10);
  assert.equal(calculateHpHealing(60, 100, 30).healedHP, 30);
  assert.equal(calculateHpHealing(100, 100, 30).healedHP, 0);
  assert.equal(calculateHpHealing(60, 100, -30).hpAfter, 60);
  assert.deepEqual(calculateFullHpRestoration('30', '100'), { hpBefore: 30, hpAfter: 100, healedHP: 70 });
});

test('credited damage excludes overkill and separates armor from critical HP loss', () => {
  const input = freeze({ hpBefore: 20, hpAfter: 0, armorBefore: 7, armorAfter: 0,
    finalDamage: 50, damageBeforeCritical: 15, indestructibility: 0, critical: true, astrality: false });
  assert.deepEqual(calculateDamageAccounting(input), { damageApplied: 20, armorDamageApplied: 7,
    damageCredited: 27, criticalBonusCredited: 5, overkillDamage: 30 });
  const survived = calculateDamageAccounting({ ...input, hpAfter: 1, astrality: true });
  assert.equal(survived.damageCredited, 26); assert.equal(survived.criticalBonusCredited, 4);
});

test('armor consumption follows consumable, equipped order, spell, natural, robustness', () => {
  const input = freeze(layers());
  const result = calculateArmorConsumption(input, ['e1', 'e2'], 32, 16);
  assert.deepEqual(result.outcome.layers, { consumable: 3, spell: 5, natural: 2, external: 10, stuff: 6, robustness: 0 });
  assert.equal(result.armor.current, 16); assert.equal(result.armor.max, 11);
  assert.equal(input.external.current, 7);
  assert.deepEqual(calculateArmorConsumption(input, ['e2', 'e1'], 32, 5).outcome.stuffDamage, { e2: 2 });
  const overflow = calculateArmorConsumption(input, ['e1', 'e2'], 32, 40);
  assert.equal(overflow.outcome.absorbed, 32); assert.equal(overflow.outcome.remainingDamage, 8);
});

test('equipment keeps its fractional reserve through repeated boosted-armor impacts', () => {
  let state = { consumable: pool(0), spell: pool(0), external: pool(0), robustness: pool(0),
    stuff: { e1: composeStuffArmorLayer(pool(3), 100) } };
  for (let i = 0; i < 4; i++) {
    const result = calculateArmorConsumption(freeze(state), ['e1'], 6, .5);
    assert.equal(result.outcome.absorbed, .5);
    state = result.layers;
  }
  assert.equal(state.stuff.e1.reserve.preciseCurrent, 2);
  assert.equal(state.stuff.e1.current, 4);
  assert.equal(calculateArmorAggregate(freeze(state)).armor.current, 4);
});

test('empty armor has no aggregate and lets all damage pass', () => {
  const empty = freeze({ consumable: pool(0), spell: pool(0), external: pool(0), robustness: pool(0), stuff: {} });
  const result = calculateArmorConsumption(empty, [], 0, 9);
  assert.equal(result.armor, null); assert.equal(result.outcome.remainingDamage, 9);
});

test('pure piercing bypass is reintroduced after armor and mixed sources do not bypass', () => {
  const flags = freeze({ canBypassArmorGate: true, armorBypassPercent: 25 });
  const input = freeze(sources({ piercingDamage: 40 }));
  assert.equal(calculateArmorBypass(input, flags), 10);
  assert.equal(calculateArmorBypass(sources({ piercingDamage: 40, physical: 1 }), flags), 0);
  assert.deepEqual(calculateArmorGate(input, 40, 0, 10).sources, sources({ piercingDamage: 10 }));
  assert.equal(input.piercingDamage, 40);
});

test('armor gate preserves per-channel rounding and bypass-only attacks', () => {
  const input = freeze(sources({ physical: 1, magical: 1 }));
  assert.deepEqual(calculateArmorGate(input, 2, 1).sources, input);
  assert.equal(calculateArmorGate(input, 2, 1).rawTotal, 2);
  assert.deepEqual(calculateArmorGate(input, 2, 0).sources, sources());
  assert.equal(calculateArmorGate(sources({ piercingDamage: 4 }), 4, 0, 4).rawTotal, 4);
});

test('DoT rounding carries fractions across ticks without mutating the supplied carry', () => {
  let carry = { physical: 0, magical: .2 }, total = 0;
  for (let i = 0; i < 10; i++) {
    const input = freeze(carry);
    const result = calculateResilienceSources(freeze(sources({ physical: 1 })), 30, input);
    total += result.sources.physical;
    assert.equal(result.carry.magical, .2);
    carry = result.carry;
  }
  assert.equal(total, 7); assert.ok(Math.abs(carry.physical) < 1e-10);
});

test('esoterism affects the magical half of hybrid damage before fragility and critical defense', () => {
  const input = freeze(sources({ physical: 10, magical: 5, hybridalDamage: 5, piercingDamage: 2 }));
  const reduced = calculateEsoterismSources(input, 50);
  assert.deepEqual(reduced, sources({ physical: 10, magical: 3, hybridalDamage: 5, piercingDamage: 2 }));
  assert.equal(calculateFragilitySources(freeze(reduced), 50).magical, 5);
  assert.equal(calculateDefensiveHpTotal(sources({ physical: 100 }), {
    critical: true, criticalBonus: 50, resilienceCrit: 50, indestructibility: 20,
  }), 100);
});
