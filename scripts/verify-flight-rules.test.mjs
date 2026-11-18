
import assert from 'node:assert/strict';
import test from 'node:test';
import { flightModeFromFlags, flightRemnantFromFlags, sampleFlightState, isFlightCancelled, resolveFlightSources } from '../docs/js/combat/flightRules.js';
import { cloneCombatSnapshot } from '../docs/js/combat/snapshot.js';

const state = mode => ({ mode, casterLost: false, guidanceLost: false, targetMoved: false,
  aimedHex: 'cell-1', lockedHex: mode === 'physical' ? 'cell-1' : null });
const facts = changes => ({ casterAlive: true, casterDeathPending: false, targetIsHex: false, targetHex: 'cell-1', ...changes });

test('flight rules load and run without browser globals', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  for (const [expected, flags] of [
    ['melee', {}],
    ['physical', { isRange: true, hasPhysical: true, hasPhysicalBehavior: true }],
    ['magical', { isRange: true, hasMagicalBehavior: true }],
    ['mixed', { isRange: true, hasHybridal: true, hasPhysicalBehavior: true, hasMagicalBehavior: true }],
    ['physical', { isRange: true, hasPhysical: true, hasPhysicalBehavior: true, hasPiercing: true }],
    ['mixed', { isRange: true, hasPhysicalBehavior: true, hasMagicalBehavior: true, hasPiercing: true }],
    ['triple', { isRange: true, hasHybridal: true, hasPhysicalBehavior: true, hasMagicalBehavior: true, hasPiercing: true }],
  ]) assert.equal(flightModeFromFlags(flags), expected);
  assert.equal(flightRemnantFromFlags('mixed', { hasPiercing: true }), 'piercing');
  assert.equal(flightRemnantFromFlags('mixed', { hasHybridal: true }), 'physical');
  assert.equal(flightRemnantFromFlags('triple', { hasHybridal: true, hasPiercing: true }), null);
});

test('simultaneous healing and additional lives preserve guidance through provisional zero HP', () => {
  const flight = state('mixed');
  const pending = sampleFlightState(flight, facts({ casterAlive: false, casterDeathPending: true, targetHex: 'cell-2' }));
  assert.equal(pending.casterLost, false);
  assert.equal(pending.guidanceLost, false);
  assert.equal(pending.lockedHex, null);
  assert.deepEqual(flight, state('mixed'), 'Sampling has no mutation side effect');
  const rescued = sampleFlightState({ ...flight, ...pending }, facts({ targetHex: 'cell-3' }));
  assert.equal(rescued.casterJustLost, false);
  assert.equal(rescued.guidanceLost, false);
});

test('mixed flights lock at the confirmed death position and never reacquire guidance', () => {
  const flight = state('mixed');
  const lost = sampleFlightState(flight, facts({ casterAlive: false, targetHex: 'cell-2' }));
  assert.equal(lost.casterJustLost, true);
  assert.equal(lost.lockedHex, 'cell-2');
  assert.equal(lost.aimedHex, 'cell-2');
  assert.equal(lost.targetMoved, false);
  const later = sampleFlightState({ ...flight, ...lost }, facts({ targetHex: 'cell-3' }));
  assert.equal(later.casterJustLost, false);
  assert.equal(later.casterLost, true);
  assert.equal(later.lockedHex, 'cell-2');
  assert.equal(later.targetMoved, true);
});

test('physical flights retain their aimed cell and remember a move followed by a return', () => {
  const initial = state('physical');
  const moved = sampleFlightState(initial, facts({ targetHex: 'cell-2' }));
  const returned = sampleFlightState({ ...initial, ...moved }, facts());
  assert.equal(returned.lockedHex, 'cell-1');
  assert.equal(returned.targetMoved, true);
  const cellTarget = sampleFlightState(initial, facts({ targetIsHex: true, targetHex: 'cell-2' }));
  assert.equal(cellTarget.targetMoved, false, 'Targeting a cell is not an entity avoidance');
});

test('caster death cancels magical and melee flights; expired battles cancel every mode', () => {
  for (const mode of ['physical', 'magical', 'melee', 'mixed', 'triple']) {
    assert.equal(isFlightCancelled({ mode, casterLost: true }, false), ['magical', 'melee'].includes(mode));
    assert.equal(isFlightCancelled({ mode, casterLost: false }, true), true);
  }
});

test('losing hybrid guidance removes only the magical damage share', () => {
  const sources = Object.freeze({ physical: 10, magical: 30, hybridalDamage: 40, piercingDamage: 5 });
  assert.deepEqual(resolveFlightSources({ mode: 'mixed', casterLost: true, sources }),
    { physical: 30, magical: 0, hybridalDamage: 0, piercingDamage: 5 });
  for (const options of [{ mode: 'mixed', casterLost: false }, { mode: 'triple', casterLost: true }]) {
    const result = resolveFlightSources({ ...options, sources });
    assert.deepEqual(result, sources);
    assert.notEqual(result, sources);
  }
});

test('launch snapshots isolate nested data and preserve shared references and dates', () => {
  const shared = { amount: 12 };
  const source = { first: shared, second: shared, created: new Date('2026-01-01T00:00:00Z') };
  source.self = source;
  const copy = cloneCombatSnapshot(source);
  assert.notEqual(copy.first, shared);
  assert.equal(copy.first, copy.second);
  assert.equal(copy.self, copy);
  assert.equal(copy.created.getTime(), source.created.getTime());
  assert.notEqual(copy.created, source.created);
  shared.amount = 99;
  assert.equal(copy.first.amount, 12);
});
