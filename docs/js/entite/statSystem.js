import { balanceData as B, roundBalance } from '../data/balanceData.js';
import { stats as STATS_DATA } from '../data/statsData.js';
import * as D from '../damagesCalcul.js';
import * as E from '../entites.js';
import { calculatePenetrationPercent, calculateResistanceReductionPercent, getDisplayStatKey } from './entityRules.js';
import { calculateHypercognitionEssenceCount } from '../essenceInventory.js';

// The existing entity catalogue is enriched while its module graph initializes.
// Runtime source reads start once those numerical modules have finished loading.
var statSystemReady;

// Reuse reads only within one synchronous, read-only display calculation.
// Nothing survives the call: edits, previews and live balance settings stay fresh.
let displayReadCache = null;
export function withStatDisplayReads(read) {
  if (displayReadCache) return read();
  displayReadCache = new WeakMap();
  try { return read(); }
  finally { displayReadCache = null; }
}
function statDisplayRead(entity) {
  if (!displayReadCache || !entity || typeof entity !== 'object') return null;
  let entry = displayReadCache.get(entity);
  if (!entry) {
    entry = { inputs: E.getStatSystemInputs(entity), results: new Map() };
    displayReadCache.set(entity, entry);
  }
  return entry;
}

export const STAT_SYSTEM_ORIGINS = Object.freeze({
  physicalDamage: 'vigueur', magicalDamage: 'esprit', piercingDamage: 'finesse',
  physicalPen: 'brutality', magicalPen: 'inflexion', physicalResistance: 'constitution',
  magicalResistance: 'integrite', dodge: 'adresse', velocity: 'vivacite', precision: 'vision', bullsEye: 'vision',
  controlledSpeed: 'vivacite', fatalSurvival: 'astrality', astralBody: 'astrality',
  armor: 'robustness', HP: 'vitality', dayHpRegen: 'vitality',
  cognitiveExplosion: 'hypercognition', cognitiveGenerator: 'hypercognition',
  extraLife: 'transcendence', transcendenceTotal: 'transcendence',
  criticalChance: 'criticalPower', criticalDamage: 'criticalPower',
  criticalResistance: 'resilience', alterationResistance: 'resilience', hindranceResistance: 'resilience', resilienceTotal: 'resilience',
  equilibreAggroReduction: 'equilibre', equilibreInvisibleDetection: 'equilibre', equilibreBalancedAttackChance: 'equilibre',
  bloodFuryExecutionChance: 'bloodFury', bloodFuryTargetThreshold: 'bloodFury',
  bloodFuryExecutionDamage: 'bloodFury', bloodThirsty: 'bloodFury',
  hpBattleRegen: 'indestructibility', attackCooldownReduc: 'haste',
  attackPreparationReduc: 'haste', attackExecutionReduc: 'haste',
  attackRecoveryReduc: 'haste', attackProjectileSpeed: 'haste',
  shift: 'movement', marathon: 'movement', trailer: 'movement',
  charge: 'weaponMastery', weaponOrfevre: 'weaponMastery', weaponCollector: 'weaponMastery',
});

const percentages = new Set(['physicalPen', 'magicalPen', 'physicalResistance', 'magicalResistance',
  'dodge', 'velocity', 'controlledSpeed', 'fatalSurvival', 'astralBody', 'transcendenceTotal', 'criticalChance', 'criticalDamage',
  'criticalResistance', 'alterationResistance', 'hindranceResistance', 'resilienceTotal',
  'equilibreAggroReduction', 'equilibreInvisibleDetection', 'equilibreBalancedAttackChance',
  'bloodFuryExecutionChance', 'bloodFuryTargetThreshold', 'bloodThirsty', 'hpBattleRegen',
  'attackCooldownReduc', 'attackPreparationReduc', 'attackExecutionReduc', 'attackRecoveryReduc',
  'attackProjectileSpeed', 'marathon', 'trailer', 'weaponOrfevre', 'weaponCollector']);
function capacity(value) { return Number(value?.max ?? value?.current ?? value) || 0; }
function round(value) { return roundBalance(value, 6); }
const clamp = (value, maximum = Infinity, minimum = 0) => Math.max(minimum, Math.min(maximum, value));
const term = (stat, value, detail = {}) => ({ stat, value, ...detail });
const product = (ctx, stat, coefficient, rounding = value => value) => term(stat,
  rounding(ctx.read(stat) * coefficient), { rounded: true,
    compact: { source: { stat, value: ctx.read(stat) }, multiplier: { stat, value: coefficient } } });

// Source metadata travels with a calculation, never into the entity save.
export const STAT_POINT_INPUTS = Symbol('stat-point-inputs');
export function isStatSystemReady() { return !!statSystemReady; }
export function getProgressiveStatKeys() {
  return globalThis.umbraProgression.getProgressiveStatKeys();
}
// Toutes les Umbras du catalogue partagent le seuil de leur propriétaire.
// Les attributs gardent leur réglage d'acquisition actuel.
var umbraStatKeys;
function getUmbraStatKeys() {
  return umbraStatKeys ??= new Set(STATS_DATA.filter(stat => stat.nature === 'umbra').map(stat => stat.key));
}
export function getPointLimitedStatKeys() {
  return [...new Set([...getProgressiveStatKeys(), ...getUmbraStatKeys()])];
}
export function getUmbraThreshold(entity) {
  return globalThis.umbraProgression.getUmbraThreshold(entity);
}
export function getStatPointThreshold(entity, key) {
  return getUmbraStatKeys().has(key) ? getUmbraThreshold(entity) : B.generatedUmbraStats.progression.limit;
}
export function calculateProgressivePower(source, attribute, cfg, origin) {
  return globalThis.umbraProgression.calculateProgressivePower(source, attribute, cfg, origin);
}
export function calculateStatPointLimit(natural, other = 0, crystal = 0, threshold) {
  return globalThis.umbraProgression.calculateStatPointLimit(natural, other, crystal, threshold);
}
// Reuse the formatter: constructing an Intl formatter for every number dominates
// repeated stat/preview calculations. This holds no entity or balance data.
var statPointNumberFormatter;
export function describeStatPointLimit(points) {
  if (points?.limit == null) return '';
  statPointNumberFormatter ??= new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 });
  const f = n => statPointNumberFormatter.format(Number(n.toFixed(6)));
  return `Seuil ${f(points.limit)} : naturels ${f(points.natural)} → ${f(points.naturalApplied)}, `
    + `bonus externes ${f(points.other)} → ${f(points.otherApplied)}${points.crystal ? `, cristaux ${f(points.crystal)} → ${f(points.crystalApplied)}` : ''} ; total ${f(points.value)} points. `
    + `Au-delà : niveaux ${f(points.levelRate * 100)} %, équipements et buffs ${f(points.otherRate * 100)} %. Cristaux ${f(points.crystalRate * 100)} %.`;
}
export function getProgressiveRatio(points, stat) {
  return globalThis.umbraProgression.getProgressiveRatio(points, stat);
}
function progressivePowerPart(stat, points, base, enabled = true) {
  return globalThis.umbraProgression.progressivePowerPart(stat, points, base, enabled);
}

export function getDirectingStatResult(entity, key) {
  if (!statSystemReady || !entity?.baseStats || entity._statSystemFormula || !getPointLimitedStatKeys().includes(key)) return null;
  const inputs = statDisplayRead(entity)?.inputs || E.getStatSystemInputs(entity);
  if (!Object.hasOwn(inputs, key)) return null;
  return { ...inputs[STAT_POINT_INPUTS]?.[key], value: capacity(inputs[key]) };
}

// Definitions call the existing barèmes. Only source pooling is new.
function makeRules() {
  const rules = new Map();
  const add = (key, rule) => rules.set(key, rule);
  for (const [origin, cfg] of Object.entries(B.generatedUmbraStats.sources)) {
    if (cfg.ratioPercent) { add(cfg.target, { ratioPercent: true, attribute: cfg.attribute, vivacite: true }); continue; }
    if (cfg.progressive) {
      add(cfg.target, {
        base: c => progressivePowerPart(origin, c.umbra, cfg.ratios.source).value,
        bonus: c => [progressivePowerPart(cfg.attribute, c.read(cfg.attribute), cfg.ratios.attribute, c.umbra > 0)],
        flat: c => c.umbra * cfg.flatPerPoint, finish: round, sharedFlat: true, progressive: cfg,
      });
      continue;
    }
    const convert = ({
      physicalPen: value => calculatePenetrationPercent(null, 'physicalPen', value),
      magicalPen: value => calculatePenetrationPercent(null, 'magicalPen', value),
      physicalResistance: calculateResistanceReductionPercent,
      magicalResistance: calculateResistanceReductionPercent,
      dodge: E.calculateDodgePercent,
    })[cfg.target];
    add(cfg.target, { base: c => c.umbra * cfg.ratios.source,
      bonus: c => [product(c, cfg.attribute, cfg.ratios.attribute)],
      convert: convert && (value => convert(roundBalance(value, cfg.decimals))),
      finish: value => roundBalance(value, convert ? 6 : cfg.decimals),
      max: convert ? 100 : Infinity,
      sourceRatio: cfg.ratios.source, sharedFlat: true });
  }
  add('bullsEye', { directPercentage: true });
  add('HP', { base: c => E.calculateVitalityBonus(c.umbra), finish: Math.ceil });
  add('dayHpRegen', { fixed: B.regeneration.vitalityDayHp.minTotalBaseAmount,
    bonus: c => [product(c, 'HP', D.calculateVitalityRegenPercent(c.umbra) / 100, Math.round)], finish: Math.floor });
  add('cognitiveExplosion', { base: c => c.umbra,
    bonus: c => [product(c, 'intelligence', D.calculateHypercognitionRatio(c.umbra + c.plus))], finish: Math.round });
  add('cognitiveGenerator', { base: c => calculateHypercognitionEssenceCount(c.umbra), finish: Math.floor,
    finishTotal: Math.floor, max: B.hypercognition.essences.maxCount });
  add('extraLife', { base: c => E.calculateTranscendenceExtraLife(c.umbra), finish: Math.floor });
  add('transcendenceTotal', { base: c => D.transcendenceConsoProtection(c.umbra),
    bonus: c => [term('intelligence', D.transcendenceConsoIntel(c.view))], max: 100 });
  add('fatalSurvival', { ratioPercent: true, attribute: 'intelligence', astrality: true });
  add('astralBody', { ratioPercent: true, attribute: 'intelligence', astrality: true });
  add('criticalChance', { critical: true });
  add('criticalDamage', { critical: true });
  add('criticalResistance', { ratioPercent: true, attribute: 'strength' });
  add('alterationResistance', { ratioPercent: true, attribute: 'intelligence' });
  add('hindranceResistance', { ratioPercent: true, attribute: 'agility' });
  add('resilienceTotal', { directPercentage: true });
  add('controlledSpeed', { directPercentage: true, requiresUmbra: true });
  add('equilibreAggroReduction', { ratioPercent: true, attribute: 'intelligence', equilibre: true });
  add('equilibreInvisibleDetection', { ratioPercent: true, attribute: 'agility', equilibre: true });
  add('equilibreBalancedAttackChance', { directPercentage: true });
  add('bloodFuryExecutionChance', { base: c => D.calculateBloodFuryBFtRatio(c.umbra),
    bonus: c => [product(c, 'strength', B.blood.furyExecution.strengthChancePerPoint, v => Math.ceil(v * 100) / 100)], max: 100, finish: v => roundBalance(v, 1) });
  add('bloodFuryTargetThreshold', { fixed: B.blood.furyExecution.targetThresholdPercent, max: 100 });
  add('bloodFuryExecutionDamage', { bonus: c => [product(c, 'physicalDamage', B.blood.furyExecution.damageMultiplier
    * D.calculateBloodFuryExecutionSRatio(D.calculateBloodFuryExecStrengthRatio(c.read('strength'))) / 100)], finish: Math.ceil });
  add('bloodThirsty', { fixed: B.blood.thirsty.flatPercent, base: c => D.calculateBloodThirstyBFRatio(c.umbra),
    bonus: c => [product(c, 'strength', B.blood.thirsty.strengthMaxPercent / B.blood.thirsty.strengthCap, Math.round)] });
  add('hpBattleRegen', { base: c => D.calculateHpBattleRegenIndestructibilityRatio(c.view),
    bonus: c => [term('strength', Math.round(Math.min(c.read('strength'), B.regeneration.battleHp.strengthCap)
      * B.regeneration.battleHp.strengthMaxPercent / B.regeneration.battleHp.strengthCap))], finish: Math.round });
  for (const [key, attribute, fn] of [
    ['attackCooldownReduc', 'intelligence', 'calculateHasteCDReduc'],
    ['attackPreparationReduc', 'intelligence', 'calculateHasteIntelRatio'],
    ['attackExecutionReduc', 'strength', 'calculateHasteExecReduc'],
    ['attackRecoveryReduc', 'agility', 'calculateHasteRecupReduc'],
    ['attackProjectileSpeed', 'strength', 'calculateHasteProjectilSpeed'],
  ]) add(key, { base: c => key === 'attackPreparationReduc' ? E.calculateHastePercent(c.umbra) : 0,
    bonus: c => {
      const cfg = B.attackTime.hasteRatios;
      const value = D[fn]({ ...c.view, stats: { ...c.view.stats, haste: Math.max(1, c.umbra) } });
      const maximum = ({ attackCooldownReduc: cfg.intelligenceCooldownMaxPercent, attackPreparationReduc: cfg.intelligencePrepMaxPercent,
        attackExecutionReduc: cfg.strengthExecutionMaxPercent, attackRecoveryReduc: cfg.agilityRecoveryMaxPercent })[key];
      return [term(attribute, value, maximum != null && c.read(attribute) <= cfg.statCap
        ? { compact: { source: { stat: attribute, value: c.read(attribute) }, multiplier: { stat: attribute, value: maximum / cfg.statCap } } } : {})];
    },
    max: B.attackTime.reductionCapPercent, finish: v => roundBalance(v, 1) });
  add('shift', { base: c => Math.floor(c.umbra), finish: Math.floor });
  add('marathon', { fixed: B.movement.charges.marathonBasePercent,
    bonus: c => [product(c, 'agility', B.movement.charges.marathonAgilityRatio, Math.floor)], max: 100, finish: Math.floor });
  add('trailer', { fixed: B.movement.charges.trailerBasePercent,
    bonus: c => [product(c, 'movement', B.movement.charges.trailerMovementRatio, Math.floor)], max: 100, finish: Math.floor });
  add('charge', { fixed: B.weaponMastery.charge.masteryBaseBonus,
    base: c => Math.floor(c.umbra / B.weaponMastery.charge.masteryDivisor),
    bonus: c => [product(c, 'strength', 1 / B.weaponMastery.charge.strengthDivisor, Math.floor)], finish: Math.floor,
    // Keep equipment debt; slot allocation separately enforces a nonnegative capacity.
    min: -Infinity });
  add('weaponOrfevre', { fixed: B.weaponOrfevre.fromWeaponMastery.earlyBaseBonus,
    base: c => c.umbra > 0 ? D.calculateWeaponOrfevreWeaponMastery(c.view) - B.weaponOrfevre.fromWeaponMastery.earlyBaseBonus : 0,
    bonus: c => [term('strength', D.calculateWeaponOrfevreStrength(c.view))] });
  add('weaponCollector', { fixed: B.weaponMastery.trophy.basePercent,
    base: c => c.umbra > 0 ? D.calculateWeaponMasteryTrophyChance(c.view) - B.weaponMastery.trophy.basePercent : 0,
    bonus: c => [term('strength', D.calculateWeaponMasteryTrophyStrengthBonus(c.view))] });
  return rules;
}

export function calculateStatSources(inputs, requestedKey = null, { effective = false, seuilUmbra } = {}) {
  if (!effective && !inputs[STAT_POINT_INPUTS]) {
    inputs = { ...inputs };
    const details = {};
    for (const key of getPointLimitedStatKeys()) if (Object.hasOwn(inputs, key)) {
      details[key] = calculateStatPointLimit(capacity(inputs[key]), 0, 0, getStatPointThreshold({ seuilUmbra }, key));
      inputs[key] = details[key].value;
    }
    inputs[STAT_POINT_INPUTS] = details;
  }
  const rules = makeRules();
  const results = new Map();
  const resolving = new Set();
  const evaluate = key => {
    if (results.has(key)) return results.get(key);
    const rule = rules.get(key);
    if (!rule) return { value: capacity(inputs[key]) };
    if (resolving.has(key)) throw new Error(`Stat dependency cycle: ${key}`);
    resolving.add(key);
    const uniquePassive = STATS_DATA.some(stat => stat.key === key && stat.uniquePassive);
    // Unique passives have no displayed +/X variants, but manual admin inputs
    // remain valid sources while balancing the game.
    const normal = capacity(inputs[key]);
    const plus = capacity(inputs[`${key}Plus`]);
    const origin = STAT_SYSTEM_ORIGINS[key];
    const umbra = Math.max(0, capacity(inputs[origin]));
    const improved = plus > 0 || umbra > 0;
    const ctx = { key, normal, plus, umbra, read: stat => evaluate(stat).value,
      view: { stats: inputs, _statSystemFormula: true } };
    if (rule.critical || rule.ratioPercent) {
      const chance = key !== 'criticalDamage';
      const detail = rule.astrality ? (key === 'astralBody'
        ? globalThis.umbraProgression.astralBodyDetails(umbra, ctx.read('intelligence'))
        : globalThis.umbraProgression.astralityChanceDetails(umbra, ctx.read('intelligence'), normal, plus))
        : rule.ratioPercent ? globalThis.umbraProgression[rule.vivacite ? 'vivaciteDetails' : rule.equilibre ? 'equilibreDetails' : 'resilienceDetails'](key, umbra, ctx.read(rule.attribute), normal, plus)
        : chance ? globalThis.umbraProgression.criticalChanceDetails(umbra, ctx.read('agility'), normal, plus)
        : globalThis.umbraProgression.criticalDamageDetails(umbra);
      const fixed = chance ? 0 : B.critical.damage.nativeBasePercent;
      const generated = chance ? detail.generated : detail.value;
      const value = chance ? detail.value : Math.max(0, fixed + normal + plus + generated);
      const parts = chance ? [detail.source, detail.attribute] : [detail];
      const row = { key, origin, normal, plus, umbra, uniquePassive, critical: !!rule.critical, ratioPercent: !!rule.ratioPercent,
        value, unit: ' %', state: uniquePassive ? 'normal' : umbra > 0 ? 'X' : plus > 0 ? '+' : 'normal',
        fixed, generated, conversion: generated, enhanced: chance ? value - detail.normalApplied : generated + fixed + plus,
        normalApplied: chance ? detail.normalApplied : value - fixed - generated - plus,
        plusApplied: chance ? detail.plusApplied : plus,
        base: parts[0].value, bonuses: chance ? [parts[1]] : [], criticalParts: parts,
        umbraFlat: 0, attributeConversion: 0, present: normal !== 0 || plus !== 0 || umbra > 0,
        rounded: !chance, maximumReached: chance && value >= detail.max,
        pointLimit: inputs[STAT_POINT_INPUTS]?.[origin] };
      results.set(key, row); resolving.delete(key); return row;
    }
    if (rule.directPercentage) {
      const curve = key === 'resilienceTotal'
        ? globalThis.umbraProgression.resilienceCancelDetails(umbra, ctx.read('strength'))
        : key === 'equilibreBalancedAttackChance' ? globalThis.umbraProgression.balancedAttackDetails(umbra, ctx.read('intelligence'))
        : key === 'controlledSpeed' ? globalThis.umbraProgression.controlledSpeedDetails(umbra, ctx.read('agility'))
        : globalThis.umbraProgression.bullsEyeDetails(umbra, ctx.read('agility'));
      const enabled = !rule.requiresUmbra || umbra > 0;
      const fixed = enabled ? clamp(curve.percent + normal, curve.max) : 0;
      const total = enabled ? clamp(curve.percent + normal + plus, curve.max) : 0;
      const pooled = { total, normal: fixed - curve.percent, plus: total - fixed };
      const row = { key, origin, normal, plus, umbra, uniquePassive, directPercentage: true,
        value: pooled.total, chancePercent: pooled.total, unit: ' %', state: 'normal',
        normalApplied: pooled.normal, plusApplied: pooled.plus, enhanced: curve.percent + pooled.plus,
        base: curve.percent, generated: curve.percent, conversion: curve.percent,
        fixed: 0, umbraFlat: 0, bonuses: [], attributeConversion: 0,
        present: normal !== 0 || plus !== 0 || umbra > 0, maximumReached: pooled.total >= curve.max,
        rounded: false, converted: false, passiveCurve: curve,
        pointLimit: inputs[STAT_POINT_INPUTS]?.[origin], attributePointLimit: inputs[STAT_POINT_INPUTS]?.[curve.attribute || 'agility'] };
      results.set(key, row); resolving.delete(key); return row;
    }
    const base = improved && rule.base ? rule.base(ctx) : 0;
    const fixed = improved ? rule.fixed || 0 : 0;
    const bonuses = improved && rule.bonus ? rule.bonus(ctx) : [];
    for (const part of bonuses) if (!part.compact && !part.curvePreview && !part.arithmetic) {
      part.curvePreview = { current: { points: ctx.read(part.stat), value: part.value } };
    }
    const generated = base + fixed + bonuses.reduce((sum, part) => sum + part.value, 0);
    const conversion = rule.convert ? rule.convert(generated) : generated;
    const plusApplied = plus;
    const umbraFlat = rule.flat ? round(rule.flat(ctx)) : 0;
    // Direct gains share the output unit; only the generated ratio contribution is rounded.
    const enhancedInput = rule.sharedFlat ? plusApplied + umbraFlat + (rule.finish || round)(conversion)
      : improved ? (rule.finish || round)(plusApplied + conversion) : 0;
    const enhanced = key === 'armor' ? Math.round(enhancedInput) : rule.sharedFlat ? Math.min(enhancedInput, rule.max ?? Infinity)
      : clamp(enhancedInput, rule.max);
    const total = normal + (rule.sharedFlat && key !== 'armor' ? enhancedInput : enhanced);
    const value = round(clamp(key === 'armor' ? Math.round(total) : rule.finishTotal ? rule.finishTotal(total) : total, rule.max, rule.min));
    // Composition labels never alter the pooled improvement or its ratios.
    const state = uniquePassive ? 'normal' : rule.sharedFlat ? umbra > 0 ? 'X' : plus > 0 ? '+' : 'normal' : umbra > 0
      ? plus > 0 ? normal !== 0 ? 'Ω' : '◆' : normal !== 0 ? '◇' : '+'
      : plus > 0 ? normal !== 0 ? 'X' : '+' : 'normal';
    const attributePoints = bonuses.reduce((sum, part) => sum + part.value, 0);
    const attributeConversion = rule.sharedFlat && plus > 0
      ? (key === 'armor' ? Math.round : rule.finish || round)(rule.convert ? rule.convert(attributePoints) : attributePoints) : 0;
    const progression = rule.progressive ? {
      source: progressivePowerPart(origin, umbra, rule.progressive.ratios.source),
      attribute: bonuses[0], sourcePoints: inputs[STAT_POINT_INPUTS]?.[origin],
      attributePoints: inputs[STAT_POINT_INPUTS]?.[rule.progressive.attribute],
      limit: inputs[STAT_POINT_INPUTS]?.[origin]?.limit ?? getUmbraThreshold({ seuilUmbra }),
    } : null;
    if (progression) {
      progression.source.note += ' ' + describeStatPointLimit(progression.sourcePoints);
      if (bonuses[0]) bonuses[0].note += ' ' + describeStatPointLimit(progression.attributePoints);
    }
    const row = { key, origin, normal, plus, plusApplied, umbra, umbraFlat, base, fixed, bonuses, generated, conversion, enhanced, value, progression,
      attributeConversion, uniquePassive,
      normalApplied: round(value - enhanced), state,
      present: normal !== 0 || plus !== 0 || umbra > 0, maximumReached: value >= (rule.max ?? Infinity),
      unit: percentages.has(key) && !rule.progressive?.resistance && !rule.progressive?.dodge ? ' %' : '',
      ...(rule.progressive?.dodge ? { dodgePoints: true, chancePercent: globalThis.umbraProgression.dodgeChancePercent(value) } : {}),
      ...(rule.progressive?.precision ? { precisionPoints: true, chancePercent: E.calculatePrecisionPercent(value) } : {}),
      ...(rule.progressive?.resistance ? { resistancePoints: true,
        reductionRatio: globalThis.umbraProgression.resistanceReductionRatio(value,
          globalThis.umbraProgression.getResistanceConstant(key)) } : {}),
      converted: !!rule.convert, sourceRatio: progression?.source.coefficient ?? rule.sourceRatio,
      rounded: !!rule.finish || !!rule.convert };
    results.set(key, row);
    resolving.delete(key);
    return row;
  };
  if (requestedKey) return evaluate(requestedKey);
  for (const key of rules.keys()) evaluate(key);
  return results;
}

export function getEntityVelocityTiming(entity) {
  if (!statSystemReady || !entity?.baseStats || entity._statSystemFormula) return null;
  const inputs = statDisplayRead(entity)?.inputs || E.getStatSystemInputs(entity);
  const velocity = calculateStatSources(inputs, 'velocity');
  if (!velocity.present) return null;
  const base = E.getStatSystemInputs(entity, { combat: false });
  // Flat/percentage combat speed modifiers still apply after Vélocité in getSafe.
  return globalThis.umbraProgression.velocityTiming(velocity.value, capacity(base.speed) || 1000);
}

export function getStatSystemResult(entity, key) {
  if (!statSystemReady || !entity?.baseStats || entity._statSystemFormula || !STAT_SYSTEM_ORIGINS[key]) return null;
  const cached = statDisplayRead(entity);
  if (cached?.results.has(key)) return cached.results.get(key);
  const row = calculateStatSources(cached?.inputs || E.getStatSystemInputs(entity), key);
  const preview = entity.modifierStats?.preview?.statLeveled;
  const changed = preview && [key, `${key}Plus`, row.origin].some(source => Object.hasOwn(preview, source));
  const result = row.critical || row.ratioPercent || row.present || (changed && key !== 'dayHpRegen') ? row : null;
  cached?.results.set(key, result);
  return result;
}

// Pool capacities remain ordinary game pools; source evaluation never restores spent resources.
export function applyStatSystemTotals(entity, totals, inputs) {
  if (!statSystemReady) return totals;
  for (const key of getPointLimitedStatKeys()) if (Object.hasOwn(inputs, key)) totals[key] = capacity(inputs[key]);
  for (const row of calculateStatSources(inputs).values()) {
    if (row.critical || row.ratioPercent || ['resilienceTotal', 'equilibreBalancedAttackChance', 'controlledSpeed'].includes(row.key)) { totals[row.key] = row.value; continue; }
    if (!row.present) {
      const preview = entity.modifierStats?.preview?.statLeveled;
      if (preview && [row.key, `${row.key}Plus`, row.origin].some(key => Object.hasOwn(preview, key))) {
        if (row.key === 'dayHpRegen') totals[row.key] = B.regeneration.vitalityDayHp.minTotalBaseAmount;
        else if (row.key === 'armor') {
          const stuffMax = totals.armor?.stuffMax || 0;
          totals.armor = { ...totals.armor, max: 0, current: Math.min(totals.armor?.current || 0, stuffMax),
            totalMax: stuffMax, externalMax: 0, robustnessMax: 0, regenMax: 0 };
        } else if (row.key === 'extraLife') totals.extraLife = { current: 0, max: 0 };
        else if (row.key === 'shift') totals.shift = { current: Number(entity.stats?.shift?.current) || 0, max: 1, baseDefault: true };
        else if (row.key === 'HP') totals.HP = { current: Math.min(totals.HP?.current || 0, 1), max: 1 };
        else totals[row.key] = 0;
      }
      continue;
    }
    if (['HP', 'armor', 'extraLife', 'shift'].includes(row.key)) {
      const previous = totals[row.key];
      const max = row.key === 'HP' ? Math.max(1, row.value) : row.value;
      const owned = entity.stats?.[row.key];
      const initial = entity.baseStats?.[row.key];
      // The preview has already applied the armor granted by the proposed level-up.
      const current = row.key === 'armor' && previous && typeof previous === 'object' ? previous.current
        : owned && typeof owned === 'object' ? owned.current
        : initial && typeof initial === 'object' && initial.current != null ? initial.current
        : row.key === 'shift' ? D.calculateMovementStartingCharges({ stats: { ...inputs, movement: max } }) : max;
      const remaining = row.key === 'shift' ? Number(current) || 0 : Math.min(capacity(current), max);
      totals[row.key] = previous && typeof previous === 'object'
        ? { ...previous, max, current: remaining }
        : { max, current: remaining };
      if (row.key === 'shift') delete totals.shift.baseDefault;
      if (row.key === 'armor' && previous?.totalMax != null) {
        const robustnessMax = row.umbra > 0 ? Math.max(0, Math.round(row.generated + row.umbraFlat)) : 0;
        Object.assign(totals.armor, { max: robustnessMax, robustnessMax, regenMax: robustnessMax,
          externalMax: max - robustnessMax, totalMax: max + (previous.stuffMax || 0), current: previous.current });
      }
    } else totals[row.key] = row.value;
  }
  const velocity = calculateStatSources(inputs, 'velocity');
  if (velocity.present) totals.speed = globalThis.umbraProgression.velocityTiming(velocity.value, capacity(inputs.speed) || 1000).adjustedSpeed;
  return totals;
}

function autonomousContributions(entity, key) {
  return D.getStatContributions(entity, key, { resolveLabels: false })
    .filter(source => !source.source.startsWith('Umbra :') && source.source !== 'Bonus dérivés')
    .map(source => ({ ...source, key }));
}

function autonomousSourceParts(entity, key, value) {
  const sources = autonomousContributions(entity, key);
  const parts = [];
  const add = (category, value) => {
    const existing = parts.find(part => part.category === category);
    if (existing) existing.value = round(existing.value + value);
    else if (value) parts.push({ category, value: round(value) });
  };
  let flat = 0, percent = 0, previous = 0;
  for (const category of ['fixed', 'stat', 'equipment']) {
    for (const source of sources.filter(source => source.category === category)) {
      if (source.mode === 'percent') percent += source.value;
      else flat += source.value;
    }
    const next = percent ? Math.round(flat * (1 + percent / 100)) : flat;
    add(category, next - previous);
    previous = next;
  }
  // Preview and combat modifiers follow durable sources, as in getStatSystemInputs.
  const apply = (category, delta) => {
    const flat = typeof delta === 'number' ? delta : capacity(delta?.flat ?? delta?.max ?? delta?.current);
    const next = (previous + flat) * (1 + (Number(delta?.percent) || 0) / 100);
    add(category, next - previous);
    previous = next;
  };
  if (entity?.modifierStats?.preview?.statLeveled) {
    apply('stat', entity.modifierStats.preview.statLeveled[key]);
    if (entity.modifierStats.durable?.stuff?.orfevre) apply('equipment', E.getWeaponOrfevreStuffPreviewDelta(entity)?.[key]);
  }
  const combat = sources.filter(source => source.category === 'combat');
  apply('combat', {
    flat: combat.filter(source => source.mode !== 'percent').reduce((sum, source) => sum + source.value, 0),
    percent: combat.filter(source => source.mode === 'percent').reduce((sum, source) => sum + source.value, 0),
  });
  add('stat', value - previous);
  return parts.filter(part => part.value);
}

export function buildStatSystemModel(row, entity = null) {
  const family = B.generatedUmbraStats.sources[row.origin];
  const stat = getDisplayStatKey(row.key);
  if (row.critical || row.ratioPercent) {
    const sourceParts = row.criticalParts.map(part => ({ ...part, unit: row.unit }));
    const component = (kind, input, value, parts, state = 'normal') => ({ kind, input, stat, value, parts, state, unit: row.unit,
      ...(kind === 'umbra' ? { umbra: row.origin } : {}) });
    const flat = value => [{ stat, value, unit: row.unit, fixed: true }];
    const contributions = [
      component('umbra', row.origin, row.umbra > 0 ? row.generated : 0, row.umbra > 0 ? sourceParts : [], row.uniquePassive ? 'normal' : 'X'),
      component('plus', `${row.key}Plus`, row.plusApplied + (row.umbra > 0 ? 0 : row.generated),
        [...flat(row.plusApplied), ...(row.umbra > 0 ? [] : sourceParts)], row.uniquePassive ? 'normal' : '+'),
      component('normal', row.key, row.normalApplied, flat(row.normalApplied)),
      component('native', null, row.fixed, [{ stat: 'neutral', value: row.fixed, unit: row.unit, fixed: true }]),
    ];
    return { stat, value: row.value, unit: row.unit, system: row, contributions,
      improvement: { stat, value: row.generated, unit: row.unit, parts: sourceParts },
      parts: contributions.filter(part => part.value !== 0).flatMap(part => part.parts),
      maximumReached: row.maximumReached, rounded: row.rounded };
  }
  if (row.directPercentage) {
    const source = { stat: row.origin, value: row.generated, unit: row.unit, passiveCurve: row.passiveCurve,
      curvePreview: { current: { points: row.umbra, value: row.generated } } };
    const improvement = { stat, value: row.generated, unit: row.unit, parts: [source], passiveCurve: row.passiveCurve };
    const component = (kind, input, value, parts) => ({ kind, input, stat, value, unit: row.unit, parts, state: 'normal',
      ...(kind === 'umbra' ? { umbra: row.origin, passiveCurve: row.passiveCurve } : {}) });
    const contributions = [component('umbra', row.origin, row.generated, [source]),
      component('normal', row.key, row.normalApplied, [{ stat, value: row.normalApplied, unit: row.unit, fixed: true }]),
      component('plus', `${row.key}Plus`, row.plusApplied, [{ stat, value: row.plusApplied, unit: row.unit, fixed: true }])];
    return { stat, value: row.value, unit: row.unit, system: row, improvement, contributions,
      parts: contributions.filter(part => part.value !== 0).flatMap(part => part.parts),
      maximumReached: row.maximumReached, rounded: false };
  }
  const generatedUnit = row.converted ? '' : row.unit;
  const generatedParts = [];
  if (row.umbra && row.progression) generatedParts.push({ ...row.progression.source, unit: generatedUnit });
  else if (row.umbra) generatedParts.push({ stat: row.origin, value: row.base, unit: generatedUnit,
    ...(row.sourceRatio == null ? { curvePreview: { current: { points: row.umbra, value: row.base } } }
      : { compact: { source: { stat: row.origin, value: row.umbra }, multiplier: { stat: row.origin, value: row.sourceRatio } } }) });
  if (row.fixed) generatedParts.push({ stat: 'neutral', value: row.fixed, unit: generatedUnit, fixed: true });
  generatedParts.push(...row.bonuses.map(part => ({ ...part, unit: generatedUnit })));
  const improvement = { stat, unit: generatedUnit, parts: generatedParts,
    value: row.converted ? roundBalance(row.generated, B.generatedUmbraStats.sources[row.origin].decimals) : row.generated };
  const parts = [];
  const giftPart = row.umbraFlat ? { stat, value: row.umbraFlat, unit: row.unit, fixed: true } : null;
  if (row.normal !== 0) parts.push({ stat, value: row.normalApplied, unit: row.unit, fixed: true });
  if (row.plusApplied !== 0) parts.push({ stat, value: row.plusApplied, unit: row.unit, fixed: true });
  if (giftPart) parts.push(giftPart);
  if (row.converted && row.state !== 'normal') {
    parts.push({ stat: row.origin, value: row.conversion, unit: row.unit, rounded: true,
      arithmetic: { terms: [{ stat: row.origin, value: row.generated }, '→', { stat, value: row.conversion, unit: row.unit }] } });
  } else {
    parts.push(...generatedParts);
  }
  const difference = round(row.value - parts.reduce((sum, part) => sum + part.value, 0));
  if (difference) parts.push({ stat: 'neutral', value: Math.abs(difference), operator: difference < 0 ? '−' : '+', unit: row.unit, fixed: true,
    ...(family ? { roundingAdjustment: true } : {}) });
  if (parts.length && row.state !== 'normal' && row.rounded) parts[0].rounded = true;
  const sourceGroups = entity ? {
    normal: autonomousSourceParts(entity, row.key, row.normal),
    improved: autonomousSourceParts(entity, `${row.key}Plus`, row.plus),
  } : null;
  let contributions;
  if (family) {
    // Stat+ owns the attribute ratio once; the Umbra owns the remaining gain.
    // For percentage curves, subtract the converted attribute-only baseline.
    const attribute = row.progression && row.umbra > 0 ? 0 : row.attributeConversion;
    const plusValue = row.plus > 0 ? Math.min(row.plusApplied + attribute, row.enhanced) : row.plusApplied;
    const attributeModel = { stat, unit: '', parts: row.bonuses,
      value: roundBalance(row.bonuses.reduce((sum, part) => sum + part.value, 0), family.decimals) };
    const convertedPart = (source, value, calculation, operator = '+') => ({ stat: source, value, unit: row.unit, calculation, operator });
    const flatParts = (key, value) => {
      const raw = entity ? D.getStatContributions(entity, key, { resolveLabels: false, includePreview: true })
        .filter(source => source.category !== 'umbra') : [];
      const sources = raw.length && raw.every(source => source.mode !== 'percent') && round(raw.reduce((sum, part) => sum + part.value, 0)) === round(value)
        ? raw : entity ? autonomousSourceParts(entity, key, value) : [];
      return (sources.length ? sources : [{ value }]).map(part => ({ stat, value: part.value, unit: row.unit, fixed: true, malus: part.value < 0 }));
    };
    const component = (kind, input, value, componentParts) => {
      const terms = componentParts.filter(part => part.value !== 0 || !part.fixed);
      const adjustment = round(value - terms.reduce((sum, part) => sum + (part.operator === '−' ? -part.value : part.value), 0));
      if (adjustment) terms.push({ stat: 'neutral', value: Math.abs(adjustment), operator: adjustment < 0 ? '−' : '+', unit: row.unit, fixed: true, rounded: true,
        roundingAdjustment: kind !== 'normal' });
      return { kind, input, stat, value: round(value), unit: row.unit, parts: terms, maximumReached: row.maximumReached,
        state: row.uniquePassive || kind === 'normal' ? 'normal' : kind === 'umbra' ? 'X' : '+', ...(kind === 'umbra' ? { umbra: row.origin } : {}) };
    };
    contributions = [
      component('umbra', row.origin, row.enhanced - plusValue,
        row.converted ? [convertedPart(row.origin, row.conversion, improvement),
          ...(attribute ? [convertedPart(family.attribute, attribute, attributeModel, '−')] : [])]
          : row.progression && row.umbra > 0 ? [...generatedParts, ...(giftPart ? [giftPart] : [])]
            : generatedParts.filter(part => row.plus <= 0 || part.stat === row.origin)),
      component('plus', `${row.key}Plus`, plusValue,
        [...flatParts(`${row.key}Plus`, row.plusApplied), ...(row.plus > 0 && !(row.progression && row.umbra > 0)
          ? row.converted ? [convertedPart(family.attribute, attribute, attributeModel)] : row.bonuses : [])]),
      component('normal', row.key, row.normalApplied, flatParts(row.key, row.normal)),
    ];
  }
  return { stat, value: row.value, unit: row.unit, parts, system: row, sourceGroups, improvement, contributions,
    maximumReached: row.maximumReached, rounded: row.state !== 'normal' && row.rounded };
}

export function getStatSystemSourceTotals(entity, key) {
  const inputs = statDisplayRead(entity)?.inputs || E.getStatSystemInputs(entity);
  const final = calculateStatSources(inputs, key);
  if (B.generatedUmbraStats.sources[final.origin] || final.critical) {
    return buildStatSystemModel(final, entity).contributions.filter(part => part.value !== 0).map(part => ({
      category: ['normal', 'native'].includes(part.kind) ? 'fixed' : part.kind,
      stat: part.stat, unit: part.unit, value: part.value, exclusive: true,
      normalValue: ['normal', 'native'].includes(part.kind) ? part.value : 0,
      improvedValue: ['normal', 'native'].includes(part.kind) ? 0 : part.value,
      calculations: { normal: { stat: part.stat, unit: part.unit, value: 0, parts: [] },
        improved: { stat: part.stat, unit: part.unit, value: 0, parts: [] },
        [['normal', 'native'].includes(part.kind) ? 'normal' : 'improved']: part },
      provenance: (part.input ? D.getStatInputProvenance(entity, part.input, part.kind === 'umbra' ? '' : part.unit) : [])
        .filter(source => source.state === (part.kind === 'plus' ? '+' : 'normal')),
      ...(part.umbra ? { umbra: part.umbra } : {}),
    }));
  }
  const sourceKeys = [key, `${key}Plus`];
  const contributions = sourceKeys.flatMap(sourceKey => autonomousSourceParts(entity, sourceKey, capacity(inputs[sourceKey]))
    .map(part => ({ ...part, key: sourceKey })));
  const totals = [];
  const active = new Set();
  const amount = sourceKey => contributions.filter(source => source.key === sourceKey && active.has(source.category))
    .reduce((sum, source) => sum + source.value, 0);
  const calculation = (category, before, after, kind) => {
    const stat = getDisplayStatKey(key);
    const component = row => {
      if (!row) return [];
      if (kind === 'normal') return [{ stat, value: row.normalApplied, unit: row.unit, fixed: true }];
      const model = buildStatSystemModel({ ...row, normal: 0, normalApplied: 0, value: row.enhanced });
      return model.parts.map(part => part.arithmetic && row.converted
        ? { ...part, calculation: model.improvement } : part);
    };
    const current = component(after);
    const previous = component(before);
    const parts = [];
    const signature = ({ rounded, ...value }) => JSON.stringify(value);
    // Cancel unchanged ratios. A later source only owns its actual increment.
    for (const part of current) {
      const match = previous.findIndex(other => signature(other) === signature(part));
      if (match >= 0) previous.splice(match, 1);
      else parts.push(part);
    }
    parts.push(...previous.map(part => ({ ...part, operator: part.operator === '\u2212' ? '+' : '\u2212' })));
    const sourceKey = kind === 'normal' ? key : `${key}Plus`;
    const fixed = parts.filter(part => part.fixed && part.stat === stat);
    const delta = round(fixed.reduce((sum, part) => sum + (part.operator === '\u2212' ? -part.value : part.value), 0));
    const raw = D.getStatContributions(entity, sourceKey, { resolveLabels: false, includePreview: true })
      .filter(source => source.category === category);
    const inputs = raw.length && raw.every(source => source.mode !== 'percent')
      && round(raw.reduce((sum, source) => sum + source.value, 0)) === delta
      ? raw.map(source => ({ stat, value: source.value, unit: after.unit, fixed: true, state: kind === 'normal' ? 'normal' : '+' }))
      : [{ stat, value: delta, unit: after.unit, fixed: true, state: kind === 'normal' ? 'normal' : '+' }];
    return { stat, unit: after.unit, parts: [...inputs, ...parts.filter(part => !fixed.includes(part))].filter(part => part.value !== 0),
      value: round(kind === 'normal' ? after.normalApplied - (before?.normalApplied || 0) : after.enhanced - (before?.enhanced || 0)) };
  };
  const add = (category, before, after) => {
    const normalValue = after.normalApplied - (before?.normalApplied || 0);
    const improvedValue = after.enhanced - (before?.enhanced || 0);
    const value = round(normalValue + improvedValue);
    if (value) totals.push({ category, value, normalValue: round(normalValue), improvedValue: round(improvedValue), stat: getDisplayStatKey(key), unit: final.unit,
      calculations: { normal: calculation(category, before, after, 'normal'), improved: calculation(category, before, after, 'improved') },
      ...(category === 'equipment' ? { family: 'fixed' } : {}),
      provenance: category === 'umbra' && final.umbra > 0 ? D.getStatInputProvenance(entity, final.origin)
        : ['fixed', 'equipment'].includes(category) ? D.getStatInputProvenance(entity, key, final.unit, category) : [],
      ...(category === 'umbra' && final.umbra > 0 ? { umbra: final.origin } : {}) });
  };
  let previous = calculateStatSources({ ...inputs, [key]: 0, [`${key}Plus`]: 0 }, key);
  add('umbra', null, previous);
  for (const category of ['fixed', 'stat', 'equipment', 'combat']) {
    active.add(category);
    const candidate = { ...inputs };
    for (const sourceKey of sourceKeys) candidate[sourceKey] = amount(sourceKey);
    const next = calculateStatSources(candidate, key);
    add(category, previous, next);
    previous = next;
  }
  return totals;
}

statSystemReady = true;
