import { removeCombatVisualAfter } from './combatClock.js';
import { isEntityMovementBlocked, isCombatEnemy, getControlState, canEntityProc } from './entityControl.js';
import { setTimeout, requestAnimationFrame, clockNow } from './combatClock.js';
import { buildStatHelperContent, POWER_RATE_HELPER_TEXT, buildPowerRateAssumption } from './data/helpers.js';
import { calculateStatSources, getStatSystemResult, buildStatSystemModel, getStatSystemSourceTotals, STAT_SYSTEM_ORIGINS, getProgressiveRatio, getDirectingStatResult, calculateProgressivePower, describeStatPointLimit, withStatDisplayReads } from './entite/statSystem.js';
import { stats as statDefinitions, stats } from "./data/statsData.js";
import { balanceData, easeOutPowerRatio, roundBalance } from "./data/balanceData.js";
import { isUmbraRestricted, POWER_RULES, evaluateActionRates, evaluateEntityPower, buildPowerAction,
  readOwnedPowerAttacks, getProfanationTemplate, summarizePowerSamples, createPowerRandom, getPowerStatDefinition,
  evaluateEncounterPower, TACTICAL_RULES, collectTacticalConsequences, evaluateTacticalPower,
  evaluateAttackPowerFromRates } from './procedural/proc-bareme.js';
import { getAttackEffectHandler } from './entityAttributs.js';
import { inheritSummonEssences } from './summonsMecanics.js';
import { buildReverseArchetypePlan, getAutoReverseArchetypeCandidates } from './entite/reverseArchetype.js';
import { attackDetails as powerAttackCatalog } from './data/attackList.js';
import {
  getSafe,
  normalizeStatKey,
  entityBattleBooste,
  getEntityBattleBoostValue,
  getDisplayStatKey,
  getBattleEntityElement,
  calculatePenetrationPercent,
  calculateResistanceReductionPercent,
} from "./entite/entityRules.js";
import {
  getAttackEssenceProfile,
  getAttackNatureRules,
  getAttackResolutionFlags,
  getAttackPowerRatios,
  initializeAttackPowerRatios,
  getAttackMastery,
  getAttackResonance,
  splitAttackNatureAmount,
  normArr,
} from "./attackResolution.js";
import {
  calculateBloodThirstyFromBloodFury,
  entites,
  BASE_MAX_LEVEL,
  WILL_MAX_BONUS,
  maxLevel,
  generateUniqueID,
  entitesNestUp,
  projectEntityForPower,
  enrichEntityStats,
  calculateVitalityBonus,
  calculateVelocityReduction,
  calculateDodgePercent,
  calculatePrecisionPercent,
  calculateIndestructibilityPercent,
  calculateAmbidextryPercent,
  calculateEsoterismPercent,
  calculateAstralityPercent,
  calculateRobustnessArmorDetails,
  getBloodThirstyPercent,
  calculateHastePercent,
  calculateCritChancePercent,
  calculateResiliencePercent,
  calculateLvlMaxBonus,
  calculateTranscendenceExtraLife,
  BaseDayHpRegen,
  calculateWeaponMasteryCharge,
  getMovementWeightMalus,
  getStatBeforeGeneration,
  getStatSystemInputs,
  getWeaponOrfevrePreviewActivePercent,
  buildWeaponOrfevreStuffModifiersById,
  isBeneficialStuffNumber,
} from "./entites.js";
import { getEquippedItemById, loadEquippedItems } from "./GameStorage.js";
import { playCachedGif, cachedResourceUrl } from "./data/loaderList.js";
import { calculateHypercognitionEssenceCount, calculateCognitiveEssenceCount } from "./essenceInventory.js";
import { EffectMessage, isAstralReturnActive, getAstralityRuntime, astralCooldownRemaining, startAstralCooldown } from "./attackEffectMecanics.js";
import {
  animateDodge,
  animateIndestructibility,
  animateEsoterism,
  animateAstrality,
  animateAmbidextry,
  animateMysticism,
  animateOccultism,
  damageImpact,
} from "./entitesAnimation.js";
import { battleLogs } from "./battleLogs.js";
import { refillNaturalMovement, spendMovementCharges, getEquipmentResourceCurrent, getEquipmentResourceMax } from './items/resourceStocks.js';
import { attackEffects } from "./data/attackEffects.js";

// Attack stat contributions and essence affinity.
const projectedAttack = Symbol('projected-attack');
const attributeColor = { force: 'red', intelligence: 'blue', agilite: 'yellow' };
const number = value => typeof value === 'number' ? value : Number(value?.flat ?? value?.max ?? value?.current) || 0;

// Resource helpers include the separate equipment/spell pools without feeding
// their capacity back into the stat engine or the regenerating Umbra reserve.
function buildDisplayedStatModel(system, entity) {
  const model = buildStatSystemModel(system, entity);
  const armor = system.key === 'armor' ? getSafe(entity, 'armor', 0) : null;
  if (armor?.totalMax == null || armor.totalMax === model.value) return model;
  const value = Number(armor.totalMax), difference = value - model.value;
  const part = { stat: 'armor', value: Math.abs(difference), unit: '', fixed: true,
    ...(difference < 0 ? { operator: '−' } : {}) };
  return { ...model, value, parts: [...model.parts, part], contributions: [...(model.contributions || []),
    { kind: 'normal', input: 'armor', stat: 'armor', value: difference, unit: '', state: 'normal', parts: [part] }] };
}

export function getStatContributions(entity, stat, { resolveLabels = true, includePreview = false, includePlus = false } = {}) {
  const key = normalizeStatKey(stat);
  const durable = entity?.modifierStats?.durable || {};
  const result = [];
  const add = (value, source, id = '', equipment = false, external = false) => {
    if (number(value)) result.push({ value: number(value), mode: 'flat', source, id, equipment, external });
    if (value?.percent) result.push({ value: Number(value.percent), mode: 'percent', source, id, equipment, external });
  };
  add(entity?.baseStats?.[key], 'Base');
  for (const [layer, label] of [['level', 'Niveaux'], ['adminLevel', 'Niveaux admin'], ['archetype', 'Archétype'], ['statLeveled', 'Progression']]) {
    add(durable[layer]?.[key], label);
  }
  if (includePreview) add(entity?.modifierStats?.preview?.statLeveled?.[key], 'Prévision');
  const previewStuff = includePreview && durable.stuff?.orfevre && Object.keys(entity?.modifierStats?.preview?.statLeveled || {}).length
    ? buildWeaponOrfevreStuffModifiersById(durable.stuff?.byId || {}, getWeaponOrfevrePreviewActivePercent(entity)) : null;
  const byId = previewStuff?.byId || durable.stuff?.orfevre?.effectiveById || durable.stuff?.byId || {};
  for (const [id, delta] of Object.entries(byId)) {
    if (delta[key] !== undefined) {
      const start = result.length;
      add(delta[key], (resolveLabels && getEquippedItemById(id)?.displayName) || 'Équipement', id, true, true);
      const detail = previewStuff ? previewStuff.detailsById?.[id]?.[key] : durable.stuff?.orfevre?.byId?.[id]?.[key];
      if (detail) for (const entry of result.slice(start)) {
        entry.rawValue = entry.mode === 'percent' ? Number(detail.raw?.percent) || 0 : number(detail.raw);
        entry.orfevreBonus = entry.mode === 'percent' ? Number(detail.bonus?.percent) || 0 : number(detail.bonus);
        entry.orfevrePercent = detail.activePercent;
      }
    }
  }
  const generatedSource = Object.entries(balanceData.generatedUmbraStats.sources).find(([, cfg]) => cfg.target === key)?.[0];
  add(durable.derived?.[key], generatedSource
    ? `Umbra : ${statDefinitions.find(stat => stat.key === generatedSource)?.name || generatedSource}` : 'Bonus dérivés');
  if (key === 'bloodThirsty') add(calculateBloodThirstyFromBloodFury(Number(entity?.stats?.bloodFury) || 0), 'Umbra : Fureur sanguinaire');
  for (const boost of entity?.battleBoosts?.[key] || []) {
    if (boost.value) result.push({ value: boost.value, mode: boost.mode, source: boost.source || 'Effet de combat', id: boost.id, equipment: false, external: true, combat: true });
  }
  const baseKey = key.replace(/Plus$/, '');
  for (const source of result) {
    source.stat = getDisplayStatKey(baseKey);
    source.state = key === baseKey ? 'normal' : '+';
    source.category = source.combat ? 'combat' : source.equipment ? 'equipment'
      : source.source === 'Base' ? 'fixed'
        : source.source === 'Bonus dérivés' || source.source.startsWith('Umbra :') ? 'umbra' : 'stat';
    if (['strength', 'agility', 'intelligence', 'will'].includes(baseKey)) source.displayState = 'attribute';
    if (source.equipment) {
      source.provenance = 'equipment';
      source.displayState ||= statDefinitions.find(stat => normalizeStatKey(stat.key) === baseKey)?.nature === 'umbra' ? 'umbra' : source.state;
    }
    source.malus = source.source !== 'Base' && source.category !== 'umbra' && !isBeneficialStuffNumber(baseKey, source.value);
  }
  if (includePlus && Object.hasOwn(STAT_SYSTEM_ORIGINS, key)) {
    result.push(...getStatContributions(entity, `${key}Plus`, { resolveLabels, includePreview }));
  }
  return result;
}

export function getStatInputProvenance(entity, key, unit = '', category = null) {
  key = normalizeStatKey(key);
  const baseKey = key.replace(/Plus$/, '');
  const name = baseKey === 'shift' ? 'Déplacements max' : statDefinitions.find(stat => normalizeStatKey(stat.key) === baseKey)?.name;
  return getStatContributions(entity, key, { includePlus: true, includePreview: true })
    .filter(source => (source.provenance || source.malus) && (!category || source.category === category))
    .map(source => ({ ...source, name, unit }));
}

export function isDisplayableStatContribution(contribution) {
  return Boolean(contribution?.external);
}

function equipmentUmbraValue(entity, key) {
  if (isUmbraRestricted(entity, key)) return 0;
  const entries = getStatContributions(entity, key, { resolveLabels: false }).filter(entry => entry.equipment);
  const flat = entries.filter(entry => entry.mode === 'flat').reduce((sum, entry) => sum + entry.value, 0);
  const percent = entries.filter(entry => entry.mode === 'percent').reduce((sum, entry) => sum + entry.value, 0);
  const points = getDirectingStatResult(entity, key);
  if (points) {
    // Preserve the effective equipment share after the owner's common threshold.
    const totalExternal = points.other;
    const rawEquipment = flat * (1 + percent / 100);
    return Math.max(0, totalExternal > 0 ? rawEquipment * points.otherApplied / totalExternal : rawEquipment);
  }
  return Math.max(0, Math.round(flat * (1 + percent / 100)));
}

export function getAttackUmbraAccess(entity, attack) {
  const profile = getAttackEssenceProfile(attack);
  const pure = ['red', 'blue', 'yellow'].filter(color => profile[color] > 0).length === 1;
  return statDefinitions.filter(stat => stat.key !== 'hypercognition' && stat.nature === 'umbra' && stat.type?.startsWith('attaque-'))
    .map(stat => {
      const color = attributeColor[stat.attribut];
      const tier = Number(stat.type.split('-')[1]);
      const count = profile[color] || 0;
      const compatible = count > 0 && (pure || count >= tier);
      const owned = Math.max(0, Number(getSafe(entity, stat.key, 0)) || 0);
      const equipment = profile.total > 0 ? equipmentUmbraValue(entity, stat.key) : 0;
      return { ...stat, color, tier, count, pure, compatible, owned, equipment,
        usable: owned > 0 && (compatible || equipment > 0),
        value: compatible ? owned : equipment };
    });
}

export function getAttackPurity(attack) {
  const nature = getAttackNatureRules(attack || {});
  return { level: nature.level, color: nature.pure, bonus: nature.purityBonus };
}

// The view only changes attack calculations. HP, defenses and resource writes stay on the owner.
export function createAttackStatView(entity, attack = entity?.currentAttack) {
  if (!entity || !attack || entity[projectedAttack] === attack) return entity;
  const original = entity.modifierStats?.preview?.total || entity.stats || {};
  const stats = { ...original };
  const modifiers = entity.modifierStats;
  const access = getAttackUmbraAccess(entity, attack);
  for (const entry of access) {
    if (entry.compatible) continue;
    stats[entry.key] = entry.equipment;
    const generated = balanceData.generatedUmbraStats.sources[entry.key];
    if (generated) {
      const before = calculateGeneratedUmbraStatBonus({ stats: original }, entry.key);
      const after = calculateGeneratedUmbraStatBonus({ stats }, entry.key);
      const percent = getStatContributions(entity, generated.target, { resolveLabels: false }).filter(source => source.mode === 'percent')
        .reduce((sum, source) => sum + source.value, 0);
      stats[generated.target] = Math.max(0, (Number(original[generated.target]) || 0) - Math.round((before - after) * (1 + percent / 100)));
    }
    if (entry.key === 'bloodFury') {
      stats.bloodThirsty = Math.max(0, (Number(original.bloodThirsty) || 0)
        - calculateBloodThirstyFromBloodFury(Number(original.bloodFury) || 0) + calculateBloodThirstyFromBloodFury(Number(stats.bloodFury) || 0));
    }
  }
  const battleBoosts = { ...entity.battleBoosts };
  for (const entry of access) if (!entry.compatible) delete battleBoosts[entry.key];
  if (getAttackNatureRules(attack).isInert) {
    stats.hypercognition = 0;
    delete battleBoosts.hypercognition;
  }
  return new Proxy(entity, {
    get: (owner, key) => key === projectedAttack ? attack : key === 'stats' ? stats
      : key === '_statSystemOverrides' ? Object.fromEntries([...access.filter(entry => !entry.compatible).map(entry => [entry.key, entry.equipment]),
        ...(getAttackNatureRules(attack).isInert ? [['hypercognition', 0]] : [])])
      : key === 'currentAttack' ? attack : key === 'battleBoosts' ? battleBoosts
      : key === 'modifierStats' ? { ...modifiers, preview: modifiers?.preview ? { ...modifiers.preview, total: stats } : undefined } : owner[key],
  });
}

// Combat calculations and display values; helper content lives in data/helpers.js.
export {
  calculateResistanceReductionPercent,
  calculateResistances,
} from "./entite/entityRules.js";

export {
  getSafe,
  entityBattleBooste,
  getEntityBattleBoostValue,
} from "./entite/entityRules.js";

export const ATTACK_TIME_REDUC_CAP = balanceData.attackTime.reductionCapPercent;

export function getWillBonusUI(lvlMaxBonus) {
  const bonus = Number(lvlMaxBonus) || 0;

  return {
    lvlMaxBonusAbs: Math.abs(bonus),                 // jamais de "-" ici
    lvlMaxBonusOp: bonus < 0 ? "-" : "+",            // signe affiché
    lvlMaxBonusOpClass: bonus < 0 ? "less" : "plus", // classe du signe
  };
}

export function calculateStatsDisplay(statKey, entite, statValue, options = {}) {
  return withStatDisplayReads(() => calculateStatsDisplayContent(statKey, entite, statValue, options));
}

function calculateStatsDisplayContent(statKey, entite, statValue, { nestedHelper = false, includeHelper = true } = {}) {
    // An explicit preview value must not bypass an inactive Umbra.
    if (isUmbraRestricted(entite, statKey)) statValue = 0;
    const key = normalizeStatKey(statKey);
    if (!includeHelper && (stats.some(stat => stat.key === key && stat.nature === 'umbra')
      || ['strength', 'intelligence', 'agility'].includes(key))) {
      const value = statValue ?? getSafe(entite, key, 0);
      return { displayValue: key === 'movement' ? getMovementValue(entite)
        : balanceData.generatedUmbraStats.sources[key] ? Math.max(0, Number(value) || 0) : value,
        helpContent: '', ambianceContent: '' };
    }
    let result = {
        pointLimitText: includeHelper ? describeStatPointLimit(getDirectingStatResult(entite, key)) : '',
        displayValue: statValue,
        reductionPercent: 0,
		vitalityBonus: 0,
		HpRegenBonus: 0,     
		HpRegenAmount: 0,   
		vitalityValue: 0,
		maxHPValue: 0,
		HpRegenCalc: "",
		hasteValue: 0,
		hastePercent: null,
		hasteIntelRatio: null,
		hastePreparation: null,
		hasteCDReduc: null,
		hasteRecupReduc: null,
		hasteExecutionReduc: null,
		hasteProjectilSpeed: null,
		attackCooldownReducTotal: 0,
attackCooldownReducBase: 0,
attackCooldownReducHaste: 0,
attackCooldownReducOther: 0,

attackPreparationReducTotal: 0,
attackPreparationReducBase: 0,
attackPreparationReducHaste: 0,
attackPreparationReducOther: 0,

attackExecutionReducTotal: 0,
attackExecutionReducBase: 0,
attackExecutionReducHaste: 0,
attackExecutionReducOther: 0,

attackRecoveryReducTotal: 0,
attackRecoveryReducBase: 0,
attackRecoveryReducHaste: 0,
attackRecoveryReducOther: 0,

attackProjectileSpeedTotal: 0,
attackProjectileSpeedBase: 0,
attackProjectileSpeedHaste: 0,
attackProjectileSpeedOther: 0,
		dayHpRegenBase: 0,         
		dayHpRegenFromVitality: 0,  
		dayHpRegenTotal: 0,        
        armorBonus: 0,
        armorCalculation: null,
        velocityBonus: 0,
		velocityReductionPercent: 0,
		velocityAdjustedSpeedMs: 0,
		displayValueMs:0,
        dodgeBonus: 0,
        precisionBonus: 0,
        indestructibilityBonus: 0,
hpBattleRegenBase: 0,
hpBattleRegenStrengthRatio: 0,
hpBattleRegenIndestructibilityRatio: 0,
hpBattleRegenPercent: 0,
        esoterismBonus: 0,
        astralityBonus: 0,
		bloodFuryBloodThirstyBonus: 0,
		bloodFuryBloodThirstyFlatBonus: 0,
		bloodFuryBloodThirstyBfRatioBonus: 0,
		bloodFuryBloodThirstyStrengthRatioBonus: 0,
       	bloodThirstyLifestealBonus: 0,
		bloodThirstyValue: 0,
        bloodFuryBfRatioBonus: 0,
        bloodFurySRatioBonus: 0,
        bloodFuryExecutionBonus: 0,
        bloodFuryExecSRatioBonus: 0,
        bloodFuryExecChanceBonus: 0,
        bloodFuryExecSRatio: 0,
        bloodFuryExecDamage: 0,
		bloodFuryExecutionChanceTotal: 0,
bloodFuryExecutionChanceFlat: 0,
bloodFuryExecutionChancePower: 0,
bloodFuryExecutionChanceStrength: 0,

bloodFuryExecutionDamageTotal: 0,
bloodFuryExecutionDamageFlat: 0,
bloodFuryExecutionDamagePercent: 0,
bloodFuryExecutionDamagePhysical: 0,
bloodFuryExecutionDamageStrengthRatio: 0,

bloodFuryTargetThresholdTotal: 0,
bloodFuryTargetThresholdFlat: 0,
bloodFuryTargetThresholdBase: 0,
bloodFuryTargetThresholdStrength: 0,

bloodThirstyTotal: 0,
        physicPenBonus: 0,
        magicPenBonus: 0,
		magicalBaseValue: 0,
		calculateMagicalTotalValue: 0,
        ambidextryBonus: 0,
        ambidextryProcBonus: 0,
        ambidextryAgiChance: 0,
        ambidextryTotalChance: 0,
        ambidextryRatioBonus: 0,
        ambidextryAgiRatioBonus: 0,
        ambidextryDamageBonus: 0,
        critChanceBonus: 0,
        critAgiChanceBonus: 0,
        critTotalChance: 0,
        critRatioBonus: 0,
        critAgiRatioBonus: null,
        critDamageBonus: null,
		resilienceBonus: 0,
		will :0,
		transcendenceExBonus :0,
		transcendenceConsoProtectionPercent: 0,
		extraLifeDisplay: null, 
		extraLifeCurrent: 0,  
		extraLifeMax: 0,    
		calculateRangeRatioBase: 0,
		calculateRangeRatioTotal: 0,
		rangeTranspiercingAccuracyBonus: 0,
		rangeTranspiercingAccuracyTotal: 0,
		transpiercingDamageBonus: 0,
		transpiercingPowerTotal: 0,
		transpiercingPowerPiercing: 0,
		transpiercingPowerAgility: 0,
		transpiercingPowerRatio: 0,
		meleeExecBaseBonus: null,
		meleeExecHasteReduc: null,
		meleeExecStrengthBonus: null,
		meleeExecTotalReduc: null,
		piercingRecupBaseBonus: null,
		piercingRecupHasteReduc: null,
		piercingRecupAgiBonus: null,
		piercingRecupTotalReduc: null,	
		psionicPercantBonus: null,
		psionicBonus: 0,
		psionicPMBonus: 0,
		psionicTotalBonus: 0,
		psionicMagicalPower: 0,
		mysticismValue: 0,
		mysticismBaseProcChance: 0,
		mysticismIntelProcChance: 0,
		mysticismProcChance: 0,
		mysticismBaseTranceDuration: 0,
		mysticismIntelTranceDuration: 0,
		mysticismTranceDuration: 0,
		mysticismBasePreparationAcceleration: 0,
		mysticismIntelPreparationAcceleration: 0,
		mysticismPreparationAcceleration: 0,
		mysticismBaseDamageBonus: 0,
		mysticismIntelDamageBonus: 0,
		mysticismDamageBonus: 0,
		equilibreValue: 0,
		equilibreBaseAggroReduction: 0,
		equilibreIntelAggroReduction: 0,
		equilibreAggroReduction: 0,
		equilibreBaseInvisibleDetection: 0,
		equilibreAgiInvisibleDetection: 0,
		equilibreInvisibleDetection: 0,
		equilibreBaseBalancedAttackChance: 0,
		equilibreIntelBalancedAttackChance: 0,
		equilibreBalancedAttackChance: 0,
		occultismValue: 0,
		occultismBaseInvisibilityChance: 0,
		occultismAgiInvisibilityChance: 0,
		occultismInvisibilityChance: 0,
		occultismBaseTargetableChance: 0,
		occultismAgiTargetableChance: 0,
		occultismTargetableChance: 0,
		occultismBaseDodgeBonus: 0,
		occultismAgiDodgeBonus: 0,
		occultismDodgeBonus: 0,
		occultismBaseCritChanceBonus: 0,
		occultismAgiCritChanceBonus: 0,
		occultismCritChanceBonus: 0,
		occultismShadowFragilityPercent: 0,
		occultismTargetableChanceDisplay: 0,
		occultismPreparationSpeedDebuff: 0,
		marathonChance: 0,
		marathonBaseChance: 0,
		marathonMovementBonus: 0,
		marathonOtherBonus: 0,
		trailerChance: 0,
		trailerBaseChance: 0,
		trailerMovementBonus: 0,
		trailerOtherBonus: 0,
		movementValue: 0,
		movementMaxCharges: 0,
		movementStartingBasePercent: 0,
		movementStartingAgiRatioCurrent: 0,
		movementStartingTotalCurrent: 0,
		movementMarathonChance: 0,
		movementTrailerChance: 0,
		movementStartingCharges: 0,
		shiftCurrent: 0,
		shiftMax: 0,
		shiftHasDefaultBase: false,
		shiftBaseMax: 0,
		shiftMovementMaxBonus: 0,
		shiftOtherMaxBonus: 0,
		shiftBaseCurrent: 0,
		shiftMovementCurrentBonus: 0,
		shiftOtherCurrentBonus: 0,
		shiftWeightScore: 0,
		shiftWeightClass: "",
		shiftWeightLabel: "",
		shiftWeightMalus: 0,
		weaponMasteryChargeBonus: 0,
		weaponMasteryChargeBrutRatioBonus: 0,
		weaponMasteryChargeStrengthRatioBonus: 0,
		weaponCollectorChance: 0,
		weaponCollectorBase: 0,
		weaponCollectorOtherBonus: 0,
		weaponOrfevreBonus: 0,
		weaponOrfevreWeaponMastery: 0,
		weaponOrfevreStrength: 0,
		weaponOrfevreChance: 0,
		weaponOrfevreBase: 0,
		weaponOrfevreOtherBonus: 0,
		weaponOrfevreStuffActiveBonus: 0,
		weaponMasteryTrophyChance: 0,
		weaponMasteryTrophyWeaponMasteryBonus: 0,
		weaponMasteryTrophyStrengthBonus: 0,
		chargeEquipmentSlots: 0,
        helpContent: "",
		ambianceContent: "",
    };

const safe = (path, fallback = 0) => getSafe(entite, path, fallback);
const autonomousInput = key => {
  const row = getStatSystemResult(entite, key);
  return row ? row.normal + row.plusApplied : Number(safe(key, 0)) || 0;
};
const canonicalStatKey = normalizeStatKey(statKey);
if (canonicalStatKey === "orfevre-detail") {
  const detail = statValue && typeof statValue === "object" ? statValue : {};
  const detailStat = normalizeStatKey(detail.stat || "");

  result.orfevreDetail = {
    stat: detailStat,
    visualStat: getDisplayStatKey(detailStat || "weaponOrfevre"),
    label: detail.label || detailStat || "Statistique",
    raw: detail.raw ?? 0,
    exactBonus: detail.exactBonus ?? 0,
    bonus: detail.bonus ?? 0,
    exactTotal: detail.exactTotal ?? 0,
    total: detail.total ?? detail.exactTotal ?? 0,
    activePercent: Number(detail.activePercent) || 0,
    preview: Boolean(detail.preview),
    previewDetail: detail.previewDetail || null,
  };

  result.displayValue = result.orfevreDetail.total;
}
const generatedUmbraTarget = getGeneratedUmbraTargetDetail(entite, canonicalStatKey, statValue);
if (generatedUmbraTarget) {
  result.generatedUmbraTarget = generatedUmbraTarget;
  result.displayValue = generatedUmbraTarget.finalValue;
}

const generatedUmbraSource = getGeneratedUmbraStatDetail(entite, canonicalStatKey, statValue);
if (generatedUmbraSource) {
  result.generatedUmbraSource = generatedUmbraSource;
  result.displayValue = generatedUmbraSource.sourceValue;
}
 // === HP ===
 const getMaxHP = () => {
  const hpMax = safe("HP.max", null);
  if (hpMax != null) return toNumber(hpMax, 0);
  return toNumber(safe("maxHP", 0), 0);
};
if (statKey === "HP") {
  const hp = safe("HP", null);
  if (hp && typeof hp === "object") {
    result.displayValue = `HP : ${hp.current}/${hp.max}`;
  }
}
// === Extra Life  ===
if (statKey === "extraLife") {
  const ex = safe("extraLife", null); // preview.total -> stats -> baseStats

  result.extraLifeCurrent =
    (ex && typeof ex === "object" && typeof ex.current === "number") ? ex.current : 0;

  result.extraLifeMax =
    (ex && typeof ex === "object" && typeof ex.max === "number") ? ex.max : 0;

  const maxOnly = (result.extraLifeMax > 0) ? String(result.extraLifeMax) : null;
  result.displayValue = maxOnly;
  result.extraLifeDisplay = maxOnly;

  const resurrect = calculateExtraLifeResurrect(entite);
  result.extraLifeResurrectHP = resurrect.restoredHP;
  result.extraLifeResurrectPercentTotal = resurrect.totalPercent;
  result.extraLifeResurrectPercentIntel = resurrect.intelPercent;
  result.extraLifeResurrectPercentRaw = resurrect.rawPercent;
  result.extraLifeMaxHP = resurrect.maxHP;
}

// === Transcendence ===
if (statKey === "transcendence") {
  const value = statValue ?? safe("transcendence");
  result.transcendenceExBonus = calculateTranscendenceExtraLife(value);
  result.transcendenceConsoProtectionBase = transcendenceConsoProtection(value);
  result.transcendenceConsoIntelBonus = transcendenceConsoIntel(entite);
  result.transcendenceConsoProtectionPercent = calculateTranscendenceUmbraProtection(entite);
}
// === Résistances ===
if (["physicalResistance", "magicalResistance"].includes(canonicalStatKey)) {
  const value = Number(statValue ?? safe(canonicalStatKey, 0)) || 0;
  result.reductionPercent = calculateResistanceReductionPercent(value);
  result.displayValue = result.reductionPercent; // cohérent UI
}
// === Pénétrations ===
if (canonicalStatKey === "physicalPen") {
  const value = Number(statValue ?? safe("physicalPen", 0)) || 0;
  result.physicPenBonus = calculatePenetrationPercent(entite, "physicalPen", value);
}
if (canonicalStatKey === "magicalPen") {
  const value = Number(statValue ?? safe("magicalPen", 0)) || 0;
  result.magicPenBonus = calculatePenetrationPercent(entite, "magicalPen", value);
}
// === Vitalité ===
if (statKey === "vitality") {
  const value = toNumber(statValue ?? safe("vitality", 0), 0);
  result.vitalityValue = value;
  result.vitalityBonus = calculateVitalityBonus(value);
  const maxHP = getMaxHP();
  result.maxHPValue = maxHP;
  result.HpRegenBonus = calculateVitalityRegenPercent(value);
  result.HpRegenAmount = calculateVitalityRegenAmount(maxHP, result.HpRegenBonus);
}
// === dayHpRegen ===
if (statKey === "dayHpRegen") {
  const base = BaseDayHpRegen(entite);
  result.dayHpRegenBase = base;
  const vitality = toNumber(safe("vitality", 0), 0);
  const maxHP = getMaxHP();
  const regenPercent = calculateVitalityRegenPercent(vitality);
  const bonus = calculateVitalityRegenAmount(maxHP, regenPercent);
  result.dayHpRegenFromVitality = bonus;
  result.dayHpRegenTotal = calculateTotalRegenAmount(base, bonus);
  result.displayValue = result.dayHpRegenTotal;
}
// === Robustesse ===
if (statKey === "robustness") {
    const value = statValue ?? safe("robustness");
    result.armorCalculation = calculateRobustnessArmorDetails(value, safe('strength'));
    result.armorBonus = result.armorCalculation.armor;
}
// === Weapon Mastery ===
if (statKey === "weaponMastery") {
  const value = Number(statValue ?? safe("weaponMastery", 0)) || 0;

  result.weaponMasteryChargeBrutRatioBonus = calculateWeaponMasteryCharge(entite, value);
  result.weaponMasteryChargeStrengthRatioBonus = value > 0 ? weaponMasteryChargeStrenghtRatioBonus(entite) : 0;
  result.weaponMasteryChargeBonus = calculateWeaponMasteryTotalChargeBonus(entite, value);

  result.weaponOrfevreWeaponMastery = calculateWeaponOrfevreWeaponMastery(entite, value);
  result.weaponOrfevreStrength = calculateWeaponOrfevreStrength(entite);
  result.weaponOrfevreBonus = calculateWeaponOrfevreBonus(entite);
  result.weaponMasteryTrophyChance = calculateWeaponMasteryTotalTrophyChance(entite, value);
  result.weaponMasteryTrophyWeaponMasteryBonus = calculateWeaponMasteryTrophyChance(entite, value);
result.weaponMasteryTrophyStrengthBonus = value > 0 ? calculateWeaponMasteryTrophyStrengthBonus(entite) : 0;
}

// === Orfèvre armurier ===
if (statKey === "weaponOrfevre") {
  const value = Number(statValue ?? safe("weaponOrfevre") ?? 0);
  const previewStuffActive = Number(
    entite?.modifierStats?.preview?.meta?.derived?.stuffWeaponOrfevre?.activePercent
  );
  const durableStuffActive = Number(
    entite?.modifierStats?.durable?.stuff?.orfevre?.activePercent
  );

  result.weaponOrfevreChance = value;
  result.weaponOrfevreBase = Number(entite?.baseStats?.weaponOrfevre || 0);
  result.weaponOrfevreStuffActiveBonus = Number.isFinite(previewStuffActive)
    ? previewStuffActive
    : Number.isFinite(durableStuffActive)
      ? durableStuffActive
      : value;

  // Apport global de weaponMastery, sans détail des ratios
  result.weaponOrfevreWeaponMastery = Number(calculateWeaponOrfevreBonus(entite) || 0);

  result.weaponOrfevreOtherBonus = Math.max(
    0,
    result.weaponOrfevreChance -
      result.weaponOrfevreBase -
      result.weaponOrfevreWeaponMastery
  );

  result.weaponOrfevreBonus = result.weaponOrfevreChance;
}
// === Collectionneur de guerre ===
if (statKey === "weaponCollector") {
  const value = Number(statValue ?? safe("weaponCollector") ?? 0);

  result.weaponCollectorChance = value;
  result.weaponCollectorBase = Number(entite?.baseStats?.weaponCollector || 0);

  // Apport global de weaponMastery, sans détail des ratios
  result.weaponMasteryTrophyWeaponMasteryBonus = Number(calculateWeaponMasteryTotalTrophyChance(entite) || 0);

  result.weaponCollectorOtherBonus = Math.max(
    0,
    result.weaponCollectorChance -
      result.weaponCollectorBase -
      result.weaponMasteryTrophyWeaponMasteryBonus
  );

  result.weaponMasteryTrophyChance = result.weaponCollectorChance;
}
if (statKey === "charge") {
  const value = Number(statValue ?? safe("charge", 0)) || 0;
  const weaponMasteryValue = Number(safe("weaponMastery", 0)) || 0;

  result.chargeEquipmentSlots = calculateChargeEquipmentSlots(entite, value);

  result.weaponMasteryChargeBonus = weaponMasteryValue > 0
    ? calculateWeaponMasteryTotalChargeBonus(entite, weaponMasteryValue)
    : 0;
  result.weaponMasteryChargeBonus = Math.min(
    result.chargeEquipmentSlots,
    Math.max(0, result.weaponMasteryChargeBonus)
  );
}

// === Velocity ===
const vel = Number(safe("velocity", 0)) || 0;
const timingInputs = ['velocity', 'vivacite', 'speed'].includes(statKey) && entite?.baseStats ? getStatSystemInputs(entite, { combat: false }) : null;
const baseSpeedMs = Number(timingInputs?.speed ?? entite?.baseStats?.speed ?? safe("baseStats.speed", safe("speed", 1000))) || 1000;
if (statKey === 'vivacite') {
  const adjustedSpeed = Number(safe('speed', baseSpeedMs));
  result.vivaciteTiming = { baseSpeedMs, ...calculateVelocityReduction(vivaciteResult(entite, 'velocity').value, baseSpeedMs), adjustedSpeed, seconds: adjustedSpeed / 1000 };
}
if (statKey === 'agileRetreat') result.agileRetreatChance = globalThis.umbraProgression.retreatChance(vivaciteResult(entite, 'velocity').value);
if (statKey === "velocity") {
  const v = vel;
  result.displayValue = v;
  if (baseSpeedMs > 0 && v > 0) {
    const { percentage, adjustedSpeed } = calculateVelocityReduction(v, baseSpeedMs);
    result.velocityReductionPercent = Number((percentage ?? 0).toFixed(2));
    result.velocityAdjustedSpeedMs = Number(safe('speed', adjustedSpeed));
    result.velocityTimingAdjustmentMs = result.velocityAdjustedSpeedMs - adjustedSpeed;
  } else {
    result.velocityReductionPercent = 0;
    result.velocityAdjustedSpeedMs = Number(safe('speed', baseSpeedMs));
    result.velocityTimingAdjustmentMs = result.velocityAdjustedSpeedMs - baseSpeedMs;
  }}
// === Speed ===
if (statKey === "speed") {
  const finalSpeedMs = Number(safe("speed", 0)) || 0;
  result.displayValueMs = `${finalSpeedMs} ms`;          // (tu avais "secondes" alors que c’est ms)
  result.displayValue = `${(finalSpeedMs / 1000).toFixed(2)}s`;
}
// === Dodge ===
if (statKey === "dodge") {
  const value = statValue ?? safe("dodge");
  result.dodgeValue = Number(value) || 0;
  result.dodgeBonus = calculateDodgePercent(value);
  result.calculateTotalDodgeBonus = calculateTotalDodgeBonus(entite);
}

// === Precision ===
if (statKey === "precision") {
    const value = statValue ?? safe("precision");
    result.precisionBonus = calculatePrecisionPercent(value);
}
// === Occultisme ===
if (statKey === "occultism") {
  const value = Number(statValue ?? safe("occultism", 0)) || 0;
  result.occultismValue = value;
  result.occultismBaseInvisibilityChance = calculateOccultismBaseInvisibilityChance(entite);
  result.occultismAgiInvisibilityChance = calculateOccultismAgiInvisibilityChance(entite);
  result.occultismInvisibilityChance = calculateOccultismInvisibilityChance(entite);
  result.occultismBaseTargetableChance = calculateOccultismBaseTargetableChance(entite);
  result.occultismAgiTargetableChance = calculateOccultismAgiTargetableChance(entite);
  result.occultismTargetableChance = calculateOccultismTargetableChance(entite);
  result.occultismBaseDodgeBonus = calculateOccultismBaseDodgeBonus(entite);
  result.occultismAgiDodgeBonus = calculateOccultismAgiDodgeBonus(entite);
  result.occultismDodgeBonus = calculateOccultismDodgeBonus(entite);
  result.occultismBaseCritChanceBonus = calculateOccultismBaseCritChanceBonus(entite);
  result.occultismAgiCritChanceBonus = calculateOccultismAgiCritChanceBonus(entite);
  result.occultismCritChanceBonus = calculateOccultismCritChanceBonus(entite);
  result.occultismShadowFragilityPercent = calculateOccultismShadowFragilityPercent(entite);
result.occultismTargetableChanceDisplay = calculateOccultismTargetableChanceDisplay(entite);
result.occultismPreparationSpeedDebuff = calculateOccultismPreparationSpeedDebuff(entite);
  result.displayValue = value;
}

// === Indestructibility ===
if (statKey === "indestructibility") {
  const value = statValue ?? safe("indestructibility");

  result.indestructibilityBonus = calculateIndestructibilityPercentFromEntity(entite);
  result.indestructibilityStrengthReduction = caluclateIndestructibilityStrengthReduction(entite);
  result.indestructibilityReduction = caluclateIndestructibilityReduction(entite);
  result.indestructibilityReductionTotal = caluclateIndestructibilityReductionTotal(entite);

  result.hpBattleRegenBase = calculateHpBattleRegenBase(entite);
  result.hpBattleRegenStrengthRatio = calculateHpBattleRegenStrengthRatio(entite);
  result.hpBattleRegenIndestructibilityRatio = calculateHpBattleRegenIndestructibilityRatio(entite);
  result.hpBattleRegenPercent = calculateHpBattleRegenPercent(entite);
}
// === HP Battle Regen ===
if (statKey === "hpBattleRegen") {
  const value = Number(statValue ?? safe("hpBattleRegen", 0)) || 0;

  result.hpBattleRegenBase = calculateHpBattleRegenBase(entite);
  result.hpBattleRegenStrengthRatio = calculateHpBattleRegenStrengthRatio(entite);
  result.hpBattleRegenIndestructibilityRatio = calculateHpBattleRegenIndestructibilityRatio(entite);
  result.hpBattleRegenPercent = calculateHpBattleRegenPercent(entite);

  result.displayValue = result.hpBattleRegenPercent;
}
// === Esoterism ===
if (statKey === "esoterism") {
  const points = Number(statValue ?? safe("esoterism")) || 0;

  // A) Chance de proc (dépend des points d'ésotérisme)
  result.esoterismBonus = calculateEsoterismChance(entite, points);
  result.esoterismBaseReduction = points > 0 ? calculateEsoterismBaseReduction() : 0;
  result.esoterismAgiReduction = points > 0 ? calculateEsoterismAgiRatio(entite) : 0;
  result.esoterismTotalReduction = points > 0 ? calculateEsoterismtotalReduction(entite) : 0;
}
// === Mysticisme ===
if (statKey === "mysticism") {
  const value = Number(statValue ?? safe("mysticism", 0)) || 0;
  result.mysticismValue = value;
  result.mysticismBaseProcChance = calculateMysticismBaseProcChance(entite);
  result.mysticismIntelProcChance = calculateMysticismIntelProcChance(entite);
  result.mysticismProcChance = calculateMysticismProcChance(entite);
  result.mysticismBaseTranceDuration = calculateMysticismBaseTranceDuration(entite);
  result.mysticismIntelTranceDuration = calculateMysticismIntelTranceDuration(entite);
  result.mysticismTranceDuration = calculateMysticismTranceDuration(entite);
  result.mysticismBasePreparationAcceleration = calculateMysticismBasePreparationAcceleration(entite);
  result.mysticismIntelPreparationAcceleration = calculateMysticismIntelPreparationAcceleration(entite);
  result.mysticismPreparationAcceleration = calculateMysticismPreparationAcceleration(entite);
  result.mysticismBaseDamageBonus = calculateMysticismBaseDamageBonus(entite);
  result.mysticismIntelDamageBonus = calculateMysticismIntelDamageBonus(entite);
  result.mysticismDamageBonus = calculateMysticismTotalDamageBonus(entite);
  result.displayValue = value;
}
// === Équilibre ===
if (statKey === "equilibre") {
  const value = Number(statValue ?? safe("equilibre", 0)) || 0;
  result.equilibreValue = value;
  result.equilibreBaseAggroReduction = calculateEquilibreBaseAggroReduction(entite);
  result.equilibreIntelAggroReduction = calculateEquilibreIntelAggroReduction(entite);
  result.equilibreAggroReduction = calculateEquilibreAggroReduction(entite);
  result.equilibreBaseInvisibleDetection = calculateEquilibreBaseInvisibleDetection(entite);
  result.equilibreAgiInvisibleDetection = calculateEquilibreAgiInvisibleDetection(entite);
  result.equilibreInvisibleDetection = calculateEquilibreInvisibleDetection(entite);
  result.equilibreBaseBalancedAttackChance = calculateEquilibreBaseBalancedAttackChance(entite);
  result.equilibreIntelBalancedAttackChance = calculateEquilibreIntelBalancedAttackChance(entite);
  result.equilibreBalancedAttackChance = calculateEquilibreAttackChance(entite);
  result.displayValue = value;
}
// === Magic Damage ===
if (statKey === "magicalDamage") {
  const base = Number(statValue ?? safe("magicalDamage", 0)) || 0;
  const total = Math.round(base);

  result.magicalBaseValue = base;
  result.calculateMagicalTotalValue = total;
  result.displayValue = total;
}
// === Hypercognition ===
if (statKey === "hypercognition") {
    const value = statValue ?? safe("hypercognition", 0);
    result.hypercognitionValue = value; 
    result.hypercognitionIntel = Number(safe("intelligence", 0)) || 0;
    result.hypercognitionRatio = calculateHypercognitionRatio(value);
    result.hypercognitionEssences = calculateHypercognitionEssenceCount(value);
    result.hypercognitionBonus = calculateHypercognitionBonus(entite, value);
    result.hypercognitionEssenceRatio = value > 0 ? result.hypercognitionEssences * 100 / value : 0;
}

// === Haste ===
const buildAutonomousHasteStatDisplay = ({
  key,
  totalProp,
  baseProp,
  hasteProp,
  otherProp,
  hasteCalculator,
  finalCalculator
}) => {
  const total = Number(finalCalculator?.(entite) ?? statValue ?? safe(key) ?? 0) || 0;
  const base = Number(entite?.baseStats?.[key] || 0) || 0;
  const hasteValue = Number(getHastePoints(entite) || 0);
  const hasteBonus = hasteValue > 0 ? Number(hasteCalculator(entite, hasteValue) || 0) : 0;

const cappedTotal = Math.min(ATTACK_TIME_REDUC_CAP, Math.max(0, total));

result[totalProp] = round1(cappedTotal);
result[baseProp] = round1(base);
result[hasteProp] = round1(hasteBonus);
result[otherProp] = round1(Math.max(0, cappedTotal - base - hasteBonus));
};

if (statKey === "haste") {
  const value = toNumber(statValue ?? safe("haste", 0), 0);
  result.hasteValue = value;
  result.hastePercent = calculateHastePercent(value);
  result.hasteIntelRatio = calculateHasteIntelRatio(entite, value);
  result.hastePreparation = calculateHastePrepReduc(entite, value);
  result.hasteCDReduc = calculateHasteCDReduc(entite);
  result.hasteRecupReduc = calculateHasteRecupReduc(entite);
  result.hasteExecutionReduc = calculateHasteExecReduc(entite);
  result.hasteProjectilSpeed = calculateHasteProjectilSpeed(entite);
}
if (statKey === "cooldownTimeDetail") {
  const value = getHastePoints(entite);

  buildAutonomousHasteStatDisplay({
    key: "attackCooldownReduc",
    totalProp: "attackCooldownReducTotal",
    baseProp: "attackCooldownReducBase",
    hasteProp: "attackCooldownReducHaste",
    otherProp: "attackCooldownReducOther",
    hasteCalculator: calculateHasteCDReduc,
    finalCalculator: getFinalAttackCooldownReduc
  });

  result.hasteValue = value;
  result.hasteCDReduc = result.attackCooldownReducHaste;
}

if (statKey === "preparationTimeDetail") {
  const value = getHastePoints(entite);

  buildAutonomousHasteStatDisplay({
    key: "attackPreparationReduc",
    totalProp: "attackPreparationReducTotal",
    baseProp: "attackPreparationReducBase",
    hasteProp: "attackPreparationReducHaste",
    otherProp: "attackPreparationReducOther",
    hasteCalculator: calculateHastePrepReduc,
    finalCalculator: getFinalAttackPreparationReduc
  });

  result.hasteValue = value;
  result.hastePercent = value > 0 ? calculateHastePercent(value) : 0;
  result.hasteIntelRatio = value > 0 ? calculateHasteIntelRatio(entite) : 0;
  result.hastePreparation = result.attackPreparationReducHaste;
}

if (statKey === "executionTimeDetail") {
  const value = getHastePoints(entite);

  buildAutonomousHasteStatDisplay({
    key: "attackExecutionReduc",
    totalProp: "attackExecutionReducTotal",
    baseProp: "attackExecutionReducBase",
    hasteProp: "attackExecutionReducHaste",
    otherProp: "attackExecutionReducOther",
    hasteCalculator: calculateHasteExecReduc,
    finalCalculator: getFinalAttackExecutionReduc
  });

  result.hasteValue = value;

  result.hasteExecutionReduc = result.attackExecutionReducHaste;
  result.meleeExecHasteReduc = result.hasteExecutionReduc;

  result.meleeExecBaseBonus =
    Number(statValue?.reduc?.meleeExecBaseBonus ?? calculateMeleeExecBonus(entite, entite?.currentAttack)) || 0;

  result.meleeExecStrengthBonus =
    Number(
      statValue?.reduc?.meleeExecStrengthBonus ??
      calculateExecStrengthRatio(Number(safe("strength", 0)) || 0)
    ) || 0;

  result.meleeExecTotalReduc =
    Number(
      statValue?.reduc?.totalExecReduc ??
      (
        result.hasteExecutionReduc +
        result.meleeExecBaseBonus +
        result.meleeExecStrengthBonus
      )
    ) || 0;
}

if (statKey === "executionRangeTimeDetail") {
  const value = getHastePoints(entite);

  buildAutonomousHasteStatDisplay({
    key: "attackProjectileSpeed",
    totalProp: "attackProjectileSpeedTotal",
    baseProp: "attackProjectileSpeedBase",
    hasteProp: "attackProjectileSpeedHaste",
    otherProp: "attackProjectileSpeedOther",
    hasteCalculator: calculateHasteProjectilSpeed,
    finalCalculator: getFinalAttackProjectileSpeed
  });

  buildAutonomousHasteStatDisplay({
    key: "attackExecutionReduc",
    totalProp: "attackExecutionReducTotal",
    baseProp: "attackExecutionReducBase",
    hasteProp: "attackExecutionReducHaste",
    otherProp: "attackExecutionReducOther",
    hasteCalculator: calculateHasteExecReduc,
    finalCalculator: getFinalAttackExecutionReduc
  });

  result.hasteValue = value;
  result.hasteExecutionReduc = result.attackExecutionReducHaste;
  result.hasteProjectilSpeed = result.attackProjectileSpeedHaste;
}

if (statKey === "recoveryTimeDetail") {
  const value = getHastePoints(entite);

  buildAutonomousHasteStatDisplay({
    key: "attackRecoveryReduc",
    totalProp: "attackRecoveryReducTotal",
    baseProp: "attackRecoveryReducBase",
    hasteProp: "attackRecoveryReducHaste",
    otherProp: "attackRecoveryReducOther",
    hasteCalculator: calculateHasteRecupReduc,
    finalCalculator: getFinalAttackRecoveryReduc
  });

  result.hasteValue = value;
  result.hasteRecupReduc = result.attackRecoveryReducHaste;

  result.isPiercing = statValue?.reduc?.isPiercing || false;
  result.isTranspiercing = statValue?.reduc?.isTranspiercing || false;

  result.piercingRecupBaseBonus = result.isPiercing
    ? calculatePiercingRecupBonus(entite)
    : 0;

  result.piercingRecupAgiBonus = result.isPiercing
    ? calculatePiercingRecupAgiRatio(entite)
    : 0;

  result.piercingRecupTotalReduc = result.isPiercing
    ? totalPiercingRecupReductionWithAgi(entite)
    : 0;

  result.transpiercingRecupBaseBonus = result.isTranspiercing
    ? calculateTranspiercingRecupBonus(entite)
    : 0;

  result.transpiercingRecupAgiBonus = result.isTranspiercing
    ? calculateTranspiercingRecupAgiRatio(entite)
    : 0;

  result.transpiercingRecupTotalReduc = result.isTranspiercing
    ? totalTranspiercingRecupReductionWithAgi(entite)
    : 0;
}
// === SPEED REDUCTION ALL ===

if (statKey === "cooldownTime" || statKey === "attackCooldownReduc") {
  buildAutonomousHasteStatDisplay({
    key: "attackCooldownReduc",
    totalProp: "attackCooldownReducTotal",
    baseProp: "attackCooldownReducBase",
    hasteProp: "attackCooldownReducHaste",
    otherProp: "attackCooldownReducOther",
    hasteCalculator: calculateHasteCDReduc,
    finalCalculator: getFinalAttackCooldownReduc
  });
}

if (statKey === "preparationTime" || statKey === "attackPreparationReduc") {
  buildAutonomousHasteStatDisplay({
    key: "attackPreparationReduc",
    totalProp: "attackPreparationReducTotal",
    baseProp: "attackPreparationReducBase",
    hasteProp: "attackPreparationReducHaste",
    otherProp: "attackPreparationReducOther",
    hasteCalculator: calculateHastePrepReduc,
    finalCalculator: getFinalAttackPreparationReduc
  });
}

if (statKey === "executionTime" || statKey === "attackExecutionReduc") {
  buildAutonomousHasteStatDisplay({
    key: "attackExecutionReduc",
    totalProp: "attackExecutionReducTotal",
    baseProp: "attackExecutionReducBase",
    hasteProp: "attackExecutionReducHaste",
    otherProp: "attackExecutionReducOther",
    hasteCalculator: calculateHasteExecReduc,
    finalCalculator: getFinalAttackExecutionReduc
  });
}

if (statKey === "recuperationTime" || statKey === "recoveryTime" || statKey === "attackRecoveryReduc") {
  buildAutonomousHasteStatDisplay({
    key: "attackRecoveryReduc",
    totalProp: "attackRecoveryReducTotal",
    baseProp: "attackRecoveryReducBase",
    hasteProp: "attackRecoveryReducHaste",
    otherProp: "attackRecoveryReducOther",
    hasteCalculator: calculateHasteRecupReduc,
    finalCalculator: getFinalAttackRecoveryReduc
  });
}

if (statKey === "projectileTime" || statKey === "projectilSpeed" || statKey === "attackProjectileSpeed") {
  buildAutonomousHasteStatDisplay({
    key: "attackProjectileSpeed",
    totalProp: "attackProjectileSpeedTotal",
    baseProp: "attackProjectileSpeedBase",
    hasteProp: "attackProjectileSpeedHaste",
    otherProp: "attackProjectileSpeedOther",
    hasteCalculator: calculateHasteProjectilSpeed,
    finalCalculator: getFinalAttackProjectileSpeed
  });
}
// === Astrality ===
if (["astrality", "fatalSurvival", "astralCooldown", "astralReturn", "astralBody"].includes(statKey)) {
    const value = statValue ?? safe("astrality");
    result.astralityBonus = calculateAstralityPercent(value);
    result.astralReturn = calculateAstralReturn(entite);
    result.astralBody = calculateAstralBody(entite);
    result.astralUnavailableSeconds = astralCooldownRemaining(entite);
    result.astralCooldown = calculateAstralCooldown(entite);
    result.astralCooldownRemaining = astralCooldownRemaining(entite);
	result.intelAstralityBonus = calculateIntelAstralityRatio(entite);
	result.astralityTotal = calculateAstralityTotal(entite);
}
// === Resilience ===
if (["resilience", "criticalResistance", "alterationResistance", "hindranceResistance", "resilienceTotal"].includes(statKey)) {
    result.resilienceBonus = resilienceResult(entite, 'criticalResistance').base;
    result.resilienceCritBonus = result.resilienceBonus;
    result.resiStrengthCritBonus = calculateResilienceStrengthCritBonus(entite);
    result.resilienceCritTotalBonus = calculateResilienceCritTotalBonus(entite);
    result.resilienceAlteBonus = calculateResilienceAlterationBonus(entite);
    result.resiIntelCritBonus = calculateResilienceIntelligenceAlterBonus(entite);
    result.resilienceAlteTotalBonus = calculateResilienceAlterationTotalBonus(entite);
    result.resilienceHindranceBonus = calculateHindranceResistance(entite);
    result.resilienceCancelBonus = calculateResilienceCancelBonus(entite);
	result.resiStrengthCancelBonus = calculateResilienceStrengthCancelBonus(entite);
	result.resilienceTotalCancelBonus = calculateResilienceTotalCancelBonus(entite);
}
// === Blood Fury ===
if (statKey === "bloodFury") {
    const value = statValue ?? safe("bloodFury");

    result.bloodFuryBfRatioBonus = calculateBloodFuryBFtRatio(value);
    result.bloodFurySRatioBonus = calculateBloodFuryStrengthRatio(safe("strength"));
    result.bloodFuryExecutionBonus = calculateBloodFuryExecutionPercent(entite);
    result.bloodFuryExecutionChanceFlat = Math.max(0, autonomousInput('bloodFuryExecutionChance'));
    result.bloodFuryExecutionChancePower = result.bloodFuryBfRatioBonus;
    result.bloodFuryExecutionChanceStrength = result.bloodFurySRatioBonus;
    result.bloodFuryExecutionChanceTotal = result.bloodFuryExecutionBonus;

    result.bloodFuryExecSRatioBonus = calculateBloodFuryExecStrengthRatio(safe("strength"));
    const bloodFuryTargetThresholdBase = calculateBloodFuryExecChanceBonus(safe("strength"));
    result.bloodFuryExecChanceBonus = calculateBloodFuryTargetThreshold(entite);
    result.bloodFuryExecSRatio = calculateBloodFuryExecutionSRatio(result.bloodFuryExecSRatioBonus ?? 0);
    result.bloodFuryExecDamage = calculateExecutionDamage(entite);
    result.bloodFuryExecutionDamageFlat = Math.max(0, autonomousInput('bloodFuryExecutionDamage'));
    result.bloodFuryExecutionDamageStrengthRatio = result.bloodFuryExecSRatioBonus;
    result.bloodFuryExecutionDamagePercent = result.bloodFuryExecSRatio;
    result.bloodFuryExecutionDamagePhysical = Math.max(0, Number(safe("physicalDamage", 0)) || 0);
    result.bloodFuryExecutionDamageTotal = result.bloodFuryExecDamage;
    result.bloodFuryTargetThresholdFlat = Math.max(0, autonomousInput('bloodFuryTargetThreshold'));
    result.bloodFuryTargetThresholdBase = bloodFuryTargetThresholdBase;
    result.bloodFuryTargetThresholdTotal = calculateBloodFuryTargetThreshold(entite);

    const lifestealActive = Number(safe('bloodFury', 0)) > 0;
    result.bloodFuryBloodThirstyFlatBonus = lifestealActive ? calculateBloodThirstyFlat() : 0;
    result.bloodFuryBloodThirstyBfRatioBonus = lifestealActive ? calculateBloodThirstyBFRatio(value) : 0;
    result.bloodFuryBloodThirstyStrengthRatioBonus = lifestealActive ? calculateBloodThirstyStrengthRatio(safe("strength")) : 0;

    result.bloodFuryBloodThirstyBonus =
        result.bloodFuryBloodThirstyFlatBonus +
        result.bloodFuryBloodThirstyBfRatioBonus +
        result.bloodFuryBloodThirstyStrengthRatioBonus;
}
if (statKey === "bloodFuryExecutionChance") {
  const bloodFury = Math.max(0, Number(safe("bloodFury", 0)) || 0);
  const strength = Math.max(0, Number(safe("strength", 0)) || 0);
  const flat = Math.max(0, Number(safe("bloodFuryExecutionChance", 0)) || 0);

  result.bloodFuryExecutionChanceFlat = flat;
  result.bloodFuryExecutionChancePower =
    bloodFury > 0 ? calculateBloodFuryBFtRatio(bloodFury) : 0;

  result.bloodFuryExecutionChanceStrength =
    bloodFury > 0 ? calculateBloodFuryStrengthRatio(strength) : 0;

  result.bloodFuryExecutionChanceTotal =
    calculateBloodFuryExecutionPercent(entite);
}

if (statKey === "bloodFuryExecutionDamage") {
  const bloodFury = Math.max(0, Number(safe("bloodFury", 0)) || 0);
  const strength = Math.max(0, Number(safe("strength", 0)) || 0);
  const physicalDamage = Math.max(0, Number(safe("physicalDamage", 0)) || 0);
  const flat = Math.max(0, Number(safe("bloodFuryExecutionDamage", 0)) || 0);

  const strengthRatio =
    bloodFury > 0 ? calculateBloodFuryExecStrengthRatio(strength) : 0;

  const executionPercent =
    bloodFury > 0 ? calculateBloodFuryExecutionSRatio(strengthRatio) : 0;

  result.bloodFuryExecutionDamageFlat = flat;
  result.bloodFuryExecutionDamageStrengthRatio = strengthRatio;
  result.bloodFuryExecutionDamagePercent = executionPercent;
  result.bloodFuryExecutionDamagePhysical = bloodFury > 0 ? physicalDamage : 0;
  result.bloodFuryExecutionDamageTotal = calculateExecutionDamage(entite);
}

if (statKey === "bloodFuryTargetThreshold") {
  const bloodFury = Math.max(0, Number(safe("bloodFury", 0)) || 0);
  const flat = Math.max(0, Number(safe("bloodFuryTargetThreshold", 0)) || 0);
  const strength = Math.max(
    0,
    Number(safe("strength", 0)) || 0
  );

  result.bloodFuryTargetThresholdTotal =
    calculateBloodFuryTargetThreshold(entite);

  result.bloodFuryTargetThresholdBase =
    bloodFury > 0 ? calculateBloodFuryExecChanceBonus(strength) : 0;

  result.bloodFuryTargetThresholdFlat = flat;
  result.bloodFuryTargetThresholdStrength = 0;
}
if (statKey === "bloodThirsty") {
  const value = Math.max(
    0,
    Number(statValue ?? safe("bloodThirsty", 0)) || 0
  );

  result.bloodThirstyValue = value;
  result.bloodThirstyLifestealBonus = getBloodThirstyPercent(value);
  result.bloodThirstyTotal = result.bloodThirstyLifestealBonus;
}
// === Ambidextrie ===
if (statKey === "ambidextry") {
    const value = statValue ?? safe("ambidextry");
    result.ambidextryBonus = calculateAmbidextryPercent(value);
    result.ambidextryProcBonus = calculateAmbidextryProcBonus(entite) ?? 0;
    const ambidextryActive = result.ambidextryProcBonus > 0;
    result.ambidextryAgiChance = ambidextryActive ? calculateAmbidextryAgiChance(entite) : 0;
    result.ambidextryTotalChance = calculateAmbidextryTotalChance(entite) ?? 0;
    result.ambidextryRatioBonus = ambidextryActive ? calculateAmbidextryRatioBonus(entite) : 0;
    result.ambidextryAgiRatioBonus = ambidextryActive ? calculateAmbidextryAgiRatioBonus(entite) : 0;
    result.ambidextryDamageBonus = ambidextryActive ? calculateAmbidextryDamageBonus(entite) : 0;
}
// Critical displays use the same direct percentages and attribution as combat.
if (["criticalPower", "criticalChance", "criticalDamage"].includes(statKey)) {
  const chance = criticalResult(entite, 'criticalChance');
  const damage = criticalResult(entite, 'criticalDamage');
  Object.assign(result, {
    critChanceBonus: chance.base, critAgiChanceBonus: chance.bonuses[0]?.value || 0,
    critPowerChanceContribution: chance.umbra > 0 ? chance.generated : 0,
    critTotalChance: chance.value, criticalChanceTotal: chance.value,
    criticalChanceFlat: chance.normalApplied + chance.plusApplied,
    criticalChanceFromPower: chance.umbra > 0 ? chance.generated : 0,
    critRatioBonus: damage.generated, critAgiRatioBonus: 0,
    critPowerDamageContribution: damage.generated,
    critDamageBonus: damage.value, criticalDamageTotal: damage.value,
    criticalDamageNative: damage.fixed, criticalDamageFlat: damage.normalApplied + damage.plusApplied,
    criticalDamageFromPower: damage.generated,
  });
}
// === Volonté ===
if (statKey === "will") {
  const value = statValue ?? safe("will", 0);
  result.willAwakeBonus = calculatewillAwakeBonus(value);
  result.lvlMaxBase   = calculateLvlMaxBaseEntite(entite);
  result.lvlMaxBonus  = calculateLvlMaxBonus(value, { baseMaxLevel: result.lvlMaxBase });
  result.lvlMaxEntite = calculateLvlMaxEntiteWithWill(entite, value);
  Object.assign(result, getWillBonusUI(result.lvlMaxBonus));
}

// === Mouvement ===
if (statKey === "movement") {
  const value = getMovementValue(entite);
  const startingDetails = calculateMovementStartingChargeDetails(entite);

  result.movementValue = value;
  result.movementMaxCharges = calculateMovementMaxCharges(entite);

  result.movementStartingTotalCurrent = startingDetails.totalCurrent;
  result.movementStartingBasePercent = startingDetails.basePercent;
  result.movementStartingAgiRatioCurrent = startingDetails.agiRatioCurrent;

  result.movementStartingChargePercent = startingDetails.totalCurrent;
  result.movementStartingCharges = calculateMovementStartingCharges(entite);
  result.movementMarathonChance = calculateMovementMarathonChance(entite);
result.movementTrailerChance = calculateMovementTrailerChance(entite);
  result.displayValue = value;
}
// === Shift ===
if (statKey === "shift") {
  const startingDetails = calculateMovementStartingChargeDetails(entite);
  result.movementMaxCharges = calculateMovementMaxCharges(entite);
  result.movementStartingTotalCurrent = startingDetails.totalCurrent;
  result.movementStartingBasePercent = startingDetails.basePercent;
  result.movementStartingAgiRatioCurrent = startingDetails.agiRatioCurrent;
  result.movementStartingCharges = calculateMovementStartingCharges(entite);
  const shift = safe("shift", null) ?? {};
  const baseShift = entite?.baseStats?.shift ?? {};
  result.shiftCurrent = Number(shift.current || 0);
  result.shiftMax = Number(shift.max || 0);
  const system = getStatSystemResult(entite, 'shift');
  const startingView = { stats: { movement: result.shiftMax, agility: safe('agility', 0) } };
  result.shiftStartingFixed = !system?.present;
  result.shiftStartingPercent = calculateMovementStartingChargePercent(startingView);
  result.shiftEquipmentCharges = getEquipmentResourceCurrent(entite, 'shift', getWeaponOrfevrePreviewActivePercent(entite));
  result.shiftSupplementalCharges = result.shiftEquipmentCharges
    + Math.max(0, Number(entite.resourceStocks?.shift?.temporary) || 0)
    + Math.max(0, Number(entite.resourceStocks?.shift?.spell) || 0);
  result.shiftNaturalStartingCharges = system?.present ? calculateMovementStartingCharges(startingView) : 0;
  result.shiftStartingCharges = result.shiftNaturalStartingCharges + result.shiftEquipmentCharges;
  result.shiftHasDefaultBase = shift?.baseDefault === true;
  result.shiftBaseMax = result.shiftHasDefaultBase ? 1 : Number(baseShift?.max || 0);
  result.shiftMovementMaxBonus = Number(result.movementMaxCharges || 0);
  result.shiftOtherMaxBonus = result.shiftMax - result.shiftBaseMax - result.shiftMovementMaxBonus;
  result.shiftBaseCurrent = Math.min(result.shiftCurrent, result.shiftBaseMax);
  result.shiftMovementCurrentBonus = Math.min( result.shiftMovementMaxBonus, Math.max(0, result.shiftCurrent - result.shiftBaseCurrent) );
  result.shiftOtherCurrentBonus = Math.max( 0, result.shiftCurrent - result.shiftBaseCurrent - result.shiftMovementCurrentBonus );
}
if (statKey === "weight" || statKey === "shift") {
  const weight = getMovementWeightMalus(entite);
  result.shiftWeightScore = weight.weight;
  result.shiftWeightClass = weight.weightClass;
  result.shiftWeightLabel = weight.label;
  result.shiftWeightMalus = weight.malus;
}
  
// === Marathon ===
if (statKey === "marathon") {
  const value = Number(statValue ?? safe("marathon") ?? 0);

  result.marathonChance = value;
  result.marathonBaseChance = Number(entite?.baseStats?.marathon || 0);
  result.marathonMovementBonus = Number(calculateMovementMarathonChance(entite) || 0);

  result.marathonOtherBonus = Math.max(
    0,
    result.marathonChance - result.marathonBaseChance - result.marathonMovementBonus
  );
}

// === Trailer ===
if (statKey === "trailer") {
  const value = Number(statValue ?? safe("trailer") ?? 0);

  result.trailerChance = value;
  result.trailerBaseChance = Number(entite?.baseStats?.trailer || 0);
  result.trailerMovementBonus = Number(calculateMovementTrailerChance(entite) || 0);

  result.trailerOtherBonus = Math.max(
    0,
    result.trailerChance - result.trailerBaseChance - result.trailerMovementBonus
  );
}
  
// === Range ===
if (statKey === "rangeAttack") {
  result.calculateRangeRatioBase = balanceData.range.ratio.basePercent;
  result.calculateRangeRatioTotal = calculateRangeRatio(entite);

  // // Adresse projectile (attaques physiques à distance)

  // Incantation pétée (attaques magiques à distance)
  result.baseBrokenSpellChance = baseBrokenSpellChance();
  result.intelBrokenSpellChanceReduc = intelBrokenSpellChance(entite);
  result.brokenSpellChanceTotal = calculateBrokenSpellChance(entite);

  result.baseBrokenSpellDamage = baseBrokenSpellDamage();
  result.intelBrokenSpellBaseDamageReduc = intelBrokenSpellBaseDamage(entite);
  result.magicalBrokenSpellDamageBonus = magicalBrokenSpellDamage(entite);
  result.brokenSpellDamageTotal = calculateBrokenSpellDamage(entite);

}
if (statKey === "rangeAttackTranspiercing" || statKey === "transpiercingPower") {
  result.calculateRangeRatioBase = balanceData.range.ratio.basePercent;
  result.calculateRangeRatioTotal = calculateRangeRatio(entite);


  result.transpiercingDamageBonus = transpiercingAgiRatio(entite);
  result.transpiercingPowerPiercing = Math.max(0, Number(getSafe(entite, "piercingDamage", 0)) || 0);
  result.transpiercingPowerAgility = Math.max(0, Number(getSafe(entite, "agility", 0)) || 0);
  result.transpiercingPowerRatio = getAttackNatureRules(entite?.currentAttack).agilityDamageRatio;
  result.transpiercingPowerTotal = transpiercingTotal(entite);
  result.transpiercingRecupBaseBonus = calculateTranspiercingRecupBonus(entite);
  result.transpiercingRecupAgiBonus = calculateTranspiercingRecupAgiRatio(entite);
  result.transpiercingRecupTotalReduc = totalTranspiercingRecupReductionWithAgi(entite);
  result.displayValue = statKey === "transpiercingPower"
    ? result.transpiercingDamageBonus
    : calculateRangeRatio(entite);
}
const isMeleeStat =
  statKey === "meleeAttackPhysical" ||
  statKey === "meleeAttackMagical"  ||
  statKey === "meleeAttackHybridal" ||
  statKey === "meleeAttackPiercing";

const isPiercingStat =
  statKey === "meleeAttackPiercing" ||
  statKey === "rangeAttackPiercing";

// --- COMMUN A TOUTE LA MELEE (exec reduc) ---
if (isMeleeStat) {
  result.meleeExecBaseBonus      = calculateMeleeExecBonus(entite, entite?.currentAttack);
  result.meleeExecHasteReduc     = getFinalAttackExecutionReduc(entite);
  result.meleeExecStrengthBonus  = calculateExecStrengthRatio(safe("strength", 0));
  result.meleeExecTotalReduc     = totalMeleeExecReduction(entite, entite?.currentAttack);
}

// --- ADDITIF SI NATURE piercing (recup reduc) ---
if (isPiercingStat) {
  result.piercingRecupBaseBonus  = calculatePiercingRecupBonus(entite, null);
  result.piercingRecupHasteReduc = calculateHasteRecupReduc(entite); // 0% si haste=0
  result.piercingRecupAgiBonus   = calculatePiercingRecupAgiRatio(entite);
  result.piercingRecupTotalReduc = totalPiercingRecupReductionWithAgi(entite, null);
}
if (statKey === "rangeAttackPhysical") {
	  result.calculateRangeRatioBase = balanceData.range.ratio.basePercent;
  result.calculateRangeRatioTotal = calculateRangeRatio(entite);
	result.ProjectilSpeedPercent = calculateProjectilSpeedPercent(entite);
}
if (statKey === "rangeAttackMagical") { 
  result.baseBrokenSpellChance = baseBrokenSpellChance();
  result.intelBrokenSpellChanceReduc = intelBrokenSpellChance(entite);
  result.brokenSpellChanceTotal = calculateBrokenSpellChance(entite);
	result.ProjectilSpeedPercent = calculateProjectilSpeedPercent(entite);
  result.baseBrokenSpellDamage = baseBrokenSpellDamage();
  result.intelBrokenSpellBaseDamageReduc = intelBrokenSpellBaseDamage(entite);
  result.magicalBrokenSpellDamageBonus = magicalBrokenSpellDamage(entite);
  result.brokenSpellDamageTotal = calculateBrokenSpellDamage(entite);
  
  
  
}
if (statKey === "rangeAttackHybridal") {
	result.ProjectilSpeedPercent = calculateProjectilSpeedPercent(entite);
   	  result.calculateRangeRatioBase = balanceData.range.ratio.basePercent;
  result.calculateRangeRatioTotal = calculateRangeRatio(entite);
	result.ProjectilSpeedPercent = calculateProjectilSpeedPercent(entite);
}
if (statKey === "brokenSpell") {
  result.baseBrokenSpellChance = baseBrokenSpellChance();
  result.intelBrokenSpellChanceReduc = intelBrokenSpellChance(entite);
  result.brokenSpellChanceTotal = calculateBrokenSpellChance(entite);
  result.baseBrokenSpellDamage = baseBrokenSpellDamage();
  result.intelBrokenSpellBaseDamageReduc = intelBrokenSpellBaseDamage(entite);
  result.magicalBrokenSpellDamageBonus = magicalBrokenSpellDamage(entite);
  result.brokenSpellDamageTotal = calculateBrokenSpellDamage(entite);
  result.displayValue = result.brokenSpellChanceTotal;
}
if (statKey === "messedSpell") {
  result.baseBrokenSpellChance = baseBrokenSpellChance();
  result.intelBrokenSpellChanceReduc = intelBrokenSpellChance(entite);
  result.brokenSpellChanceTotal = calculateBrokenSpellChance(entite);
  result.baseBrokenSpellDamage = baseBrokenSpellDamage();
  result.intelBrokenSpellBaseDamageReduc = intelBrokenSpellBaseDamage(entite);
  result.magicalBrokenSpellDamageBonus = magicalBrokenSpellDamage(entite);
  result.brokenSpellDamageTotal = calculateBrokenSpellDamage(entite);
  result.displayValue = result.brokenSpellChanceTotal;
}
// === Psionique ===
if (canonicalStatKey === "psionic") {
  result.psionicPercantBonus = psionicPercantBonus(entite); // total %
  result.psionicBonus = psionicBonus(entite);               // bonus % seul
  result.psionicPMBonus = psionicPMBonus(entite);           // bonus PM
  result.psionicTotalBonus = psionicTotalBonus(entite);     // PM finale
  result.psionicMagicalPower = Math.max(0, calculateMagicalTotal(entite));
  result.displayValue = result.psionicPercantBonus;
}
if (canonicalStatKey === "brutality-old") {
  result.brutalityPercantBonus = brutalityPercantBonus(entite);              // total %
  result.brutalityBonus = brutalityBonus(entite);                            // bonus % seul
  result.brutalityPhysicalPowerBonus = brutalityPhysicalPowerBonus(entite);  // bonus dégâts physiques
  result.brutalityTotalBonus = brutalityTotalBonus(entite);                  // puissance physique finale
  result.brutalityPhysicalPower = Number(safe("physicalDamage", 0) || 0);
  result.displayValue = result.brutalityPercantBonus;
}
if (statKey === "executionMelee") {
  result.meleeExecBaseBonus = calculateMeleeExecBonus(entite);
  result.displayValue = result.meleeExecBaseBonus;
}
if (statKey === "transpiercingDamage") {
  result.hasteRecupReduc = calculateHasteRecupReduc(entite);

  result.transpiercingRecupBaseBonus = calculateTranspiercingRecupBonus(entite);
  result.transpiercingRecupAgiBonus = calculateTranspiercingRecupAgiRatio(entite);
  result.transpiercingRecupTotalReduc = totalTranspiercingRecupReductionWithAgi(entite);

  result.displayValue = result.transpiercingRecupTotalReduc;
}
if (canonicalStatKey === "piercingDamage") {
  result.hasteRecupReduc = calculateHasteRecupReduc(entite);

  result.piercingRecupBaseBonus = calculatePiercingRecupBonus(entite);
  result.piercingRecupAgiBonus = calculatePiercingRecupAgiRatio(entite);
  result.piercingRecupTotalReduc = totalPiercingRecupReductionWithAgi(entite);

  result.displayValue = result.piercingRecupTotalReduc;
}
// Display-only breakdowns. Keep the combat totals above as the source of truth.
result.helperDetails = {
  active: Object.fromEntries(['bloodFury', 'hypercognition', 'indestructibility', 'astrality', 'transcendence', 'resilience', 'weaponMastery', 'ambidextry', 'esoterism']
    .map(key => [key, Number(safe(key, 0)) > 0])),
  sources: {},
};
if (['weaponOrfevre', 'weaponCollector', 'marathon', 'trailer'].includes(statKey)) {
  const total = Number(result[`${statKey}Chance`]) || 0;
  const base = Number(result[`${statKey}BaseChance`] ?? result[`${statKey}Base`]) || 0;
  const enabled = result.helperDetails.active.weaponMastery;
  const generated = statKey === 'weaponOrfevre' ? [
    { stat: 'weaponMastery', value: enabled ? calculateWeaponOrfevreWeaponMastery(entite) : 0 },
    { stat: 'strength', value: enabled ? calculateWeaponOrfevreStrength(entite) : 0 },
  ] : statKey === 'weaponCollector' ? [
    { stat: 'weaponMastery', value: enabled ? calculateWeaponMasteryTrophyChance(entite) : 0 },
    { stat: 'strength', value: enabled ? calculateWeaponMasteryTrophyStrengthBonus(entite) : 0 },
  ] : [{ stat: 'movement', value: Number(result[`${statKey}MovementBonus`]) || 0 }];
  const remainder = total - base - generated.reduce((sum, part) => sum + part.value, 0);
  result.helperDetails.sources[statKey] = [{ stat: statKey, value: base }, ...generated, { stat: statKey, value: remainder }];
}
for (const [prefix, stat] of [
  ['attackCooldownReduc', 'cooldownTime'], ['attackPreparationReduc', 'preparationTime'],
  ['attackExecutionReduc', 'executionTime'], ['attackRecoveryReduc', 'recuperationTime'],
  ['attackProjectileSpeed', 'projectileTime'],
]) {
  const base = Number(result[`${prefix}Base`]) || 0;
  result.helperDetails.sources[prefix] = [
    { stat, value: base },
    { stat, value: (Number(safe(prefix, 0)) || 0) - base },
    { stat: 'haste', value: Number(result[`${prefix}Haste`]) || 0 },
  ];
  const systemTiming = getStatSystemResult(entite, prefix);
  if (systemTiming) {
    result.helperDetails.sources[prefix] = buildStatSystemModel(systemTiming).parts;
    result[`${prefix}Total`] = systemTiming.value;
  }
}
if (["criticalPower", "criticalChance", "criticalDamage"].includes(statKey)) {
  const power = Math.max(0, Number(safe("criticalPower", 0)) || 0);
  result.helperDetails.critical = {
    chanceFlat: Math.max(0, autonomousInput('criticalChance')),
    chancePower: criticalResult(entite, 'criticalChance').base,
    chanceAgility: power > 0 ? calculateCritAgiChanceBonus(entite) : 0,
    damageNative: balanceData.critical.damage.nativeBasePercent,
    damageFlat: Math.max(0, autonomousInput('criticalDamage')),
    damagePower: power > 0 ? calculateCritRatioBonus(entite, power) : 0,
    damageAgility: power > 0 ? calculateCritAgiRatioBonus(entite) : 0,
  };
}
if (["bloodFury", "bloodFuryExecutionDamage"].includes(statKey)) {
  result.helperDetails.executionMultiplier = balanceData.blood.furyExecution.damageMultiplier;
}
if (['hpBattleRegen', 'indestructibility'].includes(statKey)) {
  result.hpBattleRegenModifier = Number(safe('hpBattleRegen', 0)) - result.hpBattleRegenBase
    - result.hpBattleRegenStrengthRatio - result.hpBattleRegenIndestructibilityRatio;
  result.hpBattleRegenAmount = calculateHpBattleRegenAmount(entite);
}
const timingDisplayConfigs = {
  cooldownTimeDetail: ["cooldownTime", "attackCooldownReduc"],
  preparationTimeDetail: ["preparationTime", "attackPreparationReduc"],
  executionTimeDetail: ["executionTime", "attackExecutionReduc"],
  executionRangeTimeDetail: ["projectileTime", "attackExecutionReduc"],
  recoveryTimeDetail: ["recuperationTime", "attackRecoveryReduc"],
};
if (timingDisplayConfigs[statKey]) {
  const [stat, prefix] = timingDisplayConfigs[statKey];
  const attack = entite?.currentAttack || {
    attackRange: [statKey === 'executionRangeTimeDetail' ? 'range' : 'melee'],
    attacknature: [statValue?.reduc?.isTranspiercing ? 'transpiercingDamage'
      : statValue?.reduc?.isPiercing ? 'piercingDamage' : 'physicalDamage'],
  };
  const timings = getEffectiveAttackTimings(attack, entite);
  // The engine clamps each autonomous contribution before combining them.
  const groups = [{ stat: statKey === 'executionRangeTimeDetail' ? 'executionTime' : stat,
    value: result[`${prefix}Total`], parts: result.helperDetails.sources[prefix],
    sources: getStatisticSourceTotals(entite, prefix, result) }];
  if (statKey === 'executionRangeTimeDetail') groups.push({
    stat: 'projectileTime', value: timings.reduc.projectileSpeedReduc,
    parts: result.helperDetails.sources.attackProjectileSpeed,
    sources: getStatisticSourceTotals(entite, 'attackProjectileSpeed', result),
  });
  if (statKey === 'executionTimeDetail') groups.push({
    stat: 'shortRange', value: timings.reduc.meleeExecBaseBonus + timings.reduc.meleeExecStrengthBonus,
    parts: [{ stat: 'shortRange', value: timings.reduc.meleeExecBaseBonus },
      { stat: 'strength', value: timings.reduc.meleeExecStrengthBonus }],
  });
  if (statKey === 'recoveryTimeDetail' && (timings.reduc.isPiercing || timings.reduc.isTranspiercing)) {
    const transpiercing = timings.reduc.isTranspiercing;
    groups.push({ stat: transpiercing ? 'transpiercingDamage' : 'piercingDamage',
      value: timings.reduc.specificRecoveryReduc,
      parts: [{ stat: transpiercing ? 'transpiercingDamage' : 'piercingDamage',
        value: transpiercing ? calculateTranspiercingRecupBonus(entite, attack) : calculatePiercingRecupBonus(entite, attack) },
      { stat: 'agility', value: transpiercing ? calculateTranspiercingRecupAgiRatio(entite) : calculatePiercingRecupAgiRatio(entite) }],
    });
  }
  const bonus = clampPercent(groups.reduce((sum, group) => sum + (Number(group.value) || 0), 0));
  const baseMs = Number(statValue?.baseMs) || 0;
  const calculatedMs = applyReducToMs(baseMs, bonus);
  const minimumMs = statKey === 'executionTimeDetail' && getAttackResolutionFlags(attack).isMelee ? 200 : 0;
  // Attribute only the reduction actually applied, including the shared cap.
  const reductionSources = groups.flatMap(group => {
    if (group.sources) return group.sources;
    let previous = 0;
    return group.parts.map((part, index) => {
      const next = Math.min(group.value, previous + (Number(part.value) || 0));
      const value = next - previous;
      previous = next;
      return { category: index === 0 ? 'fixed' : 'stat', stat: part.stat, value, unit: ' %' };
    });
  });
  let rawReduction = 0;
  const sources = ['umbra', 'fixed', 'stat', 'equipment', 'combat'].flatMap(category =>
    reductionSources.filter(source => source.category === category).map(source => {
      const applied = value => {
        const before = clampPercent(rawReduction);
        rawReduction += Number(value) || 0;
        return Math.round((clampPercent(rawReduction) - before) * 100) / 100;
      };
      if (source.normalValue != null || source.improvedValue != null) {
        const normalValue = applied(source.normalValue);
        const improvedValue = applied(source.improvedValue);
        return { ...source, normalValue, improvedValue, value: normalValue + improvedValue };
      }
      return { ...source, value: applied(source.value) };
    })).filter(source => source.value !== 0);
  sources.push({ category: 'fixed', stat, value: baseMs / 1000, unit: ' s', duration: true });
  result.helperDetails.timing = {
    stat, groups, sources, bonus, cap: ATTACK_TIME_REDUC_CAP, baseMs, calculatedMs, minimumMs,
    effectiveMs: Math.max(minimumMs, calculatedMs),
    preparation: statKey === 'preparationTimeDetail',
  };
}
result.umbraHelperCalculations = !includeHelper ? {} : stats.some(stat => stat.key === canonicalStatKey && stat.nature === 'umbra')
  ? buildUmbraHelperCalculations(canonicalStatKey, entite, statValue, result)
  : buildAutonomousHelperCalculations(canonicalStatKey, entite, result);
if (includeHelper && (canonicalStatKey === 'vision' || canonicalStatKey === 'bullsEye')) {
  const bull = getStatSystemResult(entite, 'bullsEye') || calculateStatSources({}, 'bullsEye');
  result.bullsEyePercent = bull.chancePercent;
  const total = buildStatSystemModel(bull, entite);
  result.umbraHelperCalculations.bullsEyeTotal = total;
  const ability = total.contributions.find(part => part.kind === 'umbra');
  result.umbraHelperCalculations.bullsEyeSource = ability;
}
const system = getStatSystemResult(entite, canonicalStatKey);
if (system) {
  result.statSystem = system;
  const model = buildDisplayedStatModel(system, entite);
  result.displayValue = model.value;
  model.name = stats.find(stat => stat.key === canonicalStatKey)?.name || canonicalStatKey;
  const aliases = {
    physicalDamage: ['generatedUmbraTarget'], magicalDamage: ['generatedUmbraTarget'], piercingDamage: ['generatedUmbraTarget'],
    physicalPen: ['autonomousConversion'], magicalPen: ['autonomousConversion'],
    physicalResistance: ['autonomousConversion'], magicalResistance: ['autonomousConversion'], dodge: ['autonomousConversion'], velocity: ['autonomousConversion'],
    hpBattleRegen: ['hpBattleRegenPercent'], criticalChance: ['critTotalChance'], criticalDamage: ['critDamageBonus'],
    bloodFuryExecutionChance: ['bloodFuryExecutionBonus'], bloodFuryExecutionDamage: ['bloodFuryExecDamage'], bloodFuryTargetThreshold: ['bloodFuryExecChanceBonus'],
  };
  result.umbraHelperCalculations = Object.fromEntries(['autonomousTotal', ...(aliases[canonicalStatKey] || [])].map(key => [key, model]));
  const fields = {
    physicalResistance: ['reductionPercent'], magicalResistance: ['reductionPercent'], physicalPen: ['physicPenBonus'], magicalPen: ['magicPenBonus'],
    dodge: ['calculateTotalDodgeBonus'], velocity: ['velocityReductionPercent'],
    criticalChance: ['criticalChanceTotal', 'critTotalChance'], criticalDamage: ['criticalDamageTotal', 'critDamageBonus'],
    cognitiveExplosion: ['cognitiveExplosionTotal'], cognitiveGenerator: ['hypercognitionEssences'],
    transcendenceTotal: ['transcendenceConsoProtectionPercent'],
    attackPreparationReduc: ['attackPreparationReducTotal'], attackCooldownReduc: ['attackCooldownReducTotal'],
    attackExecutionReduc: ['attackExecutionReducTotal'], attackRecoveryReduc: ['attackRecoveryReducTotal'], attackProjectileSpeed: ['attackProjectileSpeedTotal'],
  };
  for (const field of fields[canonicalStatKey] || []) result[field] = system.value;
  if (system.resistancePoints) result.reductionPercent = system.reductionRatio * 100;
  if (system.dodgePoints) result.calculateTotalDodgeBonus = system.chancePercent;
  result.autonomousTotal = model.value;
}
if (canonicalStatKey === 'shift') {
  if (!system?.present) result.umbraHelperCalculations.autonomousTotal = {
    stat: 'shift', value: result.shiftMax, unit: '',
    parts: [{ stat: 'neutral', value: result.shiftMax, unit: '', fixed: true }],
  };
  result.umbraHelperCalculations.shiftStartingCharges = {
    stat: 'shift', value: result.shiftStartingCharges, unit: '',
    parts: [{ stat: 'shift', value: result.shiftNaturalStartingCharges, unit: '',
      ...(result.shiftStartingFixed ? { fixed: true } : { rounded: true, compact: {
        source: { stat: 'shift', value: result.shiftMax },
        multiplier: { stat: 'agility', value: result.shiftStartingPercent / 100 },
      } }),
    }, ...(result.shiftEquipmentCharges > 0 ? [{ stat: 'shift', value: result.shiftEquipmentCharges, unit: '', fixed: true }] : [])],
  };
}
if (includeHelper) Object.assign(result, buildStatHelperContent({
  nestedHelper,
  result, entite, statKey, statValue, stats, safe,
  balanceData, baseSpeedMs, roundBalance, getAttackPurity, getAttackNatureRules,
  getDisplayStatKey, normalizeStatKey, isUmbraRestricted,
  readUmbraTotal: (key, unit = '') => {
    const system = getStatSystemResult(entite, key);
    const value = getSafe(entite, key, 0);
    const amount = Number(value?.totalMax ?? value?.max ?? value?.current ?? value) || 0;
    if (system) return buildDisplayedStatModel(system, entite);
    return { stat: getDisplayStatKey(key), value: amount, unit,
      parts: [{ stat: getDisplayStatKey(key), value: amount, unit, fixed: true }] };
  },
}));
return result;
}

export function getStatImprovement(entite, statKey, effectKey = '') {
  const key = normalizeStatKey(statKey);
  const system = !effectKey && getStatSystemResult(entite, key);
  if (system) return system.state === 'normal' ? null : { source: system.origin, stat: key, state: system.state };
  const contextual = {
    mysticismPreparationAcceleration: ['mysticism', 'preparationTime'],
    mysticismDamageBonus: ['mysticism', 'mysticism'],
    occultismCritChanceBonus: ['occultism', 'criticalChance'],
    occultismDodgeBonus: ['occultism', 'dodge'],
  }[effectKey];
  if (contextual && Number(getSafe(entite, contextual[0], 0)) > 0) {
    return { source: contextual[0], stat: contextual[1], attribute: contextual[0] === 'mysticism' ? 'intelligence' : 'agility' };
  }
  const generated = Object.entries(balanceData.generatedUmbraStats.sources)
    .find(([, config]) => normalizeStatKey(config.target) === key)?.[0];
  const candidates = generated ? [generated] : ({
    criticalChance: ['criticalPower'], criticalDamage: ['criticalPower'],
    criticalResistance: ['resilience'], alterationResistance: ['resilience'], hindranceResistance: ['resilience'], resilienceTotal: ['resilience'],
    HP: ['vitality'], dayHpRegen: ['vitality'], armor: ['robustness'],
    hpBattleRegen: ['indestructibility'], bloodThirsty: ['bloodFury'],
    bloodFuryExecutionChance: ['bloodFury'], bloodFuryExecutionDamage: ['bloodFury'],
    bloodFuryTargetThreshold: ['bloodFury'], cognitiveExplosion: ['hypercognition'],
    cognitiveGenerator: ['hypercognition'], transcendenceTotal: ['transcendence'],
    extraLife: ['transcendence'], marathon: ['movement'], trailer: ['movement'], shift: ['movement'],
    weaponOrfevre: ['weaponMastery'], weaponCollector: ['weaponMastery'], charge: ['weaponMastery'],
    attackCooldownReduc: ['haste'], attackPreparationReduc: ['haste'], attackExecutionReduc: ['haste'],
    attackRecoveryReduc: ['haste'], attackProjectileSpeed: ['haste'],
  })[key] || [];
  const activeOccultism = ({ dodge: 'occultismInvisible', criticalChance: 'occultismExitCrit' })[key];
  const source = candidates.find(source => Number(getSafe(entite, source, 0)) > 0)
    || (activeOccultism && entite?.battleBoosts?.[key]?.some(boost => boost.source === activeOccultism && Number(boost.value) > 0)
      ? 'occultism' : null);
  const definition = stats.find(stat => stat.key === source);
  return definition ? { source, attribute: ({ force: 'strength', agilite: 'agility' })[definition.attribut] || definition.attribut } : null;
}

// Read-only attribution: Umbras first, then autonomous sources in a stable order.
// Each increment is measured through the existing display/combat calculations.
export function getStatisticSourceTotals(entity, statKey, calculated) {
  const key = normalizeStatKey(statKey);
  if (['strength', 'intelligence', 'agility'].includes(key) && getDirectingStatResult(entity, key)) {
    const durable = entity.modifierStats?.durable || {};
    const views = [
      { category: 'fixed', entity: { ...entity, modifierStats: { durable: {} } } },
      { category: 'stat', entity: { ...entity, modifierStats: { ...entity.modifierStats,
        durable: { ...durable, stuff: { byId: {} }, derived: {} } } } },
      { category: 'equipment', entity }, { category: 'combat', entity },
    ];
    let previous = 0;
    return views.map(view => {
      const total = Number(getStatSystemInputs(view.entity, { combat: view.category === 'combat' })[key]) || 0;
      const value = roundBalance(total - previous, 6);
      previous = total;
      return { category: view.category, value, stat: key, unit: '',
        provenance: getStatInputProvenance(entity, key, '', view.category) };
    }).filter(part => part.value !== 0);
  }
  if (key === 'fadedLife') {
    const state = entity?.resourceStocks?.fadedLife;
    const values = { consumable: state?.consumable || 0, equipment: getEquipmentResourceCurrent(entity, key),
      spell: state?.spell || 0, fixed: state?.natural ?? (Number(entity?.stats?.fadedLife) || 0) };
    return Object.entries(values).filter(([category, value]) => value > 0
      || (category === 'equipment' && Object.keys(state?.stuff || {}).length))
      .map(([category, value]) => ({ category, value, stat: key, unit: '' }));
  }
  if (key === 'eternalLife') {
    const base = Math.max(0, Number(getSafe(entity, key, 0)?.max) - getEquipmentResourceMax(entity, key)) || 0;
    return [{ category: 'fixed', value: base, label: 'Vies éternelles max' },
      { category: 'equipment', value: getEquipmentResourceCurrent(entity, key), label: 'Vies éternelles disponibles' }]
      .filter(source => source.value > 0 || (source.category === 'equipment' && Object.keys(entity?.resourceStocks?.[key]?.stuff || {}).length))
      .map(source => ({ ...source, stat: key, unit: '' }));
  }
  const system = getStatSystemResult(entity, key);
  if (key === 'shift') {
    const capacity = system?.present ? getStatSystemSourceTotals(entity, key)
      : [{ category: 'fixed', value: calculated.shiftMax, stat: key, unit: '' }];
    const reserves = { equipment: getEquipmentResourceCurrent(entity, key, getWeaponOrfevrePreviewActivePercent(entity)),
      consumable: entity.resourceStocks?.shift?.temporary || 0, spell: entity.resourceStocks?.shift?.spell || 0 };
    return [
      ...capacity.map(source => ({ ...source, label: 'Déplacements max', movementKind: 'max' })),
      ...Object.entries(reserves).filter(([category, value]) => value > 0
        || (category === 'equipment' && Object.keys(entity.resourceStocks?.shift?.stuff || {}).length)).map(([category, value]) =>
        ({ category, value, stat: key, unit: '', label: 'Déplacements sup.', movementKind: 'sup' })),
    ];
  }
  if (system && (key !== 'shift' || system.present)) {
    const totals = getStatSystemSourceTotals(entity, key);
    const stocks = key === 'armor' ? entity?.armorLayers?.stuff : key === 'extraLife' ? entity?.resourceStocks?.extraLife?.stuff : null;
    if (!stocks || !Object.keys(stocks).length) return totals;
    // Equipment reserves are consumable stocks, not the original capacity from stat modifiers.
    const remaining = Object.values(stocks).reduce((sum, stock) => sum + Math.max(0, Number(stock.current) || 0), 0);
    const capacity = totals.map(source => {
      if (source.category !== 'equipment' || key !== 'extraLife') return source;
      const stockMax = getEquipmentResourceMax(entity, key);
      const calculation = source.calculations?.normal;
      return { ...source, value: source.value - stockMax, normalValue: (source.normalValue ?? source.value) - stockMax,
        ...(calculation ? { calculations: { ...source.calculations, normal: { ...calculation,
          value: calculation.value - stockMax, parts: [...calculation.parts, { stat: key, value: stockMax, fixed: true, operator: '\u2212' }] } } } : {}) };
    }).filter(source => source.value !== 0);
    return [...capacity.map(source => ({ ...source,
      label: key === 'armor' ? 'Armure max' : 'Vies supplémentaires max' })),
      { category: 'equipment', value: remaining, stat: key, unit: '', remainingStock: true,
        label: key === 'armor' ? 'Armure restante' : 'Vies supplémentaires disponibles' }];
  }
  const timingTotal = ({ attackCooldownReduc: 'attackCooldownReducTotal', attackPreparationReduc: 'attackPreparationReducTotal',
    attackExecutionReduc: 'attackExecutionReducTotal', attackRecoveryReduc: 'attackRecoveryReducTotal',
    attackProjectileSpeed: 'attackProjectileSpeedTotal' })[key];
  const models = calculated.umbraHelperCalculations || {};
  const modelKey = key === 'shift' ? null : ['autonomousConversion', 'generatedUmbraTarget', 'autonomousTotal']
    .find(name => models[name]) || Object.keys(models)[0];
  const model = models[modelKey];
  const sourceModel = models.generatedUmbraTarget || model;
  const isUmbra = stats.some(stat => stat.key === key && stat.nature === 'umbra');
  const unit = model?.unit || (timingTotal ? ' %' : '');
  const outputStat = model?.stat || getDisplayStatKey(key);
  const amounts = { umbra: 0, fixed: 0, stat: 0, equipment: 0, combat: 0 };
  const signed = part => (part.operator === '−' ? -1 : 1) * Number(part.value || 0);
  const constants = (sourceModel?.parts || []).filter(part => part.fixed && part.stat === 'neutral').reduce((sum, part) => sum + signed(part), 0);
  const rounded = value => Math.round((Number(value) || 0) * 100) / 100;
  const sourceUmbra = isUmbra ? key : getStatImprovement(entity, key)?.source;
  const finish = () => Object.entries(amounts).filter(([, value]) => rounded(value) !== 0)
    .map(([category, value]) => ({ category, value: rounded(value), stat: outputStat, unit,
      ...(category === 'equipment' && !isUmbra ? { family: 'fixed' } : {}),
      provenance: category === 'umbra' && sourceUmbra ? getStatInputProvenance(entity, sourceUmbra)
        : ['fixed', 'equipment'].includes(category) && !isUmbra ? getStatInputProvenance(entity, key, unit, category) : [],
      ...(category === 'umbra' && sourceUmbra ? { umbra: sourceUmbra } : {}) }));
  if (isUmbra) {
    if (!model) return [];
    amounts.fixed = constants;
    amounts[Number(getSafe(entity, key, 0)) > 0 ? 'umbra' : 'stat'] = Number(model.value) - constants;
    return finish();
  }
  const nativeKey = ({ cooldownTime: 'attackCooldownReduc', preparationTime: 'attackPreparationReduc',
    executionTime: 'attackExecutionReduc', recuperationTime: 'attackRecoveryReduc', projectileTime: 'attackProjectileSpeed' })[key] || key;
  const nativeParts = key === 'speed' ? [] : (sourceModel?.parts || []).filter(part => part.fixed && normalizeStatKey(part.stat) === key);
  const sourceEntries = nativeParts.length ? nativeParts.flatMap(part => part.sources || []) : getStatContributions(entity, nativeKey);
  const sources = sourceEntries.filter(source => !source.source?.startsWith('Umbra :')
    && source.source !== 'Bonus dérivés' && source.source !== 'Prévisualisation');
  const capacity = value => Number(value?.max ?? value?.current ?? value) || 0;
  const fallback = key === 'weight' ? getMovementWeightMalus(entity).weight : 0;
  const actualRaw = capacity(getSafe(entity, nativeKey, fallback));
  const beforeCombat = capacity(getSafe({ ...entity, battleBoosts: {} }, nativeKey, fallback));
  const initialRaw = nativeParts.length ? actualRaw - nativeParts.reduce((sum, part) => sum + signed(part), 0)
    : key === 'shift' ? Number(calculated.shiftMovementMaxBonus) || 0 : 0;
  const category = source => source.category || (source.combat ? 'combat' : source.equipment ? 'equipment' : source.source === 'Base' ? 'fixed' : 'stat');
  const rawAt = included => {
    const active = sources.filter(source => !source.combat && included.has(category(source)));
    const flat = active.filter(source => source.mode !== 'percent').reduce((sum, source) => sum + Number(source.value || 0), 0);
    const percent = active.filter(source => source.mode === 'percent').reduce((sum, source) => sum + Number(source.value || 0), 0);
    return capacity(getStatBeforeGeneration({ baseStats: { [nativeKey]: initialRaw + flat },
      modifierStats: { durable: { level: { [nativeKey]: { percent } } } } }, nativeKey));
  };
  const all = new Set(['fixed', 'stat', 'equipment']);
  // Preview deltas and otherwise unlabelled autonomous points belong to Stat.
  const remainder = beforeCombat - rawAt(all);
  const readTotal = included => {
    const raw = rawAt(included) + (included.has('stat') ? remainder : 0);
    const original = getSafe({ ...entity, battleBoosts: {} }, nativeKey, 0);
    const value = original && typeof original === 'object' ? { ...original, max: raw, current: Math.min(capacity(original.current), raw) } : raw;
    const view = { ...entity, stats: { ...entity?.stats, ...entity?.modifierStats?.preview?.total, [nativeKey]: value },
      modifierStats: { ...entity?.modifierStats, preview: null },
      battleBoosts: { ...entity?.battleBoosts, [nativeKey]: included.has('combat') ? entity?.battleBoosts?.[nativeKey] || [] : [] } };
    if (!modelKey && !timingTotal) return key === 'weight' ? getMovementWeightMalus(view).weight : capacity(getSafe(view, nativeKey, 0));
    const display = calculateStatsDisplay(key, view, getSafe(view, key, 0));
    return Number(timingTotal ? display[timingTotal] : display.umbraHelperCalculations?.[modelKey]?.value) || 0;
  };
  const included = new Set();
  let previous = rounded(readTotal(included));
  amounts.fixed = Math.min(Math.max(0, previous), Math.max(0, constants));
  amounts[getStatImprovement(entity, key) ? 'umbra' : 'stat'] = previous - amounts.fixed;
  for (const name of ['fixed', 'stat', 'equipment', 'combat']) {
    if (!sources.some(source => category(source) === name)
      && !(name === 'stat' && remainder)
      && !(name === 'combat' && entity?.battleBoosts?.[nativeKey]?.length)) continue;
    included.add(name);
    const next = rounded(readTotal(included));
    amounts[name] += next - previous;
    previous = next;
  }
  return finish();
}

// Autonomous points are added after the Umbra calculation, never fed into its ratios.
function buildAutonomousHelperCalculations(statKey, entite, result) {
  const models = {};
  const read = key => Number(getSafe(entite, key, 0)) || 0;
  const fixed = (stat, value, unit = '') => ({ stat: getDisplayStatKey(stat), value, unit, fixed: true });
  const fromUmbra = source => calculateStatsDisplay(source, entite).umbraHelperCalculations || {};
  const combine = (key, stat, sourceModel, value, autonomous, unit = '') => {
    models[key] = { stat: getDisplayStatKey(stat), value, unit,
      parts: [...(sourceModel?.parts || []), fixed(stat, autonomous, unit)] };
  };
  const token = (stat, value, unit = '', icon = stat) => ({
    stat: getDisplayStatKey(stat), value, unit, icon,
  });
  const coefficient = (stat, value, unit = '') => token(stat, String(Number(value.toPrecision(6))), unit, null);
  const signedPart = (part, value) => ({ ...part, value: Math.abs(value), ...(value < 0 ? { operator: '−' } : {}) });
  if (statKey === 'will') {
    const cfg = balanceData.level.will;
    const value = Number(result.displayValue ?? read('will')) || 0;
    const bonus = result.lvlMaxBonus;
    const parts = [
      fixed('neutral', result.lvlMaxBase),
      signedPart({
        stat: 'will', unit: '', rounded: true,
        curvePreview: {
          current: { points: value, value: bonus },
          maximum: { points: cfg.willCap,
            value: calculateLvlMaxBonus(cfg.willCap, { baseMaxLevel: result.lvlMaxBase }) },
        },
      }, bonus),
    ];
    const granted = entite?.summonOrigin?.type === 'profanation'
      ? Math.max(0, Math.floor(Number(entite.summonOrigin.generatedLevel) || 0)) : 0;
    const grantedBonus = Math.max(0, granted - (result.lvlMaxBase + bonus));
    if (grantedBonus) parts.push({ ...fixed('neutral', grantedBonus), grantedLevel: granted });
    models.levelMaximum = { stat: 'will', value: result.lvlMaxEntite, unit: '', parts,
      maximumReached: result.lvlMaxEntite >= cfg.hardMaxLevel };
  }
  if (statKey === 'speed') {
    const inputs = entite?.baseStats ? getStatSystemInputs(entite, { combat: false }) : entite?.stats || {};
    const base = Number(inputs.speed ?? 1000) || 1000;
    const velocity = vivaciteResult(entite, 'velocity').value;
    const reduction = base && velocity > 0 ? calculateVelocityReduction(velocity, base)
      : { speedReduction: 0, adjustedSpeed: base, percentage: 0 };
    const parts = [
      fixed('neutral', base, ' ms'),
      { stat: 'velocity', value: reduction.speedReduction, unit: ' ms', operator: '−', rounded: true,
        arithmetic: { terms: [
          token('velocity', velocity), '→', coefficient('velocity', reduction.percentage, ' %'), '·',
          token('speed', Math.max(0, Math.round(base)), ' ms'), '×', coefficient('velocity', reduction.percentage, ' %'),
        ] } },
    ];
    const adjustment = read('speed') - (base - reduction.speedReduction);
    if (adjustment) parts.push(signedPart(fixed('speed', adjustment, ' ms'), adjustment));
    models.speedTotal = { stat: 'speed', value: read('speed'), unit: ' ms', parts };
  }
  const generated = result.generatedUmbraTarget;
  if (generated) {
    const source = fromUmbra(generated.source).generatedUmbraSource;
    const total = generated.target === 'magicalDamage' ? result.calculateMagicalTotalValue : generated.finalValue;
    combine('generatedUmbraTarget', generated.target, source, total,
      total - (source?.value || 0));
    const converted = ({
      physicalResistance: result.reductionPercent, magicalResistance: result.reductionPercent,
      physicalPen: result.physicPenBonus, magicalPen: result.magicPenBonus,
      dodge: result.calculateTotalDodgeBonus, velocity: result.velocityReductionPercent,
    })[statKey];
    if (converted != null) models.autonomousConversion = {
      stat: getDisplayStatKey(statKey), value: converted, unit: ' %',
      parts: [{ stat: getDisplayStatKey(statKey), value: total, unit: '',
        curvePreview: { current: { points: total, value: converted } }, rounded: true, outputUnit: ' %' }],
    };
  }
  const sourceMap = {
    criticalChance: 'criticalPower', criticalDamage: 'criticalPower',
    criticalResistance: 'resilience', alterationResistance: 'resilience', hindranceResistance: 'resilience', resilienceTotal: 'resilience',
    bloodFuryExecutionChance: 'bloodFury', bloodFuryExecutionDamage: 'bloodFury',
    bloodFuryTargetThreshold: 'bloodFury', bloodThirsty: 'bloodFury', hpBattleRegen: 'indestructibility',
    shift: 'movement',
  };
  if (sourceMap[statKey]) Object.assign(models, fromUmbra(sourceMap[statKey]));
  const combined = {
    marathon: ['movement', 'movementMarathonChance', result.marathonChance, ' %'],
    trailer: ['movement', 'movementTrailerChance', result.trailerChance, ' %'],
    weaponOrfevre: ['weaponMastery', 'weaponOrfevreBonus', result.weaponOrfevreChance, ' %'],
    weaponCollector: ['weaponMastery', 'weaponMasteryTrophyChance', result.weaponCollectorChance, ' %'],
    charge: ['weaponMastery', 'weaponMasteryChargeBonus', result.chargeEquipmentSlots, ''],
    bloodThirsty: ['bloodFury', 'bloodFuryBloodThirstyBonus', result.bloodThirstyLifestealBonus, ' %'],
    dayHpRegen: ['vitality', 'HpRegenAmount', result.dayHpRegenTotal, ''],
    cognitiveExplosion: ['hypercognition', 'hypercognitionBonus', calculateCognitiveExplosionTotal(entite), ''],
    cognitiveGenerator: ['hypercognition', 'hypercognitionEssences', calculateHypercognitionEssences(entite), ''],
    transcendenceTotal: ['transcendence', 'transcendenceConsoProtectionPercent', calculateTranscendenceConsoProtectionTotal(entite), ' %'],
  }[statKey];
  if (combined) {
    const [source, key, total, unit] = combined;
    const model = fromUmbra(source)[key];
    // New autonomous effects are raw inputs, not already-generated values.
    const autonomous = statKey === 'cognitiveGenerator' ? Math.floor(Math.max(0, read(statKey)))
      : ['cognitiveExplosion', 'transcendenceTotal'].includes(statKey)
        ? read(statKey) : Number(total) - Number(model?.value || 0);
    combine('autonomousTotal', statKey, model, total, autonomous, unit);
    const cap = statKey === 'cognitiveGenerator' ? balanceData.hypercognition.essences.maxCount
      : statKey === 'transcendenceTotal' ? balanceData.transcendence.consoProtection.maxPercent : null;
    models.autonomousTotal.maximumReached = cap != null && total >= cap;
    result.autonomousTotal = total;
    result.displayValue = total;
  }
  if (statKey === 'cognitiveExplosion') {
    result.hypercognitionValue = read('hypercognition');
    result.hypercognitionIntel = read('intelligence');
    result.hypercognitionRatio = calculateHypercognitionRatio(result.hypercognitionValue);
    result.hypercognitionBonus = calculateHypercognitionBonus(entite);
    result.cognitiveExplosionAutonomous = read('cognitiveExplosion');
    result.cognitiveExplosionTotal = calculateCognitiveExplosionTotal(entite);
  }
  const timing = {
    cooldownTime: ['hasteCDReduc', 'attackCooldownReducTotal', 'attackCooldownReduc'],
    preparationTime: ['hastePreparation', 'attackPreparationReducTotal', 'attackPreparationReduc'],
    executionTime: ['hasteExecutionReduc', 'attackExecutionReducTotal', 'attackExecutionReduc'],
    recuperationTime: ['hasteRecupReduc', 'attackRecoveryReducTotal', 'attackRecoveryReduc'],
    projectileTime: ['hasteProjectilSpeed', 'attackProjectileSpeedTotal', 'attackProjectileSpeed'],
  }[statKey];
  if (timing) {
    const [key, total, autonomous] = timing;
    combine('autonomousTotal', statKey, fromUmbra('haste')[key], result[total], read(autonomous), ' %');
  }
  if (statKey === 'HP' || statKey === 'armor' || statKey === 'extraLife') {
    const [source, key] = statKey === 'HP' ? ['vitality', 'vitalityBonus']
      : statKey === 'armor' ? ['robustness', 'armorBonus'] : ['transcendence', 'transcendenceExBonus'];
    const model = fromUmbra(source)[key];
    const value = getSafe(entite, statKey, 0);
    const total = Number(value?.max ?? value) || 0;
    combine('autonomousTotal', statKey, model, total, total - Number(model?.value || 0));
  }
  for (const model of Object.values(models)) {
    model.parts = model.parts.filter(part => part.note !== 'Bonus inactif.');
    const ownParts = model.parts.filter(part => part.stat === getDisplayStatKey(statKey) && part.identity);
    if (ownParts.length) {
      model.parts = model.parts.filter(part => !ownParts.includes(part))
        .concat(ownParts.map(part => fixed(statKey, part.value, part.unit)));
    }
    for (const part of model.parts) {
      if (!part.fixed || part.stat === 'neutral') continue;
      const sourceKey = timing && part.stat === getDisplayStatKey(statKey) ? timing[2] : normalizeStatKey(part.stat);
      part.sources = getStatContributions(entite, sourceKey).filter(source => !source.source.startsWith('Umbra :') && source.source !== 'Bonus dérivés');
      const preview = entite?.modifierStats?.preview?.total?.[sourceKey];
      const capacity = value => Number(value?.max ?? value?.current ?? value) || 0;
      const delta = preview == null ? 0 : capacity(preview) - capacity(entite?.stats?.[sourceKey]);
      if (delta) part.sources.push({ source: 'Prévisualisation', value: delta, mode: 'flat' });
    }
  }
  return models;
}

// Presentation only: values come from the engine; formula tokens describe their inputs.
// Formulas contain no equality sign: discrete contributions and capped totals are authoritative.
function buildUmbraHelperCalculations(statKey, entite, statValue, result) {
  if (!stats.some(stat => stat.key === statKey && stat.nature === 'umbra')) return {};

  const calculations = {};
  const percent = ' %';
  const read = key => Number(getSafe(entite, key, 0)) || 0;
  const current = read(statKey);
  const value = toNumber(statValue ?? current, 0);
  const active = current > 0;
  const token = (stat, value, unit = '') => ({ stat: getDisplayStatKey(stat), value, unit });
  const constant = (value, unit = '') => token('neutral', value, unit);
  const input = (key, value = read(key)) => token(key, value);
  const coefficient = (key, value, unit = '') => ({
    ...token(key, String(Number(value.toPrecision(6))), unit), icon: null,
  });
  const fixedTerm = (value, unit = '') => ({ ...constant(value, unit), icon: null });
  const withArithmetic = (source, terms, minimum) => {
    source.compact = null;
    source.arithmetic = { terms, ...(minimum != null ? { minimum } : {}) };
    return source;
  };
  const withSimpleProduct = (formula, source, multiplier) => Object.assign(formula, { product: { source, multiplier } });
  const bounded = (key, cap, value = read(key)) => ['min(', constant(cap), ',', 'max(', constant(0), ',', input(key, value), ')', ')'];
  const cappedProduct = (key, multiplier, maximum, value = read(key)) => {
    const formula = ['min(', constant(maximum), ',', 'max(', constant(0), ',', input(key, value), ')', '*', token(key, multiplier), ')'];
    return value >= 0 && value * multiplier <= maximum
      ? withSimpleProduct(formula, input(key, value), token(key, multiplier))
      : Object.assign(formula, { limit: { points: multiplier > 0 ? maximum / multiplier : 0, value: maximum }, sourcePoints: value });
  };
  const linear = (key, cap, maximum, value = read(key)) => {
    const formula = [...bounded(key, cap, value), '/', constant(cap), '*', constant(maximum)];
    return value >= 0 && value <= cap
      ? withSimpleProduct(formula, input(key, value), token(key, maximum / cap))
      : Object.assign(formula, { limit: { points: cap, value: maximum }, sourcePoints: value });
  };
  const eased = (key, maximum, cap, power, value = read(key)) => [
    constant(maximum), '*', '(', constant(1), '-', 'pow(', constant(1), '-', '(',
    ...bounded(key, cap, value), '/', constant(cap), ')', ',', constant(power), ')', ')',
  ];
  const part = (stat, contribution, formula, unit = percent, enabled = active) => {
    const visual = getDisplayStatKey(stat);
    const singleInput = formula.length === 1 && typeof formula[0] === 'object';
    const fixed = singleInput && visual === 'neutral';
    const identity = singleInput && visual !== 'neutral' && formula[0].stat === visual;
    const simpleProduct = formula.length === 3 && formula[1] === '*'
      && typeof formula[0] === 'object' && formula[0].stat !== 'neutral' && typeof formula[2] === 'object';
    // Coefficients come only from the formula, never from its rounded contribution.
    // Curves and thresholds without an explicit simple product have no sub-helper yet.
    const product = formula.product ?? (simpleProduct ? { source: formula[0], multiplier: formula[2] }
      : identity ? { source: formula[0], multiplier: token(stat, 1) } : null);
    return {
      stat: visual, value: enabled ? contribution : 0, unit, formula, fixed, identity,
      compact: product ? { source: product.source, multiplier: { ...product.multiplier, unit } } : null,
      ...(formula.limit ? { curvePreview: {
        current: { points: formula.sourcePoints, value: enabled ? contribution : 0 },
        maximum: { ...formula.limit, value: enabled ? formula.limit.value : 0 },
      } } : {}),
      ...(!enabled ? { note: 'Bonus inactif.' } : {}),
    };
  };
  const withMilestones = (source, countAt, maxPoints, maxCount, display = {}) => {
    source.progression = { ...display, current: { points: value, count: source.value }, next: null };
    let low = source.value > 0 ? 1 : 0;
    let high = Math.ceil(maxPoints);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (countAt(middle) >= source.value) high = middle;
      else low = middle + 1;
    }
    source.progression.threshold = low;
    if (source.value < maxCount) {
      // Read the next whole-point milestone from the unchanged gameplay calculator.
      let low = Math.max(1, Math.floor(value) + 1);
      let high = Math.ceil(maxPoints);
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (countAt(middle) > source.value) high = middle;
        else low = middle + 1;
      }
      const count = countAt(low);
      if (low <= Math.ceil(maxPoints) && count > source.value) {
        source.progression.next = { points: low, count };
      }
    }
    return source;
  };
  const withCurvePreview = (source, points, maxPoints, maximum, label = 'Maximum') => {
    source.compact = null;
    source.identity = false;
    source.curvePreview = {
      current: { points, value: source.value },
      maximum: { points: maxPoints, value: source.note ? 0 : maximum }, label,
    };
    return source;
  };
  const roundedCalculations = new Set([
    'generatedUmbraSource', 'armorBonus', 'vitalityBonus', 'HpRegenAmount',
    'hastePreparation', 'hasteCDReduc', 'hasteExecutionReduc', 'hasteRecupReduc', 'hasteProjectilSpeed',
    'precisionBonus', 'indestructibilityBonus', 'indestructibilityReductionTotal',
    'hpBattleRegenPercent', 'esoterismBonus', 'esoterismTotalReduction', 'astralityTotal',
    'mysticismProcChance', 'mysticismTranceDuration', 'mysticismPreparationAcceleration', 'mysticismDamageBonus',
    'equilibreAggroReduction', 'equilibreInvisibleDetection', 'equilibreBalancedAttackChance',
    'occultismInvisibilityChance', 'occultismTargetableChance', 'occultismDodgeBonus', 'occultismCritChanceBonus',
    'critTotalChance', 'critDamageBonus', 'resilienceCritTotalBonus', 'resilienceAlteTotalBonus',
    'ambidextryTotalChance', 'ambidextryDamageBonus', 'bloodFuryExecutionBonus', 'bloodFuryExecDamage', 'bloodFuryBloodThirstyBonus',
    'resilienceTotalCancelBonus', 'hypercognitionBonus', 'hypercognitionEssences',
    'transcendenceExBonus', 'transcendenceConsoProtectionPercent',
    'movementStartingTotalCurrent', 'movementStartingCharges', 'movementMarathonChance', 'weaponMasteryChargeBonus',
    'weaponOrfevreBonus', 'weaponMasteryTrophyChance',
  ]);
  const add = (key, stat, parts, unit = percent, total = result[key], note) => {
    for (const source of parts) {
      source.rounded = roundedCalculations.has(key) && !source.fixed && !source.identity && !source.note;
    }
    calculations[key] = { stat: getDisplayStatKey(stat), value: total, unit, parts };
    if (note) calculations[key].note = note;
    else if (parts.every(source => source.note === 'Bonus inactif.')) calculations[key].note = 'Bonus inactif.';
  };
  const fixedPart = (contribution, unit = percent, enabled = active) =>
    part('neutral', contribution, [constant(contribution, unit)], unit, enabled);
  const capNote = maximum => `Total plafonné à ${maximum} %.`;

  // Keep the first-point branches and the actual exponential/square-root curves.
  const curve = (key, cfg, points = read(key)) => {
    const minimum = cfg.minPercent ?? cfg.minBonus;
    const maximum = cfg.maxPercent ?? cfg.maxBonus;
    if (points === 1) return [constant(cfg.firstPointPercent ?? cfg.firstPointBonus)];
    const growth = cfg.growthDivisor != null
      ? [constant(1), '-', 'exp(', '-', input(key, points), '/', constant(cfg.growthDivisor), ')']
      : cfg.growthK != null
        ? [constant(1), '-', 'exp(', '-', constant(cfg.growthK), '*', '(', input(key, points), '-', constant(1), ')', ')']
        : ['sqrt(', 'max(', constant(0), ',', input(key, points), '-', constant(1), ')', '/', constant(cfg.divisor), ')'];
    return ['min(', constant(maximum), ',', constant(minimum), '+', '(', constant(maximum), '-', constant(minimum), ')', '*', '(', ...growth, ')', ')'];
  };
  const logistic = (x, steepness, midpoint) => [
    constant(1), '/', '(', constant(1), '+', 'exp(', '-', constant(steepness), '*', '(', x, '-', constant(midpoint), ')', ')', ')',
  ];


  if (result.generatedUmbraSource && statKey !== 'vivacite') {
    const detail = result.generatedUmbraSource;
    const total = buildStatSystemModel(getStatSystemResult(entite, detail.target) || detail.system, entite);
    total.name = detail.targetLabel.charAt(0) + detail.targetLabel.slice(1).toLocaleLowerCase('fr');
    const explain = model => ({ ...model, parts: model.parts.map(source => ({ ...source,
      formula: source.compact ? [source.compact.source, '*', source.compact.multiplier] : [token(source.stat, source.value)] })) });
    let ability = total.contributions.find(part => part.kind === 'umbra');
    if (total.system.umbra > 0 && total.system.plus !== 0) {
      // An autonomous Stat+ remains part of the complete capacity shown inside
      // its Umbra. Exclusive attribution is still used for the entity total.
      ability = buildStatSystemModel({ ...total.system, normal: 0, normalApplied: 0,
        value: total.system.enhanced }, entite);
      ability.contributions = ability.contributions.filter(part => part.kind !== 'normal');
      ability.parts[0] = { ...ability.parts[0], state: '+' };
    }
    calculations.generatedUmbraSource = explain(ability);
    calculations[`${detail.target}Total`] = explain(total);
    if (statKey === 'robustness') calculations.armorBonus = explain(total.contributions.find(part => part.kind === 'umbra'));
    return calculations;
  }

  switch (statKey) {
    case 'vitality': {
      const cfg = balanceData.generatedStats.vitalityHp;
      add('vitalityBonus', 'HP', [withCurvePreview(part('vitality', result.vitalityBonus,
        curve('vitality', cfg, value), '', value > 0), value, null, cfg.maxBonus)], '');
      add('HpRegenAmount', 'dayHpRegen', [part('vitality', result.HpRegenAmount, [
        input('HP', result.maxHPValue), '*', token('vitality', result.HpRegenBonus / 100),
      ], '', value > 0)], '');
      break;
    }
    case 'haste': {
      const cfg = balanceData.attackTime.hasteRatios;
      add('hastePreparation', 'haste', [
        withCurvePreview(part('haste', result.hastePercent, curve('haste', balanceData.baseUmbraCurves.haste, value), percent, value > 0),
          value, null, balanceData.baseUmbraCurves.haste.maxPercent),
        part('intelligence', result.hasteIntelRatio, linear('intelligence', cfg.statCap, cfg.intelligencePrepMaxPercent, calculateIntelligence(entite)), percent, value > 0),
      ]);
      for (const [key, source, maximum, sourceValue, enabled] of [
        ['hasteCDReduc', 'intelligence', cfg.intelligenceCooldownMaxPercent, calculateIntelligence(entite), getHastePoints(entite) > 0],
        ['hasteExecutionReduc', 'strength', cfg.strengthExecutionMaxPercent, calculateStrength(entite), getHastePoints(entite) > 0],
        ['hasteRecupReduc', 'agility', cfg.agilityRecoveryMaxPercent, calculateAgility(entite), active],
      ]) add(key, 'haste', [part(source, result[key], linear(source, cfg.statCap, maximum, sourceValue), percent, enabled)]);
      add('hasteProjectilSpeed', 'haste', [withCurvePreview(part('strength', result.hasteProjectilSpeed, [
        '(', constant(1), '/', '(', constant(1), '-', 'min(', constant(cfg.projectileSpeedCapPercent), ',',
        ...linear('strength', cfg.statCap, cfg.strengthExecutionMaxPercent, calculateStrength(entite)), ')', '/', constant(100), ')', '-', constant(1), ')', '*', constant(cfg.projectileSpeedBasePercent),
      ], percent, getHastePoints(entite) > 0), calculateStrength(entite), cfg.statCap,
        calculateHasteProjectilSpeed({ stats: { haste: current, strength: cfg.statCap } }))]);
      break;
    }
    case 'indestructibility': {
      const cfg = balanceData.indestructibility.reduction;
      add('indestructibilityBonus', 'indestructibility', [withCurvePreview(part(statKey, result.indestructibilityBonus,
        curve(statKey, balanceData.baseUmbraCurves.indestructibility)), current, null,
        balanceData.baseUmbraCurves.indestructibility.maxPercent)]);
      add('indestructibilityReductionTotal', 'indestructibility', [
        part(statKey, result.indestructibilityReduction, linear(statKey, cfg.statCap, cfg.indestructibilityMaxPercent)),
        part('strength', result.indestructibilityStrengthReduction, linear('strength', cfg.statCap, cfg.strengthMaxPercent)),
      ]);
      const regen = balanceData.regeneration.battleHp;
      const indFormula = [constant(regen.indestructibilityMinPercent), '+', '(', ...bounded(statKey, regen.indestructibilityCap), '-', constant(1), ')',
        '/', constant(Math.max(1, regen.indestructibilityCap - 1)), '*', '(', constant(regen.indestructibilityMaxPercent), '-', constant(regen.indestructibilityMinPercent), ')'];
      const basePart = part('hpBattleRegen', result.hpBattleRegenBase, ['max(', constant(0), ',', input('hpBattleRegen'), '-',
        '(', token(statKey, result.hpBattleRegenIndestructibilityRatio, percent), '+', token('strength', result.hpBattleRegenStrengthRatio, percent), ')', ')'], percent, true);
      basePart.arithmetic = { minimum: 0, terms: [
        token('hpBattleRegen', Math.max(0, read('hpBattleRegen')), percent), '−',
        token(statKey, result.hpBattleRegenIndestructibilityRatio, percent), '−',
        token('strength', result.hpBattleRegenStrengthRatio, percent),
      ] };
      const modifierPart = part('hpBattleRegen', result.hpBattleRegenModifier, [input('hpBattleRegen'), '-', token('hpBattleRegen', result.hpBattleRegenBase, percent),
        '-', token(statKey, result.hpBattleRegenIndestructibilityRatio, percent), '-', token('strength', result.hpBattleRegenStrengthRatio, percent)], percent, true);
      modifierPart.arithmetic = { terms: [
        token('hpBattleRegen', read('hpBattleRegen'), percent), '−', token('hpBattleRegen', result.hpBattleRegenBase, percent), '−',
        token(statKey, result.hpBattleRegenIndestructibilityRatio, percent), '−', token('strength', result.hpBattleRegenStrengthRatio, percent),
      ] };
      add('hpBattleRegenPercent', 'hpBattleRegen', [
        basePart,
        withCurvePreview(part(statKey, result.hpBattleRegenIndestructibilityRatio, indFormula),
          current, regen.indestructibilityCap, calculateHpBattleRegenIndestructibilityRatio({
            stats: { indestructibility: regen.indestructibilityCap },
          })),
        part('strength', result.hpBattleRegenStrengthRatio, linear('strength', regen.strengthCap, regen.strengthMaxPercent)),
        modifierPart,
      ]);
      break;
    }
    case 'esoterism': {
      const cfg = balanceData.esoterism.reduction;
      const base = balanceData.baseUmbraCurves.esoterism;
      const floor = balanceData.avoidanceFloors.defaultTiers.find(tier => value > 0 && value <= tier.maxPoints)?.floorPercent ?? 0;
      add('esoterismBonus', 'esoterism', [withCurvePreview(part(statKey, result.esoterismBonus, [
        'min(', constant(100), ',', 'max(', constant(floor), ',', ...curve(statKey, base, value), ')', ')',
      ], percent, value > 0), value, 1 + base.divisor, calculateEsoterismChance(entite, 1 + base.divisor))]);
      add('esoterismTotalReduction', 'esoterism', [
        fixedPart(cfg.basePercent, percent, value > 0),
        withCurvePreview(part('agility', result.esoterismAgiReduction, eased('agility', cfg.agilityMaxPercent, cfg.agilityCap, cfg.curvePower), percent, value > 0),
          read('agility'), cfg.agilityCap, calculateEsoterismAgiRatio({ stats: { agility: cfg.agilityCap } })),
      ]);
      break;
    }
    case 'mysticism':
    case 'occultism': {
      const curvedPart = (source, contribution, cfg, maximumField, calculateBonus, unit = percent, divisor = 1) => {
        const cap = cfg[`${source}Target`];
        const sourcePart = part(source, contribution / divisor, eased(source, cfg[maximumField], cap, cfg.curvePower), unit);
        sourcePart.curvePreview = {
          current: { points: read(source), value: sourcePart.value },
          maximum: { points: cap, value: active ? calculateBonus({ stats: { [statKey]: current, [source]: cap } }) / divisor : 0 },
        };
        return sourcePart;
      };
      // Each row binds the existing total, its two engine contributions and its balance curve.
      const rows = statKey === 'mysticism' ? [
        ['mysticismProcChance', 'mysticism', 'mysticismBaseProcChance', 'mysticismIntelProcChance', 'intelligence', balanceData.mysticism.proc, 'baseChancePercent', 'intelligenceMaxBonusPercent', calculateMysticismIntelProcChance],
        ['mysticismTranceDuration', 'mysticism', 'mysticismBaseTranceDuration', 'mysticismIntelTranceDuration', 'intelligence', balanceData.mysticism.trance, 'baseDurationMs', 'intelligenceMaxSeconds', calculateMysticismIntelTranceDuration, ' s', 1000],
        ['mysticismPreparationAcceleration', 'mysticism', 'mysticismBasePreparationAcceleration', 'mysticismIntelPreparationAcceleration', 'intelligence', balanceData.mysticism.preparation, 'baseAccelerationPercent', 'intelligenceMaxBonusPercent', calculateMysticismIntelPreparationAcceleration],
        ['mysticismDamageBonus', 'mysticism', 'mysticismBaseDamageBonus', 'mysticismIntelDamageBonus', 'intelligence', balanceData.mysticism.damage, 'baseBonusPercent', 'intelligenceMaxBonusPercent', calculateMysticismIntelDamageBonus],
      ] : [
        ['occultismInvisibilityChance', 'occultism', 'occultismBaseInvisibilityChance', 'occultismAgiInvisibilityChance', 'agility', balanceData.occultism.invisibility, 'baseChancePercent', 'agilityMaxBonusPercent', calculateOccultismAgiInvisibilityChance],
        ['occultismTargetableChance', 'occultism', 'occultismBaseTargetableChance', 'occultismAgiTargetableChance', 'agility', balanceData.occultism.targetable, 'baseChancePercent', 'agilityMaxBonusPercent', calculateOccultismAgiTargetableChance],
        ['occultismDodgeBonus', 'dodge', 'occultismBaseDodgeBonus', 'occultismAgiDodgeBonus', 'agility', balanceData.occultism.dodge, 'baseBonusPercent', 'agilityMaxBonusPercent', calculateOccultismAgiDodgeBonus, ''],
      ];
      for (const [key, visual, baseKey, bonusKey, source, cfg, baseField, maximumField, calculateBonus, unit = percent, divisor = 1] of rows) {
        const bonusPart = curvedPart(source, result[bonusKey], cfg, maximumField, calculateBonus, unit, divisor);
        if (key === 'occultismTargetableChance') bonusPart.operator = '−';
        add(key, visual, [
          part('neutral', result[baseKey] / divisor, [constant(cfg[baseField] / divisor, unit)], unit),
          bonusPart,
        ], unit, result[key] / divisor);
      }
      if (statKey === 'occultism') {
        const cfg = balanceData.occultism.critical;
        // The critical total uses only agility, even though a base field exists in balanceData.
        add('occultismCritChanceBonus', 'criticalChance', [curvedPart('agility', result.occultismCritChanceBonus,
          cfg, 'agilityMaxBonusPercent', calculateOccultismAgiCritChanceBonus)]);
        add('occultismPreparationSpeedDebuff', 'indiscretion', [fixedPart(balanceData.occultism.drawbacks.preparationSpeedDebuffPercent)]);
        add('occultismShadowFragilityPercent', 'fragility', [fixedPart(balanceData.occultism.drawbacks.shadowFragilityPercent)]);
      }
      break;
    }
    case 'astrality': {
      for (const target of ['fatalSurvival', 'astralBody']) {
        const total = buildStatSystemModel(astralityResult(entite, target), entite);
        calculations[`${target}Total`] = total;
        calculations[target === 'fatalSurvival' ? 'generatedUmbraSource' : 'astralBodySource'] = total.contributions.find(part => part.kind === 'umbra');
      }
      calculations.astralityTotal = calculations.fatalSurvivalTotal;
      const r = result.astralReturn, body = result.astralBody;
      calculations.astralReturnScore = { stat: 'astralReturn', value: r.weight, unit: '', parts: [
        { stat: 'strength', value: r.attributeWeight, compact: { source: { stat: 'strength', value: r.strength }, multiplier: { stat: 'strength', value: r.attributeRatio } } },
      ] };
      const cd = result.astralCooldown;
      calculations.astralCooldownScore = { stat: 'astralCooldown', value: cd.weight, unit: '', parts: [
        { stat: 'agility', value: cd.weight, compact: { source: { stat: 'agility', value: cd.agility }, multiplier: { stat: 'agility', value: cd.attributeRatio } } },
      ] };
      calculations.astralBodyDuration = { stat: 'astralBody', value: body.seconds, unit: ' s', parts: [
        { stat: 'astrality', value: body.seconds, compact: { source: { stat: 'astralBody', value: balanceData.astrality.astralBody.baseDurationSeconds }, multiplier: { stat: 'astrality', value: body.seconds > 0 ? body.ratio : 0 } } },
      ] };
      break;
    }
    case 'bloodFury': {
      const cfg = balanceData.blood.furyExecution;
      add('bloodFuryExecutionBonus', 'bloodFuryExecutionChance', [
        part('bloodFuryExecutionChance', result.bloodFuryExecutionChanceFlat, [input('bloodFuryExecutionChance', result.bloodFuryExecutionChanceFlat)], percent, true),
        withCurvePreview(part(statKey, calculateBloodFuryBFtRatio(current), ['min(', constant(cfg.bloodFuryTotalCapPercent), ',', constant(cfg.bloodFuryBasePercent), '+',
          constant(cfg.bloodFuryMaxBonusPercent), '*', 'sqrt(', input(statKey), '/', constant(cfg.bloodFuryCap), ')', ')']),
          current, cfg.bloodFuryCap, calculateBloodFuryBFtRatio(cfg.bloodFuryCap), 'Repère'),
        part('strength', calculateBloodFuryStrengthRatio(read('strength')), [input('strength', Math.max(0, read('strength'))), '*', constant(cfg.strengthChancePerPoint)]),
      ], percent, result.bloodFuryExecutionBonus, capNote(100));
      add('bloodFuryExecChanceBonus', 'bloodFuryTargetThreshold', [
        part('bloodFuryTargetThreshold', result.bloodFuryTargetThresholdFlat, [input('bloodFuryTargetThreshold', result.bloodFuryTargetThresholdFlat)], percent, true),
        fixedPart(cfg.targetThresholdPercent),
      ], percent, result.bloodFuryExecChanceBonus, capNote(100));
      // The physical term is multiplicative; strength is an input, not extra damage to add twice.
      const strengthRatio = calculateBloodFuryExecStrengthRatio(read('strength'));
      const executionMultiplier = cfg.damageMultiplier * calculateBloodFuryExecutionSRatio(strengthRatio) / 100;
      const generatedDamage = active
        ? executionMultiplier * result.bloodFuryExecutionDamagePhysical : 0;
      add('bloodFuryExecDamage', 'bloodFuryExecutionDamage', [
        part('bloodFuryExecutionDamage', result.bloodFuryExecutionDamageFlat, [input('bloodFuryExecutionDamage', result.bloodFuryExecutionDamageFlat)], '', true),
        part('physicalDamage', generatedDamage, [
          input('physicalDamage', result.bloodFuryExecutionDamagePhysical), '*', token('strength', executionMultiplier),
        ], ''),
      ], '');
      const thirsty = balanceData.blood.thirsty;
      add('bloodFuryBloodThirstyBonus', 'bloodThirsty', [
        fixedPart(thirsty.flatPercent),
        part(statKey, result.bloodFuryBloodThirstyBfRatioBonus, [input(statKey, value), '*', token(statKey, thirsty.bloodFuryMaxPercent / thirsty.bloodFuryCap)]),
        part('strength', result.bloodFuryBloodThirstyStrengthRatioBonus, [input('strength'), '*', token('strength', thirsty.strengthMaxPercent / thirsty.strengthCap)]),
      ]);
      break;
    }
    case 'ambidextry': {
      const cfg = balanceData.ambidextry;
      const base = balanceData.baseUmbraCurves.ambidextry;
      const baseFormula = curve(statKey, base);
      add('ambidextryTotalChance', 'ambidextry', [
        withCurvePreview(part(statKey, result.ambidextryProcBonus, baseFormula), current, null, base.maxPercent),
        part('agility', result.ambidextryAgiChance, [input('agility'), '*', constant(cfg.chanceAgilityPerPointPercent)]),
      ], percent, result.ambidextryTotalChance, capNote(100));
      add('ambidextryDamageBonus', 'ambidextry', [
        fixedPart(cfg.secondHitBaseDamagePercent),
        withCurvePreview(part(statKey, result.ambidextryRatioBonus, ['(', ...baseFormula, ')', '*', constant(cfg.ratioFromBaseChance)]),
          current, null, Math.ceil(base.maxPercent * cfg.ratioFromBaseChance)),
        part('agility', result.ambidextryAgiRatioBonus, [input('agility'), '*', constant(cfg.ratioAgilityPerPointPercent)]),
      ]);
      break;
    }
    case 'criticalPower': {
      for (const [target, alias] of [['criticalChance', 'critTotalChance'], ['criticalDamage', 'critDamageBonus']]) {
        const total = buildStatSystemModel(criticalResult(entite, target), entite);
        calculations[`${target}Total`] = total;
        calculations[alias] = total.contributions.find(part => part.kind === 'umbra');
        if (target === 'criticalChance') calculations.generatedUmbraSource = calculations[alias];
      }
      break;
    }
    case 'vivacite': {
      for (const target of ['velocity', 'controlledSpeed']) {
        const total = buildStatSystemModel(vivaciteResult(entite, target), entite);
        calculations[`${target}Total`] = total;
        calculations[target === 'velocity' ? 'generatedUmbraSource' : 'controlledSpeedSource'] = total.contributions.find(part => part.kind === 'umbra');
      }
      const velocity = vivaciteResult(entite, 'velocity').value;
      const chance = globalThis.umbraProgression.retreatChance(velocity);
      calculations.agileRetreat = { stat: 'agileRetreat', value: chance, unit: ' %', maximumReached: chance >= globalThis.umbraProgression.vivacite.retreat.maxPercent, parts: [
        { stat: 'neutral', value: globalThis.umbraProgression.vivacite.retreat.basePercent, unit: ' %', fixed: true },
        { stat: 'velocity', value: velocity, unit: ' %', fixed: true },
      ] };
      break;
    }
    case 'equilibre': {
      for (const target of ['equilibreAggroReduction', 'equilibreInvisibleDetection', 'equilibreBalancedAttackChance']) {
        const total = buildStatSystemModel(equilibreResult(entite, target), entite);
        calculations[`${target}Total`] = total;
        calculations[target] = total.contributions.find(part => part.kind === 'umbra');
        if (target === 'equilibreAggroReduction') calculations.generatedUmbraSource = calculations[target];
      }
      break;
    }
    case 'resilience': {
      for (const [target, alias] of [['criticalResistance', 'resilienceCritTotalBonus'],
        ['alterationResistance', 'resilienceAlteTotalBonus'], ['hindranceResistance', 'resilienceHindranceBonus'], ['resilienceTotal', 'resilienceTotalCancelBonus']]) {
        const total = buildStatSystemModel(resilienceResult(entite, target), entite);
        calculations[`${target}Total`] = total;
        calculations[alias] = total.contributions.find(part => part.kind === 'umbra');
        if (target === 'criticalResistance') calculations.generatedUmbraSource = calculations[alias];
      }
      break;
    }
    case 'hypercognition': {
      const enabled = value > 0;
      add('hypercognitionBonus', 'hypercognition', [
        part(statKey, value, [input(statKey, value)], '', enabled),
        part('intelligence', result.hypercognitionBonus - value, [input('intelligence'), '*', token(statKey, result.hypercognitionRatio)], '', enabled),
      ], '');
      const cfg = balanceData.hypercognition.essences;
      const h = bounded(statKey, cfg.maxValue, value);
      const essenceFormula = Math.min(cfg.maxValue, Math.max(0, value)) <= cfg.softCap
        ? [constant(1), '+', 'floor(', '(', constant(cfg.softCount), '-', constant(1), ')', '*', '(', ...h, '-', constant(1), ')', '/', '(', constant(cfg.softCap), '-', constant(1), ')', ')']
        : [constant(cfg.softCount), '+', 'floor(', '(', constant(cfg.maxCount), '-', constant(cfg.softCount), ')', '*', '(', ...h, '-', constant(cfg.softCap), ')', '/', '(', constant(cfg.maxValue), '-', constant(cfg.softCap), ')', ')'];
      const essencePart = part(statKey, result.hypercognitionEssences, essenceFormula, '', value >= 1);
      add('hypercognitionEssences', 'hypercognition', [withMilestones(essencePart,
        calculateHypercognitionEssenceCount, cfg.maxValue, cfg.maxCount,
        { stat: 'hyperco', icon: 'essence-hyperco' })], '');
      break;
    }
    case 'transcendence': {
      const cfg = balanceData.generatedStats.transcendenceExtraLife;
      const lifePart = part(statKey, result.transcendenceExBonus, value >= cfg.capPoints
        ? [constant(cfg.maxExtraLife)]
        : ['min(', constant(cfg.maxExtraLife - 1), ',', 'max(', constant(1), ',', constant(cfg.maxExtraLife), '*', 'pow(', input(statKey, Math.max(0, value)), '/', constant(cfg.capPoints), ',', constant(cfg.exponent), ')', ')', ')'], '', value > 0);
      add('transcendenceExBonus', 'extraLife', [withMilestones(lifePart,
        calculateTranscendenceExtraLife, cfg.capPoints, cfg.maxExtraLife)], '');
      const protection = balanceData.transcendence.consoProtection;
      const intelPart = part('intelligence', result.transcendenceConsoIntelBonus,
        eased('intelligence', protection.intelligenceMaxPercent, protection.intelligenceCap, protection.curvePower));
      intelPart.curvePreview = {
        current: { points: read('intelligence'), value: intelPart.value },
        maximum: { points: protection.intelligenceCap, value: active
          ? transcendenceConsoIntel({ stats: { intelligence: protection.intelligenceCap } }) : 0 },
      };
      add('transcendenceConsoProtectionPercent', 'transcendence', [
        part(statKey, transcendenceConsoProtection(current), cappedProduct(statKey,
          protection.refPercent / Math.max(1, protection.refTranscendence), protection.maxPercent)),
        intelPart,
      ], percent, result.transcendenceConsoProtectionPercent, capNote(protection.maxPercent));
      break;
    }
    case 'movement': {
      const cfg = balanceData.movement.charges;
      const enabled = result.movementValue > 0;
      add('movementMaxCharges', 'shift', [part(statKey, result.movementMaxCharges, [input(statKey, result.movementValue)], '', enabled)], '');
      const agility = getMovementAgilityValue(entite);
      const startingFormula = agility >= cfg.agilityCap ? [constant(cfg.maxAgilityStartingBonusPercent)] : [
        constant(cfg.maxAgilityStartingBonusPercent), '*', '(', constant(1), '-', 'exp(', '-', input('agility', agility), '/', constant(cfg.startingSoftCapDivider), ')', ')',
      ];
      const agilityPart = part('agility', result.movementStartingAgiRatioCurrent, startingFormula, percent, enabled);
      agilityPart.curvePreview = { current: { points: agility, value: agilityPart.value } };
      add('movementStartingTotalCurrent', 'shift', [
        fixedPart(cfg.baseStartingPercent, percent, enabled),
        agilityPart,
      ], percent, result.movementStartingTotalCurrent, capNote(cfg.maxStartingPercent));
      add('movementStartingCharges', 'shift', [part(statKey, result.movementStartingCharges, withSimpleProduct([
        'min(', input('shift', result.movementMaxCharges), ',', 'ceil(', input(statKey, result.movementValue), '*',
        token('shift', result.movementStartingTotalCurrent, percent), '/', constant(100), ')', ')',
      ], input(statKey, result.movementValue), token('shift', result.movementStartingTotalCurrent / 100)), '', enabled)], '');
      add('movementMarathonChance', 'marathon', [
        fixedPart(cfg.marathonBasePercent, percent, enabled),
        part('agility', enabled ? result.movementMarathonChance - cfg.marathonBasePercent : 0,
          cappedProduct('agility', cfg.marathonAgilityRatio, cfg.chanceMaxPercent - cfg.marathonBasePercent, agility), percent, enabled),
      ]);
      add('movementTrailerChance', 'trailer', [
        fixedPart(cfg.trailerBasePercent, percent, enabled),
        part('movement', enabled ? result.movementTrailerChance - cfg.trailerBasePercent : 0,
          cappedProduct('movement', cfg.trailerMovementRatio, cfg.chanceMaxPercent - cfg.trailerBasePercent), percent, enabled),
      ]);
      calculations.movementTrailerChance.parts[1].rounded = true;
      break;
    }
    case 'weaponMastery': {
      const cfg = balanceData.weaponMastery;
      const points = Math.max(0, Math.floor(value));
      const strength = Math.max(0, Math.floor(read('strength')));
      add('weaponMasteryChargeBonus', 'charge', [
        withArithmetic(part(statKey, result.weaponMasteryChargeBrutRatioBonus,
          ['floor(', input(statKey, points), '/', constant(cfg.charge.masteryDivisor), ')', '+', constant(cfg.charge.masteryBaseBonus)], '', points > 0),
          [input(statKey, points), '×', coefficient(statKey, 1 / cfg.charge.masteryDivisor), '+', fixedTerm(cfg.charge.masteryBaseBonus)]),
        part('strength', result.weaponMasteryChargeStrengthRatioBonus, withSimpleProduct(
          ['floor(', input('strength', strength), '/', constant(cfg.charge.strengthDivisor), ')'],
          input('strength', strength), token('strength', 1 / cfg.charge.strengthDivisor)), '', value > 0),
      ], '');
      const mastery = balanceData.weaponOrfevre.fromWeaponMastery;
      const force = balanceData.weaponOrfevre.fromStrength;
      const ownedPoints = Math.max(0, Math.floor(current));
      const masteryFormula = ownedPoints <= mastery.earlyCap
        ? ['floor(', input(statKey, ownedPoints), '/', constant(mastery.earlyDivisor), ')', '+', constant(mastery.earlyBaseBonus)]
        : [constant(mastery.lateBaseBonus), '+', '(', input(statKey, ownedPoints), '-', constant(mastery.earlyCap), ')', '/', constant(mastery.lateDivisor)];
      const strengthFormula = strength <= force.earlyCap
        ? ['max(', constant(force.earlyMinBonus), ',', input('strength', strength), '/', constant(force.earlyDivisor), ')']
        : [constant(force.lateBaseBonus), '+', '(', input('strength', strength), '-', constant(force.earlyCap), ')', '/', constant(force.lateDivisor)];
      const masteryDetail = ownedPoints <= mastery.earlyCap
        ? [input(statKey, ownedPoints), '×', coefficient(statKey, 1 / mastery.earlyDivisor, percent), '+', fixedTerm(mastery.earlyBaseBonus, percent)]
        : [fixedTerm(mastery.lateBaseBonus, percent), '+', '(', input(statKey, ownedPoints), '−', fixedTerm(mastery.earlyCap), ')', '×', coefficient(statKey, 1 / mastery.lateDivisor, percent)];
      const strengthDetail = strength <= force.earlyCap
        ? [input('strength', strength), '×', coefficient('strength', 1 / force.earlyDivisor, percent)]
        : [fixedTerm(force.lateBaseBonus, percent), '+', '(', input('strength', strength), '−', fixedTerm(force.earlyCap), ')', '×', coefficient('strength', 1 / force.lateDivisor, percent)];
      add('weaponOrfevreBonus', 'weaponOrfevre', [
        withArithmetic(part(statKey, calculateWeaponOrfevreWeaponMastery(entite), masteryFormula), masteryDetail),
        withArithmetic(part('strength', result.weaponOrfevreStrength, strength > 0 ? strengthFormula : [input('strength', 0)]), strengthDetail,
          active && strength > 0 && strength <= force.earlyCap ? force.earlyMinBonus : undefined),
      ]);
      add('weaponMasteryTrophyChance', 'weaponCollector', [
        withArithmetic(part(statKey, result.weaponMasteryTrophyWeaponMasteryBonus,
          [constant(cfg.trophy.basePercent), '+', '(', input(statKey, points), '-', constant(1), ')', '*', '(', constant(cfg.trophy.masteryMaxBonusPercent), '/', constant(cfg.trophy.masteryRange), ')'], percent, points > 0),
          [fixedTerm(cfg.trophy.basePercent, percent), '+', '(', input(statKey, points), '−', fixedTerm(1), ')', '×',
            coefficient(statKey, cfg.trophy.masteryMaxBonusPercent / cfg.trophy.masteryRange, percent)]),
        part('strength', result.weaponMasteryTrophyStrengthBonus, [input('strength', strength), '*', token('strength', cfg.trophy.strengthMaxPercent / cfg.trophy.strengthCap)], percent, points > 0),
      ]);
      break;
    }
  }
  return calculations;
}

export const attackDamageModifiers = []; // { id, priority, match(ctx), apply(ctx) -> { sources? , clamp0? } }
const DAMAGE_SOURCE_KEYS = ["piercingDamage", "physical", "magical", "hybridalDamage"];

export function registerAttackDamageModifier(mod) {
  attackDamageModifiers.push(mod);
  attackDamageModifiers.sort((a,b) => (a.priority||0) - (b.priority||0));
}
export function runAttackDamageModifiers(ctx) {
  let sources = { ...ctx.sources };
  let flags = {};
  for (const mod of attackDamageModifiers) {
    if (mod.match && mod.match(ctx) === false) continue;
    const res = mod.apply({ ...ctx, sources }) || {};
    if (res.sources) sources = res.sources;
    if (res.flags) flags = { ...flags, ...res.flags };
  }
  return { sources, flags };
}

function roundAttackDamageSources(sources) {
  const parts = DAMAGE_SOURCE_KEYS.map(key => {
    const number = Number(sources?.[key]);
    const value = Number.isFinite(number) ? Math.max(0, number) : 0;
    return { key, value, whole: Math.floor(value) };
  });
  const sum = parts.reduce((total, part) => total + part.value, 0);
  const epsilon = Math.min(1e-9, Number.EPSILON * Math.max(1, sum) * parts.length);
  let remaining = Math.floor(sum + epsilon) - parts.reduce((total, part) => total + part.whole, 0);
  // One floor on the total; assign the residual points to the largest fractional parts.
  parts.sort((first, second) => (second.value - second.whole) - (first.value - first.whole));
  for (const part of parts) {
    if (remaining <= 0) break;
    part.whole++;
    remaining--;
  }
  return Object.fromEntries(parts.map(part => [part.key, part.whole]));
}

export function calculateAttackDamagePreview(attacker, attack) {
  const a = createAttackStatView(attacker || {}, attack);
  const atk = attack || {};

  const natureRules = getAttackNatureRules(atk);
  const nature = natureRules.natures;

const flags = getAttackResolutionFlags(atk);
const physicalDamageBase = Math.max(0, Number(getSafe(a, "physicalDamage", 0)) || 0);
const magicalDamageBase = Math.max(0, calculateMagicalTotal(a));
const piercingDamageBase = Math.max(0, Number(getSafe(a, "piercingDamage", 0)) || 0);
const resonance = getAttackResonance(atk, physicalDamageBase, magicalDamageBase);

let physBase = flags.isPurePhysicalBrutality
  ? brutalityTotalBonus(a)
  : physicalDamageBase;

let magiBase = flags.isPureMagicalPsionique
  ? psionicTotalBonus(a)
  : magicalDamageBase;

if (resonance.bonus > 0) {
  physBase += resonance.bonus * natureRules.profile.red / natureRules.profile.total;
  magiBase += resonance.bonus * natureRules.profile.blue / natureRules.profile.total;
}

const isPureTranspiercing = flags.isTranspiercing;

const rawBase = piercingDamageBase;
const transpiercingBonus = isPureTranspiercing ? transpiercingAgiRatio(a) : 0;


  const powerRatios = getAttackPowerRatios(atk);
  const ratioMultiplier = natureRules.isInert
    ? 1 - balanceData.attackNature.inertRatioReductionPercent / 100
    : 1;
  const physRatio = powerRatios.physical * ratioMultiplier;
  const magiRatio = powerRatios.magical * ratioMultiplier;
  const pierceRatio = powerRatios.piercing * ratioMultiplier;


  let totalDamageSources = {
    piercingDamage: 0,
    physical: 0,
    magical: 0,
    hybridalDamage: 0,
  };

  const details = {
    nature: natureRules,
    resonance,
    declaredNatures: Array.isArray(atk.attacknature)
      ? [...atk.attacknature]
      : [atk.attacknature].filter(Boolean),
    effectiveNatures: nature,
    flags,
    ratios: {
      physicalRatio: physRatio,
      magicalRatio: magiRatio,
      piercingRatio: pierceRatio,
    },
    physical: {
      active: false,
      stat: physicalDamageBase,
      base: physBase,
      intensifier: Math.max(0, physBase - physicalDamageBase),
      physicalRatio: physRatio,
      total: 0,
    },
    magical: {
      active: false,
      stat: magicalDamageBase,
      base: magiBase,
      intensifier: Math.max(0, magiBase - magicalDamageBase),
      magicalRatio: magiRatio,
      total: 0,
    },
    piercing: {
      active: false,
      stat: piercingDamageBase,
      isPureTranspiercing,
      agility: Math.max(0, Number(getSafe(a, "agility", 0)) || 0),
      agilityRatio: isPureTranspiercing
        ? natureRules.agilityDamageRatio
        : 0,
      agilityBonus: isPureTranspiercing ? transpiercingAgiRatio(a) : 0,
      piercingRatio: pierceRatio,
      total: 0,
    },
    hybridal: {
      active: false,
      physicalPart: 0,
      magicalPart: 0,
      total: 0,
      magicalStatTotal: 0,
      roundingNote: "",
    },
  };

  const physicalPower = physBase * physRatio;
  const magicalPower = magiBase * magiRatio;
  const piercingPower = rawBase * pierceRatio;
  const resonanceOnly = resonance.bonus > 0 && !physRatio && !magiRatio ? resonance.bonus : 0;
  // Flat contribution: never multiplied by a power ratio or allowed to change the output nature.
  const hypercognitionBonus = calculateCognitiveExplosionTotal(a);
  const produced = Math.max(0, physicalPower + magicalPower + piercingPower + resonanceOnly + transpiercingBonus + hypercognitionBonus);

  details.physical.total = physicalPower;
  details.magical.total = magicalPower;
  details.piercing.total = piercingPower;
  details.powers = { physical: physBase, magical: magiBase, piercing: rawBase };
  details.powerSources = { physical: physicalPower, magical: magicalPower, piercing: piercingPower,
    resonance: resonanceOnly, transpiercing: transpiercingBonus, hypercognition: hypercognitionBonus };

  if (natureRules.profile.total || natureRules.isInert) {
    totalDamageSources = splitAttackNatureAmount(atk, produced);
  } else if (nature.includes('hybridalDamage')) {
    totalDamageSources.hybridalDamage = produced;
  } else if (nature.includes('physicalDamage')) {
    totalDamageSources.physical = produced;
  } else if (nature.includes('magicalDamage')) {
    totalDamageSources.magical = produced;
  } else if (nature.includes('piercingDamage') || nature.includes('transpiercingDamage')) {
    totalDamageSources.piercingDamage = produced;
  }

  details.physical.active = totalDamageSources.physical > 0;
  details.magical.active = totalDamageSources.magical > 0;
  details.piercing.active = totalDamageSources.piercingDamage > 0;
  details.physical.total = totalDamageSources.physical;
  details.magical.total = totalDamageSources.magical;
  details.piercing.total = totalDamageSources.piercingDamage;
  details.hybridal.active = totalDamageSources.hybridalDamage > 0;
  details.hybridal.physicalPart = totalDamageSources.hybridalDamage / 2;
  details.hybridal.magicalPart = totalDamageSources.hybridalDamage / 2;
  details.hybridal.total = totalDamageSources.hybridalDamage;
  details.compositionRouted = natureRules.key === 'hybrid' || natureRules.colors.length > 1
    || (transpiercingBonus > 0 && piercingPower <= 0)
    || (physicalPower > 0 && !details.physical.active)
    || (magicalPower > 0 && !details.magical.active)
    || (piercingPower > 0 && !details.piercing.active);

  const { sources: moddedSources } = runAttackDamageModifiers({
    phase: "pre-resolve",
    attacker: a,
    attack: atk,
    sources: totalDamageSources,
  });

  const finalSources = roundAttackDamageSources(moddedSources);

  const totalDamage = DAMAGE_SOURCE_KEYS.reduce((n, key) => n + (finalSources[key] || 0), 0);

  return {
    attacker: a,
    attack: atk,
    flags,
    details,
    sourcesBeforeModifiers: roundAttackDamageSources(totalDamageSources),
    sources: finalSources,
    totalDamage,
  };
}

// --- calcul des dégâts par source + pipeline ---
export function attemptAttackerDamages(attacker, attack) {
  const preview = calculateAttackDamagePreview(attacker, attack);
  const { attacker: a, attack: atk, details, sourcesBeforeModifiers, sources, totalDamage } = preview;

  console.log(
    `--- Calcul des dégâts pour ${a.name} utilisant ${atk.displayName || atk.functionName || "unknown"} ---`
  );

  if (details.physical.intensifier > 0) {
    console.log(
      `BRUTALITÉ-OLD : ${details.physical.stat} PP + ${details.physical.intensifier} bonus = ${details.physical.base}`
    );
  }

  if (details.magical.intensifier > 0) {
    console.log(
      `INTELLECT : ${details.magical.stat} PM + ${details.magical.intensifier} bonus = ${details.magical.base}`
    );
  }

  if (details.piercing.active) {
    if (details.piercing.isPureTranspiercing) {
      console.log(
        `TRANSPERCEMENT : ${details.piercing.stat} piercing + ${details.piercing.agilityBonus} agilité = ${details.piercing.total}`
      );
    } else {
      console.log(`Dégâts raw : ${details.piercing.total}`);
    }
  }

  if (details.hybridal.active) {
    console.log(
      `HYBRID SPLIT @BUILD ${a.name} → phys=${details.hybridal.physicalPart} | mag=${details.hybridal.magicalPart} | total=${details.hybridal.total}`
    );
  }

  if (details.physical.active) {
    console.log(`Dégâts physiques = ${details.physical.total}`, details.physical);
  }

  if (details.magical.active) {
    console.log(`Dégâts magiques = ${details.magical.total}`, details.magical);
  }

  console.log(`Détails des dégâts (avant mods):`, sourcesBeforeModifiers);
  console.log(`Détails des dégâts (après mods):`, sources, `→ total=${totalDamage}`);

  return { totalDamageSources: sources, totalDamage };
}

export function attemptResilience(attacker, target, attackDetail) {
  // Ne s’applique qu’aux altérations
  const types = Array.isArray(attackDetail?.type) ? attackDetail.type : (attackDetail?.type ? [attackDetail.type] : []);
  const isAlteration = types.includes('alteration');
  if (!isAlteration) return { enabled: false, percent: 0 };

  // Calcule le pourcentage de réduction propre à la cible
  let percent = Number(calculateResilienceAlterationTotalBonus(target)) || 0;

  // The common stat calculator already bounds the final percentage.
  if (percent < 0) percent = 0;
  if (percent === 0) {
    console.log(`⛨ ${target.name} → Résilience altérations : 0%`);
    return { enabled: false, percent: 0 };
  }

  console.log(`⛨ ${target.name} → Résilience altérations (base + INT) : ${percent}%`);
  return { enabled: true, percent };
}


export function calculateTotalDodgeBonus(entite) {
  const system = getStatSystemResult(entite, 'dodge');
  if (system) return system.chancePercent;
  if (!entite) return 0;

  const dodgePoints = Number(getSafe(entite, "dodge")) || 0;
  if (dodgePoints <= 0) return 0;

  return calculateDodgePercent(dodgePoints);
}

export function attemptDodge(attacker, target, { partial = false } = {}) {
  if (!canEntityProc(target)) return false;
  const dodgeStat = Number(getSafe(target, "dodge")) || 0;
  const precisionStat = Number(getSafe(attacker, "precision")) || 0;
  const boostedDodgeFlat = Number(getEntityBattleBoostValue(target, "dodge", "flat")) || 0;
  const boostedDodgePercent = Number(getEntityBattleBoostValue(target, "dodge", "percent")) || 0;
  const boostedDodgeLabel = [
    boostedDodgeFlat ? `boost dodge +${round1(boostedDodgeFlat)}` : "",
    boostedDodgePercent ? `boost dodge +${round1(boostedDodgePercent)}%` : "",
  ].filter(Boolean).join(" | ");

  const baseDodgePercent = calculateTotalDodgeBonus(target);
  const totalDodgePercent = dodgeStat > 0 ? baseDodgePercent : 0;

  const precisionPercent = calculatePrecisionPercent(precisionStat);

  const adjustedDodgeChance = Math.max(0, totalDodgePercent * (1 - precisionPercent / 100));
  const adjustedHitChance = 100 - adjustedDodgeChance;

  const roll = Math.random() * 100;
  const dodgeSuccess = roll < adjustedDodgeChance;

  console.log(
  `🌀 ${target.name} → Esquive : ${totalDodgePercent}% ` +
  `(stat ${baseDodgePercent}%` +
  `${boostedDodgeLabel ? ` | ${boostedDodgeLabel}` : ""})`
);
  console.log(`🎯 ${attacker.name} → Précision : ${precisionPercent}%`);
  console.log(`⚖️ Esquive finale : ${adjustedDodgeChance}% | Chance de toucher : ${adjustedHitChance}%`);
  console.log(`🎲 Jet : ${roll.toFixed(2)} → ${dodgeSuccess ? "✅ ESQUIVE RÉUSSIE" : "💥 TOUCHE"}`);

  if (dodgeSuccess) {
    animateDodge(target.id);
    EffectMessage(target, partial ? 'Esquive partielle !' : 'Esquive !');
  }

  return dodgeSuccess;
}
const toMax1Decimal = (n) => {
  // évite les artefacts flottants (ex: 1.999999999)
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? v : v;
};
export function calculateIndestructibilityPercentFromEntity(entite) {
  const points = Number(getSafe(entite, "indestructibility")) || 0;
  return calculateIndestructibilityPercent(points);
}
export function caluclateIndestructibilityStrengthReduction(entite) {
  if (!entite) return 0;
  const cfg = balanceData.indestructibility.reduction;

  const strength = Number(getSafe(entite, "strength")) || 0;
  if (strength <= 0) return 0;

  const capped = Math.min(strength, cfg.statCap);
  const pct = (capped / cfg.statCap) * cfg.strengthMaxPercent;

  return toMax1Decimal(pct);
}

// Indestructibility: 0 -> 0% ; 150 -> 5%
export function caluclateIndestructibilityReduction(entite) {
  if (!entite) return 0;
  const cfg = balanceData.indestructibility.reduction;

  const ind = Number(getSafe(entite, "indestructibility")) || 0;
  if (ind <= 0) return 0;

  const capped = Math.min(ind, cfg.statCap);
  const pct = (capped / cfg.statCap) * cfg.indestructibilityMaxPercent;

  return toMax1Decimal(pct);
}
export function caluclateIndestructibilityReductionTotal(entite) {
  if (!entite) return 0;

  const ind = Number(getSafe(entite, "indestructibility")) || 0;
  if (ind <= 0) return 0;

  const total =
    caluclateIndestructibilityReduction(entite) +
    caluclateIndestructibilityStrengthReduction(entite);

  return toMax1Decimal(total);
}

export function attemptIndestructibility(attacker, target) {
  if (!canEntityProc(target)) return false;
  const points = getSafe(target, "indestructibility");
  const indestructPercent = calculateIndestructibilityPercent(points);

  const minIndestructFloor =
    balanceData.avoidanceFloors.defaultTiers
      .find(tier => points > 0 && points <= tier.maxPoints)
      ?.floorPercent ?? 0;

  if (points <= 0) {
    // console.log(`💠 ${target.name} → Indestructibilité : 0% (aucun plancher)`);
    return false;
  }

  const roll = Math.random() * 100;
  const success = roll < Math.max(minIndestructFloor, indestructPercent);

  console.log(`💠 ${target.name} → Indestructibilité : ${indestructPercent.toFixed(2)}% (plancher ${minIndestructFloor}%)`);
  console.log(`🎲 Jet : ${roll.toFixed(2)} → ${success ? "✅ INDESTRUCTIBLE" : "❌ ÉCHEC"}`);

  if (success) {
    animateIndestructibility(target.id);
    EffectMessage(target, "Indestructible !");
    const effectsContainer = document.getElementById(`effectsContainer_${target.id}`);
    if (effectsContainer) {
      const indestructVFX = document.createElement("img");
      playCachedGif(indestructVFX, `./media/assets/effects/indestructibility.gif`);
      indestructVFX.className = "effect-vfx indestructibility";
      indestructVFX.alt = `${target.name} est indestructible !`;
      indestructVFX.style.position = "absolute";
      effectsContainer.appendChild(indestructVFX);
      removeCombatVisualAfter(indestructVFX, 1200);
    }
  }

  return success;
}

// ================================
// RÉGÉNÉRATION DE COMBAT
// ================================

export function calculateHpBattleRegenStrengthRatio(entite) {
  if (!entite) return 0;
  const cfg = balanceData.regeneration.battleHp;
  const indestructibility = Math.max(0, Number(getSafe(entite, "indestructibility")) || 0);

  // La Force ne génère de régénération que si
  // l'entité possède Indestructibilité.
  if (indestructibility <= 0) return 0;

  const strength = Math.max(0, Number(getSafe(entite, "strength")) || 0);
  if (strength <= 0) return 0;

  const cappedStrength = Math.min(strength, cfg.strengthCap);
  const ratio = (cappedStrength / cfg.strengthCap) * cfg.strengthMaxPercent;
  return Math.max(0, Math.min(cfg.strengthMaxPercent, Math.round(ratio)));
}
export function calculateHpBattleRegenIndestructibilityRatio(entite) {
  if (!entite) return 0;
  const cfg = balanceData.regeneration.battleHp;
  const indestructibility = Math.max(0, Number(getSafe(entite, "indestructibility")) || 0);
  if (indestructibility <= 0) return 0;

  const cappedIndestructibility = Math.min(indestructibility, cfg.indestructibilityCap);
  const span = Math.max(1, cfg.indestructibilityCap - 1);
  const ratio = cfg.indestructibilityMinPercent +
    ((cappedIndestructibility - 1) / span) *
    (cfg.indestructibilityMaxPercent - cfg.indestructibilityMinPercent);
  return Math.max(
    cfg.indestructibilityMinPercent,
    Math.min(cfg.indestructibilityMaxPercent, Math.round(ratio))
  );
}

export function calculateHpBattleRegenGenerated(entite) {
  if (!entite) return 0;
  return Math.max(0, calculateHpBattleRegenStrengthRatio(entite) + calculateHpBattleRegenIndestructibilityRatio(entite));
}

export function calculateHpBattleRegenBase(entite) {
  if (!entite) return 0;
  const finalValue = Math.max(0, Number(getSafe(entite, "hpBattleRegen")) || 0);
  const generatedValue = calculateHpBattleRegenGenerated(entite);
  return Math.max(0, finalValue - generatedValue);
}

export function calculateHpBattleRegenPercent(entite) {
  if (!entite) return 0;
  return Math.max(0, Math.round(Number(getSafe(entite, "hpBattleRegen")) || 0));
}

export function calculateHpBattleRegenAmount(entite) {
  if (!entite) return 0;
  const maxHp = Math.max(0, Number(getSafe(entite, "HP.max", 0)) || 0);
  if (maxHp <= 0) return 0;
  const regenPercent = calculateHpBattleRegenPercent(entite);
  if (regenPercent <= 0) return 0;
  return Math.max(0, Math.round(maxHp * regenPercent / 100));
}
// === ESOTERISM ===

export function calculateEsoterismAgiRatio(entite) {
  if (!entite) return 0;
  const cfg = balanceData.esoterism.reduction;

  const agi = Number(getSafe(entite, "agility") ?? getSafe(entite, "stats.agility")) || 0;

  const cap = cfg.agilityCap;
  const eased = easeOutPowerRatio(agi, cap, cfg.curvePower);

  const maxBonus = cfg.agilityMaxPercent;
  const raw = clamp(maxBonus * eased, 0, maxBonus);

  return Math.round(raw);
}
export function calculateEsoterismBaseReduction() {
  return balanceData.esoterism.reduction.basePercent;
}

export function calculateEsoterismtotalReduction(entite) {
  // Tout est déjà entier : 40 + (0..55) => 40..95
  return calculateEsoterismBaseReduction() + calculateEsoterismAgiRatio(entite);
}
export function calculateEsoterismChance(entite, points = getSafe(entite, 'esoterism')) {
  if (!(points > 0)) return 0;
  const floor =
    balanceData.avoidanceFloors.defaultTiers
      .find(tier => points > 0 && points <= tier.maxPoints)
      ?.floorPercent ?? 0;
  return Math.min(100, Math.max(floor, calculateEsoterismPercent(entite, points)));
}
export function attemptEsoterism(attacker, target) {
  if (!canEntityProc(target)) return false;
  const points = getSafe(target, "esoterism");
  const esoterismPercent = calculateEsoterismChance(target, points);

  if (points <= 0) {
    console.log(`🔮 ${target.name} → Ésotérisme : 0% (aucun plancher)`);
    return false;
  }

  const roll = Math.random() * 100;
  const success = roll < esoterismPercent;

  console.log(`🔮 ${target.name} → Ésotérisme : ${esoterismPercent.toFixed(2)}%`);
  console.log(`🎲 Jet : ${roll.toFixed(2)} → ${success ? "✅ RÉUSSITE" : "❌ ÉCHEC"}`);

  if (success) {
    animateEsoterism(target.id);
    EffectMessage(target, "Ésotérisme !");
    const effectsContainer = document.getElementById(`effectsContainer_${target.id}`);
    if (effectsContainer) {
      const esoterismVFX = document.createElement("img");
      playCachedGif(esoterismVFX, `./media/assets/effects/esoterism.gif`);
      esoterismVFX.className = "effect-vfx esoterism";
      esoterismVFX.alt = `${target.name} réduit les dégâts magiques !`;
      esoterismVFX.style.position = "absolute";
      effectsContainer.appendChild(esoterismVFX);
      removeCombatVisualAfter(esoterismVFX, 2100);
    }
  }

  return success;
}
// === Transcendence ===
export function attemptTranscendenceConsoProtection(entite, rng = Math.random, config = {}) {
  if (!canEntityProc(entite)) return false;
  // Total = base (transcendence points) + bonus intel
  const p = calculateTranscendenceConsoProtectionTotal(entite); // %

  if (p <= 0) return false;

  const roll = rng() * 100;
  const success = roll < p;

  console.log(`✨ ${entite.name} → Transcendance (protection conso) : ${p.toFixed(2)}%`);
  console.log(`🎲 Jet : ${roll.toFixed(2)} → ${success ? "✅ PROTECTION" : "❌ ÉCHEC"}`);

  if (success) {
    EffectMessage(entite, "Transcendance !");

    const effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);
    if (effectsContainer) {
      const vfx = document.createElement("img");
      playCachedGif(vfx, `./media/assets/effects/transcendence.gif`);
      vfx.className = "effect-vfx transcendence";
      vfx.style.opacity = "1";
      vfx.style.transition = "opacity 0.7s linear"; // 4.5 - 3.8 = 0.7
      effectsContainer.appendChild(vfx);

      // 🔻 À 3.8s, on lance le fade-out (1 → 0 jusqu'à 4.5s)
      setTimeout(() => {
        vfx.style.opacity = "0";
      }, 3500);

      // 🧹 On retire à 4.5s
      removeCombatVisualAfter(vfx, 4500);
    }
  }

  return success;
}

export function transcendenceConsoProtection(entiteOrValue, config = {}) {
  const cfg = {
    ...balanceData.transcendence.consoProtection,
    ...config,
  };
  const {
    refTranscendence,
    refPercent,
    maxPercent,
  } = cfg;

  const t =
    typeof entiteOrValue === "number"
      ? entiteOrValue
      : (getSafe(entiteOrValue, "stats.transcendence", null) ??
         getSafe(entiteOrValue, "transcendence", 0));

  const transcendence = Math.max(0, toNumber(t, 0));
  const rawPercent = (transcendence / Math.max(1, refTranscendence)) * refPercent;
  const capped = Math.min(rawPercent, maxPercent);

  return trunc2(capped);
}
export function calculateTranscendenceConsoProtectionTotal(entite) {
  const system = getStatSystemResult(entite, 'transcendenceTotal');
  if (system) return system.value;
  const autonomous = Number(getSafe(entite, 'transcendenceTotal', 0)) || 0;
  const cfg = balanceData.transcendence.consoProtection;
  return roundBalance(clamp(calculateTranscendenceUmbraProtection(entite) + autonomous, 0, cfg.maxPercent), cfg.decimals);
}

export function calculateTranscendenceUmbraProtection(entite) {
  if (!entite) return 0.00;

  const points = Number(getSafe(entite, "transcendence")) || 0;
  if (points <= 0) return 0.00;

  const base = transcendenceConsoProtection(points);
  const intelBonus = transcendenceConsoIntel(entite);

  const cfg = balanceData.transcendence.consoProtection;
  const total = clamp(base + intelBonus, 0, cfg.maxPercent);

  return roundBalance(total, cfg.decimals);
}
export function transcendenceConsoIntel(entite) {
  if (!entite) return 0.00;
  const cfg = balanceData.transcendence.consoProtection;
  const intel = Number(getSafe(entite, "intelligence")) || 0;

  const eased = easeOutPowerRatio(intel, cfg.intelligenceCap, cfg.curvePower);

  const bonus = cfg.intelligenceMaxPercent * eased;
  const clamped = clamp(bonus, 0, cfg.intelligenceMaxPercent);

  return roundBalance(clamped, cfg.decimals);
}

// === ASTRALITY ===
export function attemptAstrality(attacker, target) {
  if (!canEntityProc(target)) return false;
  if (isAstralReturnActive(target) || astralCooldownRemaining(target) > 0) return false;
  const chance = calculateAstralityTotal(target);
  if (!(chance > 0) || Math.random() * 100 >= chance) return false;
  startAstralCooldown(target);
  animateAstrality(target.id);
  const effectsContainer = document.getElementById(`effectsContainer_${target.id}`);
  if (effectsContainer) {
    const astralityVFX = document.createElement("img");
    playCachedGif(astralityVFX, `./media/assets/effects/astrality.gif`);
    astralityVFX.className = "effect-vfx astrality";
    astralityVFX.alt = `${target.name} déclenche l'Astralité !`;
    astralityVFX.style.position = "absolute";
    effectsContainer.appendChild(astralityVFX);
    removeCombatVisualAfter(astralityVFX, 2500);
  }
  return true;
}

export function attemptBloodFuryExec(attacker, target, options = {}) {
  if (!canEntityProc(attacker)) return 0;
  const ignoreHpThreshold = Boolean(options.ignoreHpThreshold);

  const bloodFuryExecChanceBonus = calculateBloodFuryTargetThreshold(attacker);
  const bloodFuryExecDamage = calculateExecutionDamage(attacker);
  const bloodFuryProcChance = calculateBloodFuryExecutionPercent(attacker);

  if (bloodFuryExecChanceBonus <= 0 || bloodFuryExecDamage <= 0 || bloodFuryProcChance <= 0) {
    return 0;
  }

  const targetHP = getSafe(target, "HP", null);
  const targetCurrentHP = Number(targetHP?.current ?? 0) || 0;
  const targetMaxHP = Number(targetHP?.max ?? 0) || 0;
  const hpPercent = targetMaxHP > 0 ? (targetCurrentHP / targetMaxHP) * 100 : 100;

  if (!ignoreHpThreshold && hpPercent > bloodFuryExecChanceBonus) {
    console.log(
      `💀 [EXECUTION FAIL HP] ${attacker.name} → ${target.name} a ${hpPercent.toFixed(1)} % HP ` +
      `(seuil requis : ${bloodFuryExecChanceBonus} %).`
    );
    return 0;
  }

  const roll = Math.random() * 100;

  if (roll > bloodFuryProcChance) {
    console.log(
      `💀 [EXECUTION FAIL PROC] ${attacker.name} rate l'exécution sur ${target.name} ` +
      `(${roll.toFixed(1)} > ${bloodFuryProcChance} %).`
    );
    return 0;
  }

  console.log(
    `💀 [EXECUTION SUCCESS] ${attacker.name} exécute ${target.name} ` +
    `(${hpPercent.toFixed(1)} % HP, seuil ${bloodFuryExecChanceBonus} %, proc ${bloodFuryProcChance} %).`
  );

  try {
    const effectsContainer = document.getElementById(`effectsContainer_${target.id}`);

    if (effectsContainer) {
      const procVFX = document.createElement("img");
      procVFX.className = "effect-vfx bloodfuryexec";
      procVFX.style.position = "absolute";
      procVFX.style.zIndex = "20";
      effectsContainer.appendChild(procVFX);
      const loadingTimeout = removeCombatVisualAfter(procVFX, 2000);
      procVFX.addEventListener('load', () => {
        loadingTimeout.cancel();
        // 18 frames: one 570 ms cycle, starting when the GIF is ready.
        removeCombatVisualAfter(procVFX, 570);
      }, { once: true });
      procVFX.addEventListener('error', () => {
        loadingTimeout.cancel();
        procVFX.remove();
      }, { once: true });
      playCachedGif(procVFX, `./media/assets/effects/bloodFuryExec.gif`);
    }

    damageImpact(target.id, {
      effectName: "damage-explode",
      src: "./media/assets/effects/damage-execution.gif",
      className: "blood-impact damage-explode",
      lifetime: 1450, // 1,500 ms GIF cycle, including the impact helper's 50 ms cleanup delay.
      offsetY: "10px",
      randomBloodImpact: false,
    });
  } catch (e) {
    console.warn("⚠️ Effet d’exécution non chargé :", e);
  }

  return Math.ceil(bloodFuryExecDamage);
}

export function calculateBloodThirstyFlat() {
  return balanceData.blood.thirsty.flatPercent;
}

export function calculateBloodThirstyBFRatio(bloodFury) {
  const cfg = balanceData.blood.thirsty;
  const bf = Number(bloodFury || 0);
  return Math.round((bf / cfg.bloodFuryCap) * cfg.bloodFuryMaxPercent);
}

export function calculateBloodThirstyStrengthRatio(strength) {
  const cfg = balanceData.blood.thirsty;
  const str = Number(strength || 0);
  return Math.round((str / cfg.strengthCap) * cfg.strengthMaxPercent);
}

export function calculateBloodThirstyPercent(entiteOrValue, strengthValue = null) {
  // Si on donne un nombre seul, c’est une BT finale directe.
  if (typeof entiteOrValue === "number" && strengthValue === null) {
    return Number(entiteOrValue || 0);
  }

  const bloodFury =
    typeof entiteOrValue === "number"
      ? Number(entiteOrValue || 0)
      : Number(getSafe(entiteOrValue, "bloodFury", 0));

  const strength =
    strengthValue !== null
      ? Number(strengthValue || 0)
      : Number(getSafe(entiteOrValue, "strength", 0));

  if (bloodFury <= 0) return 0;

  return (
    calculateBloodThirstyFlat() +
    calculateBloodThirstyBFRatio(bloodFury) +
    calculateBloodThirstyStrengthRatio(strength)
  );
}


export function calculateBloodFuryBFtRatio(bloodFury) {
  const cfg = balanceData.blood.furyExecution;
  const bf = Math.max(0, Number(bloodFury) || 0);
  if (bf === 0) return 0;
  const base = cfg.bloodFuryBasePercent +
    cfg.bloodFuryMaxBonusPercent *
    Math.sqrt(bf / cfg.bloodFuryCap);
  return Math.min(roundBalance(Math.ceil(base * 100) / 100, cfg.decimals), cfg.bloodFuryTotalCapPercent);
}

export function calculateBloodFuryStrengthRatio(strength) {
  const cfg = balanceData.blood.furyExecution;
  const str = Math.max(0, Number(strength) || 0);
  const bonus = str * cfg.strengthChancePerPoint;
  return Math.ceil(bonus * 100) / 100;
}

export function calculateBloodFuryExecutionPercent(entite) {
  const system = getStatSystemResult(entite, 'bloodFuryExecutionChance');
  if (system) return system.value;
  const direct = Math.max(0, Number(getSafe(entite, "bloodFuryExecutionChance", 0)) || 0);
  const bloodFury = Math.max(0, Number(getSafe(entite, "bloodFury", 0)) || 0);
  if (bloodFury <= 0) return round1(Math.min(100, direct));

  const strength = Math.max(0, Number(getSafe(entite, "strength", 0)) || 0);

  const bfRatio = calculateBloodFuryBFtRatio(bloodFury);
  const strRatio = calculateBloodFuryStrengthRatio(strength);

  return round1(Math.min(100, direct + Math.ceil((bfRatio + strRatio) * 100) / 100));
}


export function calculateBloodFuryExecStrengthRatio(strength) {
  const cfg = balanceData.blood.furyExecution;
  const str = Math.max(0, Number(strength) || 0);
  if (str === 0) return 0;
  const ratio = (str / cfg.strengthExecCap) * cfg.strengthExecMaxRatio;
  const capped = Math.min(ratio, cfg.strengthExecMaxRatio);
  return Math.ceil(capped * 100) / 100;
}

// export function calculateBloodFuryExecChanceBonus(strength) {
  // const strengthRatio = calculateBloodFuryExecStrengthRatio(strength);
  // return Math.ceil((15 + strengthRatio) * 100) / 100;
// }
export function calculateBloodFuryExecChanceBonus(strength) {
  return balanceData.blood.furyExecution.targetThresholdPercent;
}

export function calculateBloodFuryTargetThreshold(entite) {
  const system = getStatSystemResult(entite, 'bloodFuryTargetThreshold');
  if (system) return system.value;
  const direct = Math.max(0, Number(getSafe(entite, "bloodFuryTargetThreshold", 0)) || 0);
  const bloodFury = Math.max(0, Number(getSafe(entite, "bloodFury", 0)) || 0);
  if (bloodFury <= 0) return round1(Math.min(100, direct));

  const strength = Math.max(0, Number(getSafe(entite, "strength", 0)) || 0);
  const bloodFuryThreshold = calculateBloodFuryExecChanceBonus(strength);
  return round1(Math.min(100, direct + bloodFuryThreshold));
}

export function calculateBloodFuryExecutionSRatio(bloodFuryExecSRatioBonus) {
  const cfg = balanceData.blood.furyExecution;
  const bonus = bloodFuryExecSRatioBonus || 0;
  return Math.ceil(cfg.baseDamagePercent + (cfg.damagePerStrengthRatioPercent * bonus));
}

export function calculateExecutionDamage(entite) {
  const system = getStatSystemResult(entite, 'bloodFuryExecutionDamage');
  if (system) return system.value;
  const direct = Math.max(0, Number(getSafe(entite, "bloodFuryExecutionDamage", 0)) || 0);
  const bloodFury = Math.max(0, Number(getSafe(entite, "bloodFury", 0)) || 0);
  if (bloodFury <= 0) return Math.ceil(direct);

  const strength = Math.max(0, Number(getSafe(entite, "strength", 0)) || 0);
  const bloodFuryExecSRatioBonus = calculateBloodFuryExecStrengthRatio(strength);

  const baseMultiplier = balanceData.blood.furyExecution.damageMultiplier;
  const physicalDamage = Math.max(0, Number(getSafe(entite, "physicalDamage", 0)) || 0);

  const execPercent = calculateBloodFuryExecutionSRatio(bloodFuryExecSRatioBonus);
  const percentMultiplier = execPercent / 100;

  return Math.ceil(direct + baseMultiplier * (percentMultiplier * physicalDamage));
}

export function calculateAmbidextryProcBonus(entite) {
  const ambidextryValue = getSafe(entite, "ambidextry");
  return calculateAmbidextryPercent(ambidextryValue || 0);
}

// Chance additionnelle via l'agilité
export function calculateAmbidextryAgiChance(entite) {
  const cfg = balanceData.ambidextry;
  const agility = getSafe(entite, "agility");
  const bonus = (agility || 0) * cfg.chanceAgilityPerPointPercent / 100;
  return Math.ceil(bonus * 100);
}

// Chance totale de double attaque (ambidextry + agilité)
export function calculateAmbidextryTotalChance(entite) {
  const ambidextryProcBonus = calculateAmbidextryProcBonus(entite);

  // Si la base est à 0, on force le total à 0 (on ignore le bonus AGI).
  if (!ambidextryProcBonus || ambidextryProcBonus <= 0) return 0;

  const ambidextryAgiProcBonus = calculateAmbidextryAgiChance(entite);
  return Math.min(100, Math.max(0, ambidextryProcBonus + ambidextryAgiProcBonus));
}

// Ratio de dégâts du second coup (lié à ambidextry)
export function calculateAmbidextryRatioBonus(entite) {
  const cfg = balanceData.ambidextry;
  const ambidextryValue = getSafe(entite, "ambidextry");
  const base = calculateAmbidextryPercent(ambidextryValue || 0);
  return Math.ceil(base * cfg.ratioFromBaseChance);
}

// Ratio additionnel selon l’agilité
export function calculateAmbidextryAgiRatioBonus(entite) {
  const cfg = balanceData.ambidextry;
  const agility = getSafe(entite, "agility");
  const ratio = (agility || 0) * cfg.ratioAgilityPerPointPercent / 100;
  return Math.ceil(ratio * 100);
}

// Total des dégâts de la double attaque (ratio total)
export function calculateAmbidextryDamageBonus(entite) {
  const cfg = balanceData.ambidextry;
  const ambidextryRatioBonus = calculateAmbidextryRatioBonus(entite);
  const ambidextryAgiRatioBonus = calculateAmbidextryAgiRatioBonus(entite);
  return cfg.secondHitBaseDamagePercent + ambidextryRatioBonus + ambidextryAgiRatioBonus;
}


export function calculateInvisibleTargetAvoidChance(attacker) {
  const precision = calculatePrecisionPercent(Number(getSafe(attacker, 'precision', 0)) || 0);
  return balanceData.occultism.forcedTarget.avoidChancePercent * (1 - precision / 100);
}

export function attemptInvisibleTargetAccuracy(attacker, target) {
  const avoidChance = calculateInvisibleTargetAvoidChance(attacker);
  const roll = Math.random() * 100;
  const success = roll >= avoidChance;
  attacker.lastInvisibleAccuracy = { avoidChance, hitChance: 100 - avoidChance, roll, success, targetId: target?.id };
  return success;
}

export function transpiercingAgiRatio(entite) {
  const agility = Math.max(0, Number(getSafe(entite, "agility", 0)) || 0);
  return Math.floor(agility * getAttackNatureRules(entite?.currentAttack).agilityDamageRatio);
}

export function transpiercingTotal(entite) {
  const piercingPower = Math.max(0, Number(getSafe(entite, "piercingDamage", 0)) || 0);

  return transpiercingAgiRatio(entite) + piercingPower;
}


export function AmbidextryVFX(target) {
	try {
		if (typeof EffectMessage === "function") EffectMessage(target, "Ambidextrie !");
		if (typeof animateAmbidextry === "function") animateAmbidextry(target.id);

		const effectsContainer = document.getElementById(`effectsContainer_${target.id}`);
		if (!effectsContainer) return;

		const ambiVFX = document.createElement("img");
		playCachedGif(ambiVFX, `./media/assets/effects/ambidextry.gif`);
		ambiVFX.className = "effect-vfx ambidextry";
		Object.assign(ambiVFX.style, {
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			zIndex: "20",
			opacity: "0",
			transition: "opacity 0.2s ease-in-out"
		});

		effectsContainer.appendChild(ambiVFX);
		requestAnimationFrame(() => (ambiVFX.style.opacity = "1"));

		setTimeout(() => {
			ambiVFX.style.opacity = "0";
			removeCombatVisualAfter(ambiVFX, 200);
		}, 1800);
	} catch (vfxError) {
		console.warn(`⚠️ Erreur lors de l’affichage du VFX d’ambidextrie :`, vfxError);
	}
}


function criticalResult(entity, key, override = null) {
  if (!entity) return calculateStatSources({}, key);
  if (override == null) {
    const system = getStatSystemResult(entity, key);
    if (system) return system;
  }
  const inputs = entity.baseStats ? getStatSystemInputs(entity) : entity.stats || {};
  return calculateStatSources(override == null ? inputs : { ...inputs, criticalPower: override }, key, { effective: true });
}

export function calculateCritAgiChanceBonus(entity) {
  return criticalResult(entity, 'criticalChance').bonuses[0]?.value || 0;
}
export function calculateCritTotalChance(entity, override = null) {
  return criticalResult(entity, 'criticalChance', override).value;
}
export function calculateCritRatioBonus(entity, override = null) {
  return criticalResult(entity, 'criticalDamage', override).generated;
}
export function calculateCritAgiRatioBonus() { return 0; }
export function calculateCritDamageBonus(entity, override = null) {
  return criticalResult(entity, 'criticalDamage', override).value;
}
export function attemptCriticalHit(attacker, target, totalDamage) {
  if (!attacker || !canEntityProc(attacker)) {
    return {
      isCritical: false,
      popupType: "normal",
      finalDamage: Number(totalDamage) || 0,
      critTotalChance: 0,
      critDamageBonus: 0,
      components: {}
    };
  }

  const critValue = Number(getSafe(attacker, "criticalPower")) || 0;
  const occultismCritBoost = getEntityBattleBoostValue(attacker, "criticalChance", "flat");

  const critChanceBonus = criticalResult(attacker, 'criticalChance').base;

  const critAgiChanceBonus = critValue > 0
    ? calculateCritAgiChanceBonus(attacker)
    : 0;

  const critTotalChance = calculateCritTotalChance(attacker, critValue);

  const critRatioBonus = calculateCritRatioBonus(attacker, critValue);
  const critAgiRatioBonus = calculateCritAgiRatioBonus(attacker);

  const critDamageBonus = calculateCritDamageBonus(attacker, critValue);

  const randomRoll = Math.random() * 100;
  const isCritical = critTotalChance > 0 && randomRoll < critTotalChance;
console.log(
  `💥 ${attacker.name} → Critique : ${critTotalChance}% | roll ${randomRoll.toFixed(2)} → ${
    isCritical ? "✅ CRITIQUE" : "❌ normal"
  }${occultismCritBoost > 0 ? ` | Occultisme +${occultismCritBoost}%` : ""}`
);
  const baseDamage = Number(totalDamage) || 0;
  const finalDamage = isCritical
    ? Math.round(baseDamage * (1 + critDamageBonus / 100) + Number.EPSILON * Math.max(1, baseDamage * (1 + critDamageBonus / 100)) * 4)
    : baseDamage;

  if (
    occultismCritBoost > 0 &&
    typeof attacker.removeOccultismCritBoost === "function"
  ) {
    attacker.removeOccultismCritBoost();
    attacker.removeOccultismCritBoost = null;

    console.log(
      `🌑 Critique occulte consommé : ${attacker.name} | +${occultismCritBoost}%`
    );
  }

  return {
    isCritical,
    popupType: isCritical ? "critical" : "normal",
    finalDamage,
    critTotalChance,
    critDamageBonus,
    components: {
      critChanceBonus,
      critAgiChanceBonus,
      occultismCritBoost,
      critRatioBonus,
      critAgiRatioBonus,
    }
  };
}

// =========================
// CRITIQUES AUTONOMES
// =========================

export function getFinalCriticalChanceFlat(entite) {
  return Math.max(
    0,
    Number(getSafe(entite, "criticalChance", 0)) || 0
  );
}

export function getFinalCriticalDamageFlat(entite) {
  return Math.max(
    0,
    Number(getSafe(entite, "criticalDamage", 0)) || 0
  );
}




function resilienceResult(entity, key) {
  const system = getStatSystemResult(entity, key);
  if (system) return system;
  const inputs = entity?.baseStats ? getStatSystemInputs(entity) : entity?.stats || {};
  return calculateStatSources(inputs, key, { effective: true });
}
export function calculateResilienceStrengthCritBonus(entity) {
  return resilienceResult(entity, 'criticalResistance').bonuses[0]?.value || 0;
}
export function calculateResilienceCritTotalBonus(entity) {
  return resilienceResult(entity, 'criticalResistance').value;
}
export function calculateResilienceAlterationBonus(entity) {
  return resilienceResult(entity, 'alterationResistance').base;
}
export function calculateResilienceIntelligenceAlterBonus(entity) {
  return resilienceResult(entity, 'alterationResistance').bonuses[0]?.value || 0;
}
export function calculateResilienceAlterationTotalBonus(entity) {
  return resilienceResult(entity, 'alterationResistance').value;
}
export function calculateResilienceCancelBonus(entity) {
  const row = resilienceResult(entity, 'resilienceTotal');
  return globalThis.umbraProgression.resilienceCancelDetails(row.umbra, 0).percent;
}
export function calculateResilienceStrengthCancelBonus(entity) {
  return resilienceResult(entity, 'resilienceTotal').generated - calculateResilienceCancelBonus(entity);
}
export function calculateResilienceTotalCancelBonus(entity) {
  return resilienceResult(entity, 'resilienceTotal').value;
}
export function calculateHindranceResistance(entity) {
  return resilienceResult(entity, 'hindranceResistance').value;
}
export function isHindranceEffect(effect, attacker = null, target = null) {
  const types = Array.isArray(effect?.type) ? effect.type : [effect?.type];
  if (effect?.blocksMovement || effect?.increasesMovementCost) return true;
  if (effect?.forcedMovement && attacker && target) {
    return Boolean(attacker._folieAtLaunch || getControlState(attacker, 'folie'))
      || attacker !== target && isCombatEnemy(attacker, target);
  }
  return types.includes('entrave') || effect?.forcedMovement === true;
}
export function isAlterationEffect(effect) {
  const types = Array.isArray(effect?.type) ? effect.type : [effect?.type];
  return types.includes('alteration');
}
export function calculateResilienceEffectIntensity(target, value) {
  return (Number(value) || 0) * (1 - calculateResilienceAlterationTotalBonus(target) / 100);
}
export function calculateResilienceEffectDuration(target, effect, handler) {
  const duration = Number(effect?.effectDuration);
  const damaging = Number(effect?.effectDot) > 0 || effect?.effectPhysicalRatio === 'attacker'
    || effect?.effectMagicalRatio === 'attacker' || Number(effect?.effectPhysicalRatio) > 0
    || Number(effect?.effectMagicalRatio) > 0 || handler?.tacticalScope === 'damage';
  // The effect's explicit type alone controls mitigation, not its attack's aggregated categories.
  if (![].concat(effect?.type || []).includes('alteration') || damaging || !Number.isFinite(duration) || duration <= 0) return effect?.effectDuration;
  return duration * (1 - calculateResilienceAlterationTotalBonus(target) / 100);
}
export function prepareResilienceEffect(target, effect, handler) {
  if (!isAlterationEffect(effect)) return effect;
  // One mitigation per effect: DoT damage in applyDamage, otherwise duration here.
  return { ...effect, baseEffectDuration: effect.effectDuration,
    effectDuration: calculateResilienceEffectDuration(target, effect, handler) };
}
export function rollAlterationResistance(target, effect, random = Math.random, attacker = null) {
  if (!canEntityProc(target)) return { canceled: false, kind: null };
  const hindrance = isHindranceEffect(effect, attacker, target);
  if (![].concat(effect?.type || []).includes('alteration') && !hindrance) return { canceled: false, kind: null };
  const totalChance = calculateResilienceTotalCancelBonus(target);
  if (random() * 100 < totalChance) return { canceled: true, kind: 'resilienceCancel', chance: totalChance };
  if (hindrance) {
    const chance = calculateHindranceResistance(target);
    if (random() * 100 < chance) return { canceled: true, kind: 'hindranceResistance', chance };
  }
  return { canceled: false, kind: null };
}
export function attemptAlterationResistance(attacker, target, effect) {
  const result = rollAlterationResistance(target, effect, Math.random, attacker);
  if (result.canceled) showResilienceCancellation(target, result.kind);
  return result;
}
export function getAlterationTiming(target, effect) {
  const baseDuration = Math.max(0, Number(effect.baseEffectDuration ?? effect.effectDuration) || 0);
  const duration = Math.max(0, Number(effect.baseEffectDuration == null
    ? calculateResilienceEffectDuration(target, effect) : effect.effectDuration) || 0);
  return { baseDuration, duration };
}
export function reduceCriticalSupplement(damage, normalDamage, reductionPercent) {
  const base = Math.max(0, Math.min(damage, Number(normalDamage) || 0));
  const supplement = Math.max(0, damage - base);
  return Math.max(base, Math.round(base + supplement * (1 - Math.max(0, Math.min(100, reductionPercent)) / 100)));
}
export function attemptResilienceCancel(attacker, target, effect) {
  if (!canEntityProc(target)) return false;
  // Lecture du bonus de résilience pur
  const chance = calculateResilienceTotalCancelBonus(target);
  const roll = Math.random() * 100;
  const success = roll < chance;

  console.log(
    `⛨ [Cancel Alté] ${target.name} — chance ${chance.toFixed(2)}% | jet ${roll.toFixed(2)} → ${success ? "✅ ANNULÉE" : "❌ passe"}`
  );

  if (success) showResilienceCancellation(target, 'resilienceCancel');
  return success;
}
function showResilienceCancellation(target, kind) {
  if (kind === 'resilienceCancel') {
    const effectsContainer = document.getElementById(`effectsContainer_${target.id}`);
    if (effectsContainer) {
      const resilienceVFX = document.createElement("img");
      playCachedGif(resilienceVFX, `./media/assets/effects/resilience-cancel.gif`);
      resilienceVFX.className = "effect-vfx resilience";
      resilienceVFX.style.position = "absolute";
      resilienceVFX.style.pointerEvents = "none";
      resilienceVFX.style.zIndex = "10";
      effectsContainer.appendChild(resilienceVFX);
      removeCombatVisualAfter(resilienceVFX, 2100);
    }

  }
  const stat = kind === 'resilienceCancel' ? 'resilienceTotal' : 'hindranceResistance';
  const line = document.createElement('div');
  line.className = `effect-message-line ${stat}`;
  const icon = document.createElement('span');
  icon.className = `picto-stat ${stat}`;
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = stat;
  label.textContent = kind === 'resilienceCancel' ? 'Résilience totale !' : 'Entrave résistée !';
  line.append(icon, label);
  EffectMessage(target, line, stat);
}

export function attemptResilienceCritReduction(attacker, target, damage, normalDamage = damage) {
  return reduceCriticalSupplement(damage, normalDamage, calculateResilienceCritTotalBonus(target));
}
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

export function calculateBullsEyePercent(entite) {
  const system = getStatSystemResult(entite, 'bullsEye');
  return system?.value ?? Math.max(0, Math.min(balanceData.vision.bullsEyeCurve.maxPercent, Number(getSafe(entite, 'bullsEye', 0)) || 0));
}

export function getRangePenaltyDetails(entite, attack = entite?.currentAttack) {
  if (attack?.rangePenaltyAtLaunch) return { ...attack.rangePenaltyAtLaunch };
  const cfg = balanceData.range.ratio;
  const flags = attack ? getAttackResolutionFlags(attack) : null;
  // effectiveExecutionTime is captured at launch. Preview definitions need their reductions applied once.
  const executionMs = attack ? Math.max(0, Number(attack.effectiveExecutionTime
    ?? getEffectiveAttackTimings(attack.baseTimings ? { ...attack, ...attack.baseTimings } : attack, entite).effective.executionTime) || 0) : 0;
  const durationRatio = Math.min(1, executionMs / Math.max(1, cfg.executionAtMaximumMs));
  const basePenalty = cfg.basePercent + (cfg.maxPercent - cfg.basePercent) * durationRatio;
  const bullsEyePercent = calculateBullsEyePercent(entite);
  const applicable = !!flags?.applyRangeRatio && attack.combatFunction !== 'Support';
  return { executionMs, basePenalty, bullsEyePercent, applicable,
    penalty: applicable ? basePenalty * (1 - bullsEyePercent / 100) : 0 };
}

export function calculateRangeRatio(entite, attack = entite?.currentAttack) {
  return getRangePenaltyDetails(entite, attack).penalty;
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const scalePercentRounded = (stat, statMax, percentMax) => {
  const s = Number(stat) || 0;
  const raw = (clamp(s, 0, statMax) / statMax) * percentMax;
  return Math.round(raw); // 0.4 -> 0 / 0.5 -> 1
};

export function calculateStrength(entite) {
  const v = (getSafe(entite, "strength") ?? 0);
  return parseFloat(Number(v).toFixed(2));
}

export function calculateAgility(entite) {
  const v = (getSafe(entite, "agility") ?? 0);
  return parseFloat(Number(v).toFixed(2));
}

// 0 intel -> 0% ; 150 intel -> 30%
export function calculateHasteIntelRatio(entite, hasteValue = null) {
  const cfg = balanceData.attackTime.hasteRatios;
  const effectiveHaste = Number(hasteValue ?? getHastePoints(entite)) || 0;
  if (effectiveHaste <= 0) return 0;
  const intel = calculateIntelligence(entite);
  return scalePercentRounded(intel, cfg.statCap, cfg.intelligencePrepMaxPercent);
}

export function calculateHasteCDReduc(entite) {
  const cfg = balanceData.attackTime.hasteRatios;
  if (getHastePoints(entite) <= 0) return 0;
  const intel = calculateIntelligence(entite);
  return scalePercentRounded(intel, cfg.statCap, cfg.intelligenceCooldownMaxPercent);
}

export function calculateHasteRecupReduc(entite) {
  const cfg = balanceData.attackTime.hasteRatios;
  const haste = Number(getSafe(entite, "haste", 0)) || 0;
  if (haste <= 0) return 0;

  const agi = calculateAgility(entite);
  return scalePercentRounded(agi, cfg.statCap, cfg.agilityRecoveryMaxPercent);
}

export function calculateHastePrepReduc(entite, hasteValue) {
  const effectiveHaste = Number(hasteValue ?? getHastePoints(entite)) || 0;
  if (effectiveHaste <= 0) return 0;

  const hastePct = Number(calculateHastePercent(effectiveHaste)) || 0;
  const intelPct = Number(calculateHasteIntelRatio(entite, effectiveHaste)) || 0;
  return round1(hastePct + intelPct);
}

export function calculateHasteExecReduc(entite) {
  const cfg = balanceData.attackTime.hasteRatios;
  if (getHastePoints(entite) <= 0) return 0;
  const str = calculateStrength(entite);
  return scalePercentRounded(str, cfg.statCap, cfg.strengthExecutionMaxPercent);
}
export function calculateHasteProjectilSpeed(entite) {
  const cfg = balanceData.attackTime.hasteRatios;
  if (getHastePoints(entite) <= 0) return 0;
  const reducPct = Number(calculateHasteExecReduc(entite)); // 0..25 (ex: 1 = 1%)
  if (!Number.isFinite(reducPct)) return 0;

  const clampedPct = Math.max(0, Math.min(reducPct, cfg.projectileSpeedCapPercent));
  const r = clampedPct / 100; // ratio 0..0.95

  const speedBonusPct = (1 / (1 - r) - 1) * cfg.projectileSpeedBasePercent;

  return roundBalance(speedBonusPct, cfg.projectileSpeedDecimals);
}

export function getFinalAttackCooldownReduc(entite) {
  const system = getStatSystemResult(entite, 'attackCooldownReduc');
  if (system) return system.value;
  const direct = Number(getSafe(entite, "attackCooldownReduc", 0)) || 0;
  const haste = Number(getSafe(entite, "haste", 0)) > 0 ? Number(calculateHasteCDReduc(entite)) || 0 : 0;
  return round1(Math.min(ATTACK_TIME_REDUC_CAP, Math.max(0, direct + haste)));
}

export function getFinalAttackPreparationReduc(entite) {
  const system = getStatSystemResult(entite, 'attackPreparationReduc');
  if (system) return system.value;
  const direct = Number(getSafe(entite, "attackPreparationReduc", 0)) || 0;
  const hasteValue = Number(getSafe(entite, "haste", 0)) || 0;
  const haste = hasteValue > 0 ? Number(calculateHastePrepReduc(entite, hasteValue)) || 0 : 0;
  return round1(Math.min(ATTACK_TIME_REDUC_CAP, Math.max(0, direct + haste)));
}

export function getFinalAttackExecutionReduc(entite) {
  const system = getStatSystemResult(entite, 'attackExecutionReduc');
  if (system) return system.value;
  const direct = Number(getSafe(entite, "attackExecutionReduc", 0)) || 0;
  const haste = Number(getSafe(entite, "haste", 0)) > 0 ? Number(calculateHasteExecReduc(entite)) || 0 : 0;
  return round1(Math.min(ATTACK_TIME_REDUC_CAP, Math.max(0, direct + haste)));
}

export function getFinalAttackRecoveryReduc(entite) {
  const system = getStatSystemResult(entite, 'attackRecoveryReduc');
  if (system) return system.value;
  const direct = Number(getSafe(entite, "attackRecoveryReduc", 0)) || 0;
  const haste = Number(getSafe(entite, "haste", 0)) > 0 ? Number(calculateHasteRecupReduc(entite)) || 0 : 0;
  return round1(Math.min(ATTACK_TIME_REDUC_CAP, Math.max(0, direct + haste)));
}
export function speedBonusToReducPercent(speedBonus) {
  const cfg = balanceData.attackTime.hasteRatios;
  const bonus = Math.max(0, Number(speedBonus) || 0);
  if (bonus <= 0) return 0;
  return round1((bonus / (cfg.projectileSpeedBasePercent + bonus)) * cfg.projectileSpeedBasePercent);
}
export function getFinalAttackProjectileSpeed(entite) {
  const system = getStatSystemResult(entite, 'attackProjectileSpeed');
  if (system) return system.value;
  const direct = Number(getSafe(entite, "attackProjectileSpeed", 0)) || 0;
  const haste = Number(getSafe(entite, "haste", 0)) > 0 ? Number(calculateHasteProjectilSpeed(entite)) || 0 : 0;
  return round1(Math.min(ATTACK_TIME_REDUC_CAP, Math.max(0, direct + haste)));
}

export function calculateProjectilSpeedPercent(entite) {
  const cfg = balanceData.attackTime.hasteRatios;
  const bonusPct = Number(getFinalAttackProjectileSpeed(entite)); // ex: 3 -> +3%
  if (!Number.isFinite(bonusPct)) return cfg.projectileSpeedBasePercent;

  const totalPct = cfg.projectileSpeedBasePercent + bonusPct;
  return roundBalance(totalPct, cfg.projectileSpeedDecimals);
}


export function calculateIntelligence(entite) {
  return parseFloat((getSafe(entite, "intelligence") ?? 0).toFixed(2));
}
export function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
export const clampPercent = (p, min = 0, max = balanceData.attackTime.reductionCapPercent) => {
  const upper = max ?? balanceData.attackTime.reductionCapPercent;
  const n = Number(p);
  if (!Number.isFinite(n)) return min;
  return Math.min(upper, Math.max(min, n));
};

export function getHastePoints(entite) {
  const h = getSafe(entite, "haste", null);
  if (typeof h === "number") return h;
  if (h && typeof h === "object") return Number(h.current ?? h.value ?? h.points ?? 0) || 0;
  return Number(entite?.haste ?? entite?.hastePoints ?? 0) || 0;
}

export const applyReducToMs = (baseMs, reducPercent) => {
  const ms = Number(baseMs) || 0;
  const p = clampPercent(reducPercent, 0, balanceData.attackTime.reductionCapPercent);
  return Math.max(0, Math.round(ms * (1 - p / 100)));
};

// ✅ UI + debug : timings effectifs
export function getEffectiveAttackTimings(attack, entite) {
  const hastePoints = getHastePoints(entite);
  const hasHaste = hastePoints > 0;

  const hasteBase = hasHaste ? (Number(calculateHastePercent(hastePoints)) || 0) : 0;

const prepReduc = clampPercent(getFinalAttackPreparationReduc(entite));
const cdReduc   = clampPercent(getFinalAttackCooldownReduc(entite));
const execReduc = clampPercent(getFinalAttackExecutionReduc(entite));
const recReduc  = clampPercent(getFinalAttackRecoveryReduc(entite));

  const base = {
    cooldown:        Number(attack.cooldown) || 0,
    preparationTime: Number(attack.preparationTime) || 0,
    executionTime:   Number(attack.executionTime) || 0,
    recoveryTime:    Number(attack.recoveryTime) || 0,
  };

  const { isMelee: isMeleeAttack, isRange: isRangeAttack } = getAttackResolutionFlags(attack);

  const attackNatures = getAttackNatureRules(attack).natures;

  const hasEssence = getAttackNatureRules(attack).profile.total > 0;
  const hasPiercingRecoveryBonus = hasEssence && (
    attackNatures.includes("piercingDamage") ||
    attackNatures.includes("transpiercingDamage"));
	
const hasBaseNature =
  attackNatures.includes("physicalDamage") ||
  attackNatures.includes("magicalDamage") ||
  attackNatures.includes("hybridalDamage");

const hasPiercingNature =
  attackNatures.includes("piercingDamage") ||
  attackNatures.includes("transpiercingDamage");

const isTranspiercing = getAttackResolutionFlags(attack).isTranspiercing;

const isPiercing =
  hasEssence && hasPiercingNature &&
  !isTranspiercing;
  const meleeExecBaseBonus = isMeleeAttack ? calculateMeleeExecBonus(entite, attack) : 0;
  const meleeExecStrengthBonus = isMeleeAttack
    ? calculateExecStrengthRatio(Number(getSafe(entite, "strength", 0)) || 0)
    : 0;
  const projectileSpeedReduc = isRangeAttack
    ? clampPercent(getFinalAttackProjectileSpeed(entite))
    : 0;

  const totalExecReduc = isRangeAttack
    ? clampPercent(execReduc + projectileSpeedReduc)
    : isMeleeAttack
      ? clampPercent(execReduc + meleeExecBaseBonus + meleeExecStrengthBonus)
      : execReduc;

const piercingRecupReduc = isPiercing
  ? totalPiercingRecupReductionWithAgi(entite, attack)
  : 0;

const transpiercingRecupReduc = isTranspiercing
  ? totalTranspiercingRecupReductionWithAgi(entite, attack)
  : 0;
  
const specificRecoveryReduc = isTranspiercing
  ? transpiercingRecupReduc
  : isPiercing
    ? piercingRecupReduc
    : 0;

const totalRecoveryReduc = clampPercent(
  recReduc + specificRecoveryReduc,
  0,
  balanceData.attackTime.reductionCapPercent
);
	
  const effective = {
    cooldown:        applyReducToMs(base.cooldown, cdReduc),
    preparationTime: applyReducToMs(base.preparationTime, prepReduc),
    executionTime:   applyReducToMs(base.executionTime, totalExecReduc),
    recoveryTime:    applyReducToMs(base.recoveryTime, totalRecoveryReduc),
  };

  const phase = {
    executionPhaseTime: isRangeAttack
      ? effective.preparationTime
      : effective.executionTime,
  };

  return {
    base,
    effective,
    impactExecutionTime: isMeleeAttack ? Math.max(200, effective.executionTime) : effective.executionTime,
    phase,
    reduc: {
      hasHaste,
      hastePoints,
      hasteBase,

      prepReduc,
      cdReduc,

      execReduc,
      projectileSpeedReduc,
      meleeExecBaseBonus,
      meleeExecStrengthBonus,
      totalExecReduc,

      recReduc,
       isPiercing,
  isTranspiercing,

  piercingRecupReduc,
  transpiercingRecupReduc,
  specificRecoveryReduc,

  totalRecoveryReduc,
    },
  };
}

function isDirectAttackRateEligible(attack, entity, combatFunction) {
  if (!entity || !attack || attack.combatFunction !== combatFunction) return false;
  const targets = normArr(attack?.attackTarget);
  const flags = getAttackResolutionFlags(attack);
  const effects = normArr(attack?.effets);
  const hasExcludedEffect = effects.some(name => {
    const effect = attackEffects.find(entry => entry.effectName === name);
    return !effect || (Number(effect.effectDot) > 0 && Number(effect.effectDuration) > 0)
      || Boolean(effect.summonType || effect.effectSummon)
      || (combatFunction === 'Support' && !['none', 'heal'].includes(name));
  });
  return !(!targets.includes(combatFunction === 'Support' ? 'ally' : 'enemy')
    || targets.includes('hexa') || normArr(attack?.deadTarget).includes('yes')
    || normArr(attack?.type).includes('alteration') || attack?.natureEffectSecondary
    || (!flags.isMelee && !flags.isRange) || hasExcludedEffect
    || (Number(attack.effectDot) > 0 && Number(attack.effectDuration) > 0));
}

// Pure expectation over repeated cycles, shared by damage and direct healing.
function calculateDirectAttackRate(attack, entity) {
  const flags = getAttackResolutionFlags(attack);
  const view = createAttackStatView(entity, attack);
  const amount = Math.max(0, Number(calculateAttackDamagePreview(view, attack).totalDamage) || 0);
  const { effective: timings, reduc } = getEffectiveAttackTimings(attack, view);
  const speed = Math.max(1, Number(getSafe(view, 'speed', 1000)) || 1000);
  if (![amount, speed, ...Object.values(timings)].every(Number.isFinite)) return null;
  const prep = timings.preparationTime;
  const execution = flags.isMelee ? Math.max(200, timings.executionTime)
    : timings.executionTime > 0 ? timings.executionTime : 1000;
  const recovery = timings.recoveryTime;
  const cooldown = timings.cooldown;
  const baseCycle = Math.max(1, cooldown, prep + recovery + speed + (flags.isMelee ? execution : 0));

  const critChance = flags.canCrit ? Math.min(1, Math.max(0, calculateCritTotalChance(view) / 100)) : 0;
  const critBonus = flags.canCrit ? calculateCritDamageBonus(view) : 0;
  const expectedCrit = amount => amount + critChance * (Math.round(amount * (1 + critBonus / 100)) - amount);
  const declaredNatures = normArr(attack.attacknature);
  const canBreak = flags.canBrokenSpell && declaredNatures.includes('magicalDamage')
    && !declaredNatures.includes('physicalDamage') && !declaredNatures.includes('hybridDamage');
  const brokenChance = canBreak ? Math.min(1, Math.max(0, calculateBrokenSpellChance(view) / 100)) : 0;
  const brokenAmount = flags.isMelee && brokenChance > 0
    ? Math.round(amount * calculateBrokenSpellDamage(view) / 100) : 0;
  const ambidextryChance = flags.canAmbidextry
    ? Math.min(1, Math.max(0, calculateAmbidextryTotalChance(view) / 100)) : 0;
  const secondAmount = Math.round(amount * calculateAmbidextryDamageBonus(view) / 100);
  const secondDelay = applyReducToMs(500, reduc.totalExecReduc);
  const secondExecution = flags.isMelee ? Math.max(120, timings.executionTime) : 0;
  const doubleCycle = flags.isMelee
    ? Math.max(baseCycle, cooldown, prep + Math.max(execution, secondDelay + secondExecution) + recovery + speed)
    : baseCycle;

  const directAmount = (1 - brokenChance) * expectedCrit(amount) + brokenChance * expectedCrit(brokenAmount);
  const procAmount = (1 - brokenChance) * ambidextryChance * expectedCrit(secondAmount);
  const expectedAmount = directAmount + procAmount;
  const expectedCycle = baseCycle + (1 - brokenChance) * ambidextryChance * (doubleCycle - baseCycle);
  if (![expectedAmount, expectedCycle].every(Number.isFinite)) return null;
  const projectedCycles = 100;
  return {
    perSecond: expectedAmount * 1000 / expectedCycle,
    perMinute: expectedAmount * 60000 / expectedCycle,
    expectedAmount,
    directAmount,
    procAmount,
    expectedCycle,
    projectedCycles,
    projectedDuration: projectedCycles * expectedCycle,
    expectedProcs: projectedCycles * (1 - brokenChance) * ambidextryChance,
    critChance,
    ambidextryChance,
    brokenChance,
    baseCycle,
    doubleCycle,
    secondDelay,
    firstImpact: speed + prep + execution,
    speed,
    timings,
    range: flags.isRange ? 'distance' : 'melee',
  };
}

const profanationPowerSamples = new Map();

export function getPowerConfigurationSignature() {
  const seen = new WeakSet();
  return JSON.stringify([POWER_RULES, TACTICAL_RULES, powerAttackCatalog, attackEffects,
    attackEffects.map(effect => {
      const handler = getAttackEffectHandler(effect.effectName) || getAttackEffectHandler(effect.effectName, { self: true });
      return [handler?.tacticalConsequence, handler?.tacticalEffects, handler?.tacticalScope, handler?.tacticalMechanics];
    })], (key, value) => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[reference]';
        seen.add(value);
      }
      return value;
    });
}

function estimateProfanationPowerRates(entity, attack, context) {
  const levelResult = calculateProfanationSummonLevel(entity, attack);
  const level = typeof levelResult === 'number' ? levelResult : levelResult.level;
  const template = inheritSummonEssences(getProfanationTemplate(level), attack);
  const definitionKey = JSON.stringify(['profanation', level, template.attackDetails]);
  if (context.depth >= TACTICAL_RULES.maxDepth || context.path.includes(definitionKey) || context.budget.remaining <= 0) {
    return { dps: 0, hps: 0, nonRatePower: 0, inheritedTacticalPower: 0, samples: 0, level, incomplete: true,
      convention: POWER_RATE_HELPER_TEXT.summonLimit };
  }
  const key = `${getPowerConfigurationSignature()}:${definitionKey}`;
  if (profanationPowerSamples.has(key)) return profanationPowerSamples.get(key);
  const candidates = level > 1 ? getAutoReverseArchetypeCandidates(template, level - 1) : [];
  const samples = (candidates.length ? candidates : [null]).map(archetype => {
    const clone = { ...structuredClone(template), reverseArchetype: archetype,
      Archetype: { current: { key: 'egare', step: 0 }, achieve: [], inProgress: [] } };
    const plan = archetype ? buildReverseArchetypePlan(clone, { preview: true }) : null;
    if (plan) {
      clone.Archetype = plan.archetypeState;
      clone.modifierStats = { durable: { statLeveled: plan.delta } };
    }
    const projected = projectEntityForPower(clone);
    const rates = calculateEntityRates(projected, { depth: context.depth + 1,
      path: [...context.path, definitionKey], budget: context.budget });
    const own = evaluateEntityPower(projected);
    const nonRatePower = own.details.filter(row => row.unit !== 'premium').reduce((sum, row) => sum + row.score, 0);
    const fixedPower = own.details.filter(row => row.unit === 'premium').reduce((sum, row) => sum + row.score, 0);
    return { ...rates, archetype: archetype || 'egare',
      nonRatePower: nonRatePower + rates.summonNonRatePower,
      inheritedTacticalPower: fixedPower + rates.tactical.floor + rates.tactical.bonus + rates.inheritedTacticalPower
        + Math.max(0, rates.attackCount - 1) * POWER_RULES.premiums.additionalAttack
        + rates.unmeasured.length * POWER_RULES.unknownCoefficient };
  });
  const average = key => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  const result = { ...summarizePowerSamples(samples), level,
    nonRatePower: average('nonRatePower'), inheritedTacticalPower: average('inheritedTacticalPower'),
    tacticalSamples: samples.map(sample => ({ archetype: sample.archetype, nonRatePower: sample.nonRatePower,
      inheritedTacticalPower: sample.inheritedTacticalPower, tactical: sample.tactical,
      incomplete: sample.incomplete, unmeasured: sample.unmeasured })),
    convention: POWER_RATE_HELPER_TEXT.profanation };
  if (profanationPowerSamples.size >= 250) profanationPowerSamples.clear();
  if (!result.incomplete) profanationPowerSamples.set(key, result);
  return result;
}

function inferredAttackConsequences(attack, directRate) {
  const targets = normArr(attack.attackTarget);
  const flags = getAttackResolutionFlags(attack);
  const { colors, signature } = getAttackNatureRules(attack);
  const ratios = getAttackPowerRatios(attack);
  const harmony = (ratios.physical > 0 && colors.includes('red')) || (ratios.magical > 0 && colors.includes('blue'))
    || (ratios.piercing > 0 && colors.includes('yellow'));
  const tacticalConsequence = [targets.includes('hexa') ? 'terrain' : 'entite',
    ...(targets.includes('enemy') ? ['ennemi'] : []), ...(targets.includes('ally') ? ['allie'] : []),
    ...(!targets.includes('hexa') ? [normArr(attack.deadTarget).includes('yes') ? 'mort' : 'vivant'] : []),
    flags.isRange ? 'distance' : 'melee', ...(harmony ? ['harmonie'] : [])];
  const result = [{ tacticalConsequence }, { tacticalConsequence: ['maitrise'], quantity: getAttackMastery(attack).level }];
  if (directRate) result.push({ tacticalScope: attack.combatFunction === 'Support' ? 'healing' : 'damage',
    tacticalConsequence: ['direct', attack.combatFunction === 'Support' ? 'soin' : 'degats', 'proportionnel'] });
  // Resonance is already included in direct power. Other signatures depend on the target.
  if (signature && signature.key !== 'resonance') result.push({ id: `nature:${signature.key}`,
    tacticalId: `nature:${signature.key}`, tacticalScope: 'attack',
    tacticalConsequence: signature.resistance
      ? ['direct', 'temporaire', 'fixe', signature.sign > 0 ? 'renforcement' : 'affaiblissement']
      : ['direct', 'proportionnel', signature.key === 'effusion' ? 'soin' : 'degats'] });
  return result;
}

export function calculateEntityRates(entity, { depth = 0, path = [], budget = { remaining: TACTICAL_RULES.maxNodes } } = {}) {
  const attacks = readOwnedPowerAttacks(entity, powerAttackCatalog);
  const assumptions = [];
  const unmeasured = [];
  const tacticalResults = new Map();
  let resurrectionCount = 0;
  const actions = attacks.map((attack, index) => {
    try {
      if (--budget.remaining < 0) throw new Error('Limite du parcours des attaques');
      if (attack.unresolvedPower) throw new Error('Définition d’attaque introuvable');
      initializeAttackPowerRatios(attack, { random: createPowerRandom(attack.entityAttackId || attack.functionName || index) });
      const view = createAttackStatView(entity, attack);
      let rate = calculateDirectAttackDps(attack, entity) || calculateDirectAttackHps(attack, entity);
      // DOT payloads remain separately flagged; their ordinary impact is still measurable.
      if (!rate && attack.combatFunction === 'Attaquant' && normArr(attack.attackTarget).includes('enemy')
        && !normArr(attack.deadTarget).includes('yes') && !normArr(attack.attackTarget).includes('hexa')) {
        const direct = calculateDirectAttackRate(attack, entity);
        if (direct) rate = { ...direct, expectedDamage: direct.expectedAmount };
      }
      const { effective } = getEffectiveAttackTimings(attack, view);
      const action = buildPowerAction(attack, rate, effective, getSafe(view, 'speed', 1000), getAttackResolutionFlags(attack));
      action.order = index;
      const collected = collectTacticalConsequences(attack, { effects: attackEffects, mechanicFor: getAttackEffectHandler,
        inferred: inferredAttackConsequences(attack, rate), source: action.key });
      tacticalResults.set(action.key, collected);
      const effects = normArr(attack.effets);
      if (effects.includes('rez')) resurrectionCount++;
      if (effects.includes('summonProfanation')) {
        const estimate = estimateProfanationPowerRates(entity, attack, { depth, path, budget });
        action.summon = { ...estimate, durationMs: 60000, maxActive: 1 };
        action.approximate = true;
        assumptions.push({ key: action.key, ...estimate });
      } else if (effects.includes('summonJarret')) {
        action.healing = 5 * 0.85;
        action.approximate = true;
        assumptions.push({ key: action.key, convention: POWER_RATE_HELPER_TEXT.jarret });
      } else if (!rate && !effects.includes('rez')) {
        unmeasured.push(action.key);
      }
      for (const name of [...effects, ...normArr(attack.selfEffects)]) {
        if (['poison', 'brulure', 'lifesteal'].includes(name)) {
          unmeasured.push(`${action.key}:${name}`);
          assumptions.push({ key: action.key, convention: buildPowerRateAssumption('secondary', name) });
        }
      }
      const signature = getAttackNatureRules(attack).signature;
      if (signature && signature.key !== 'resonance') {
        unmeasured.push(`${action.key}:nature:${signature.key}`);
        assumptions.push({ key: action.key, convention: buildPowerRateAssumption('targetDependent', signature.label) });
      }
      if (collected.incomplete) unmeasured.push(`${action.key}:tactical`);
      return action;
    } catch (error) {
      const key = attack.entityAttackId || attack.attackKey || attack.functionName || `attack-${index}`;
      unmeasured.push(key);
      assumptions.push({ key, convention: buildPowerRateAssumption('error', key, error.message) });
      return null;
    }
  }).filter(Boolean);
  // Use the same credit/weight convention as automatic combat selection.
  const ordered = [...actions].sort((a, b) => b.cooldownMs - a.cooldownMs || a.order - b.order);
  for (const action of actions) action.weight = actions.length - ordered.indexOf(action);
  const result = evaluateActionRates(actions, { horizonMs: actions.some(action => action.summon) ? 60000 : null });
  const tactical = { floor: 0, bonus: 0, rows: [], diagnostics: [], incomplete: false };
  let summonNonRatePower = 0;
  let inheritedTacticalPower = 0;
  for (const action of actions) {
    const contribution = result.actions.find(entry => entry.key === action.key) || {};
    const nonRatePower = (action.summon?.nonRatePower || 0) * (contribution.summonPresence || 0);
    summonNonRatePower += nonRatePower;
    inheritedTacticalPower += (action.summon?.inheritedTacticalPower || 0) * (contribution.summonPresence || 0);
    const basis = { damage: (contribution.dps || 0) * POWER_RULES.dpsCoefficient,
      healing: (contribution.hps || 0) * POWER_RULES.hpsCoefficient,
      summon: (contribution.summonDps || 0) * POWER_RULES.dpsCoefficient
        + (contribution.summonHps || 0) * POWER_RULES.hpsCoefficient + nonRatePower };
    basis.attack = basis.damage + basis.healing + basis.summon;
    const evaluated = evaluateTacticalPower(tacticalResults.get(action.key), basis, { covered: ['dps', 'hps'] });
    tactical.floor += evaluated.floor;
    tactical.bonus += evaluated.bonus;
    tactical.rows.push(...evaluated.rows);
    tactical.diagnostics.push(...evaluated.diagnostics);
    tactical.incomplete ||= evaluated.incomplete;
    if (evaluated.incomplete) unmeasured.push(`${action.key}:tactical`);
  }
  return { ...result, attackCount: attacks.length, resurrectionCount, assumptions, unmeasured: [...new Set(unmeasured)],
    tactical, summonNonRatePower, inheritedTacticalPower,
    incomplete: result.incomplete || tactical.incomplete || unmeasured.length > 0 || assumptions.some(entry => entry.incomplete),
    convention: POWER_RATE_HELPER_TEXT.entity };
}

export function calculateEntityPower(entity, { equipment = null } = {}) {
  const ownedIds = new Set(Object.values(entity?.stuff || {}).flat().filter(id => typeof id === 'string'));
  const equipped = (equipment || loadEquippedItems()).filter(item => ownedIds.has(item?.equippedId));
  const rates = calculateEntityRates(entity);
  const intrinsicEntity = entity.baseStats ? projectEntityForPower(entity) : entity;
  rates.intrinsic = calculateEntityRates(intrinsicEntity);
  return evaluateEntityPower(entity, { equipment: equipped, rates });
}

export function calculateAttackPower(attack, entity) {
  const projected = { ...entity, attackDetails: [attack] };
  const rates = calculateEntityRates(projected);
  return evaluateAttackPowerFromRates(rates);
}

export function calculateArmyPower(army = []) {
  const equipment = loadEquippedItems();
  return evaluateEncounterPower(army.map(entity => ({ entity, power: calculateEntityPower(entity, { equipment }) })));
}

export function calculateDirectAttackDps(attack, entity) {
  if (!isDirectAttackRateEligible(attack, entity, 'Attaquant')) return null;
  const rate = calculateDirectAttackRate(attack, entity);
  return rate && { ...rate, dps: rate.perSecond, damagePerMinute: rate.perMinute,
    expectedDamage: rate.expectedAmount, directDamage: rate.directAmount, procDamage: rate.procAmount };
}

export function calculateDirectAttackHps(attack, entity) {
  if (!isDirectAttackRateEligible(attack, entity, 'Support')) return null;
  const rate = calculateDirectAttackRate(attack, entity);
  const signature = getAttackNatureRules(attack).signature;
  return rate && { ...rate, hps: rate.perSecond, healingPerMinute: rate.perMinute,
    expectedHealing: rate.expectedAmount, directHealing: rate.directAmount, procHealing: rate.procAmount,
    targetDependentHealing: signature?.key === 'effusion'
      ? { label: signature.label, percent: signature.percent } : null };
}


// Max HP en "temps réel": priorité à HP.max, puis maxHP, puis quelques fallbacks
export function calculateExtraLifeMaxHP(entite) {
  const candidates = [
    "HP.max",
    "maxHP",
    "stats.HP.max",
    "stats.maxHP",
    "baseStats.maxHP",
    "stats.baseStats.maxHP"
  ];

  for (const path of candidates) {
    const val = getSafe(entite, path, null);
    const n = toNumber(val, null);
    if (n !== null && n > 0) return n;
  }
  return 0;
}


// 20% fixe
export function calculateExtraLifeBasePercent(config = {}) {
  const cfg = {
    ...balanceData.extraLife.resurrect,
    ...config,
  };
  return parseFloat(toNumber(cfg.basePercent, balanceData.extraLife.resurrect.basePercent).toFixed(cfg.decimals));
}

export function calculateExtraLifeIntelPercent(entite, config = {}) {
  const cfg = {
    ...balanceData.extraLife.resurrect,
    ...config,
  };
  const intelligencePercentPerPoint =
    config.intelligencePercentPerPoint ??
    config.perIntel ??
    cfg.intelligencePercentPerPoint;
  const maxIntelligencePercent =
    config.maxIntelligencePercent ??
    config.maxIntelPercent ??
    cfg.maxIntelligencePercent;

  const intel = calculateIntelligence(entite);
  const raw = intel * toNumber(intelligencePercentPerPoint, balanceData.extraLife.resurrect.intelligencePercentPerPoint);
  const capped = Math.min(raw, toNumber(maxIntelligencePercent, balanceData.extraLife.resurrect.maxIntelligencePercent));

  return parseFloat(capped.toFixed(cfg.decimals));
}

// Y : 20% + Z%
export function calculateExtraLifeTotalPercent(entite, config = {}) {
  const cfg = {
    ...balanceData.extraLife.resurrect,
    ...config,
  };
  const base = calculateExtraLifeBasePercent(config);
  const intelP = calculateExtraLifeIntelPercent(entite, config);
  return Math.max(0, Math.min(100, parseFloat((base + intelP).toFixed(cfg.decimals))));
}

// X : maxHP * Y%
export function calculateExtraLifeRestoredHP(entite, config = {}) {
  const maxHP = calculateExtraLifeMaxHP(entite);
  const totalP = calculateExtraLifeTotalPercent(entite, config);
  return maxHP > 0 ? Math.max(1, Math.ceil(maxHP * (totalP / 100))) : 0;
}

// Agrégateur
export function calculateExtraLifeResurrect(entite, config = {}) {
  const cfg = {
    ...balanceData.extraLife.resurrect,
    ...config,
  };
  const maxHP = calculateExtraLifeMaxHP(entite);
  const basePercent = calculateExtraLifeBasePercent(config);
  const intelPercent = calculateExtraLifeIntelPercent(entite, config);
  const rawPercent = parseFloat((basePercent + intelPercent).toFixed(cfg.decimals));
  const totalPercent = calculateExtraLifeTotalPercent(entite, config);
  const restoredHP = calculateExtraLifeRestoredHP(entite, config);

  return { maxHP, basePercent, intelPercent, rawPercent, totalPercent, restoredHP };
}

const trunc2 = (n) => Math.trunc(n * 100) / 100;

function astralityResult(entity, key = 'fatalSurvival') {
  return getStatSystemResult(entity, key) || calculateStatSources(entity?.baseStats ? getStatSystemInputs(entity)
    : { ...entity?.stats, astrality: getSafe(entity, 'astrality', 0) }, key, { effective: true });
}
export function calculateIntelAstralityRatio(entity) { return astralityResult(entity).bonuses[0]?.value || 0; }
export function calculateAstralityTotal(entity) { return astralityResult(entity).value; }
export function calculateAstralCooldown(entity) {
  return globalThis.umbraProgression.astralCooldownDetails(getSafe(entity, 'astrality', 0), getSafe(entity, 'agility', 0));
}
export function calculateAstralReturn(entity) {
  return globalThis.umbraProgression.astralReturnDetails(getSafe(entity, 'astrality', 0), getSafe(entity, 'strength', 0), getSafe(entity, 'HP', 0), getSafe(entity, 'agility', 0));
}
export function calculateAstralBody(entity) {
  return globalThis.umbraProgression.astralBodyDetails(getSafe(entity, 'astrality', 0), getSafe(entity, 'intelligence', 0));
}

export function calculateHypercognitionRatio(value, config = {}) {
  const { maxValue = 150, maxOutput = 3, midpoint = 50, steepness = 0.045 } = config;
  const logistic = x => 1 / (1 + Math.exp(-steepness * (x - midpoint)));
  const min = logistic(0);
  const max = logistic(maxValue);
  const normalized = (logistic(value) - min) / (max - min);
  const atOne = (logistic(1) - min) / (max - min) * maxOutput;
  const output = 0.5 + (normalized * maxOutput - atOne) * (maxOutput - 0.5) / (maxOutput - atOne);
  return Number(Math.min(Math.max(output, 0), maxOutput).toFixed(2));
}

export function calculateHypercognitionBonus(entite, value = getSafe(entite, 'hypercognition', 0)) {
  const hyperco = Number(value) || 0;
  if (hyperco <= 0) return 0;
  const intelligence = Number(getSafe(entite, 'intelligence', 0)) || 0;
  return Math.round(hyperco + intelligence * calculateHypercognitionRatio(hyperco));
}

export function calculateHypercognitionEssences(entite) {
  return calculateCognitiveEssenceCount(entite);
}
export function calculateCognitiveExplosionTotal(entite) {
  const system = getStatSystemResult(entite, 'cognitiveExplosion');
  if (system) return system.value;
  return Math.max(0, calculateHypercognitionBonus(entite) + (Number(getSafe(entite, 'cognitiveExplosion', 0)) || 0));
}
export function calculateMagicalTotal(entite) {
  const magicalDamage = Number(getSafe(entite, "magicalDamage", 0)) || 0;
  return Math.round(magicalDamage);
}

export function calculateProfanationSummonLevel(entite, attack = entite?.currentAttack) {
  const rawCasterLevel = Number(entite?.level?.current ?? entite?.level);
  const casterLevel = Number.isFinite(rawCasterLevel) ? Math.max(1, Math.floor(rawCasterLevel)) : 1;
  const rawIntelligence = Number(getSafe(entite, 'intelligence', 0));
  const intelligence = Number.isFinite(rawIntelligence) ? Math.max(0, rawIntelligence) : 0;
  const rawRatio = Number(attack?.summonLevelIntelligenceRatio ?? 0.2);
  const ratio = Number.isFinite(rawRatio) ? Math.max(0, rawRatio) : 0.2;
  const maxLevel = Math.min(balanceData.level.will.hardMaxLevel, balanceData.level.progression.tableMaxLevel);
  const rawLevel = intelligence > 0 && ratio > 0 ? casterLevel * ratio * intelligence : 0;
  // Bound before flooring: the reverse-archetype loop must never receive an unbounded budget.
  const level = Math.max(1, Math.floor(Number(Math.min(maxLevel, rawLevel).toFixed(10))));
  return { level, casterLevel, intelligence, ratio, maxLevel };
}

export function calculateLvlMaxBaseEntite(entite, config = {}) {
  const { baseMaxLevel = BASE_MAX_LEVEL } = {
    ...balanceData.level.will,
    ...config,
  };

  const rawBase = Number(getSafe(entite, "level.baseMax", NaN));
  if (Number.isFinite(rawBase)) return Math.max(0, Math.floor(rawBase));

  return baseMaxLevel;
}

export function calculateLvlMaxEntiteWithWill(entite, willValue, config = {}) {
  const base = calculateLvlMaxBaseEntite(entite, config);
  const bonus = calculateLvlMaxBonus(willValue, { ...config, baseMaxLevel: base });
  // Profanation grants a generation level, independent of the summon's own will.
  const grantedLevel = entite?.summonOrigin?.type === 'profanation'
    ? Math.max(0, Math.floor(Number(entite.summonOrigin.generatedLevel) || 0)) : 0;
  return Math.max(0, Math.min(Math.max(base + bonus, grantedLevel), config.hardMaxLevel ?? balanceData.level.will.hardMaxLevel ?? maxLevel));
}

export function calculateLvlMaxEntite(entite, config = {}) {
  const will = getSafe(entite, "stats.will", null) ?? getSafe(entite, "will", 0);
  return calculateLvlMaxEntiteWithWill(entite, will, config);
}

export function calculatewillAwakeBonus(value, config = {}) {
  const cfg = {
    ...balanceData.level.will,
    ...config,
  };
  const {
    pointsPerAwakeningLevel,
    minAwakeningLevels,
    maxAwakeningLevels,
  } = cfg;

  const v   = Math.max(0, Number(value) || 0);
  const raw = Math.ceil(v / pointsPerAwakeningLevel);

  const clamped = Math.max(minAwakeningLevels, Math.min(maxAwakeningLevels, raw));
  return clamped;
}


const LEVEL_WEIGHTS = balanceData.statGraph.levelWeights;

function normalizeNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
// 0 → 150 vitalité => 0% → 5% (cap à 5% au-delà)
export function calculateVitalityRegenPercent(vitality, config = {}) {
  const { maxVitality, maxPercent, decimals } = {
    ...balanceData.regeneration.vitalityDayHp,
    ...config,
  };

  const v = Math.max(0, toNumber(vitality, 0));
  const clamped = Math.min(v, maxVitality);

  const percent = (clamped / maxVitality) * maxPercent; // linéaire
  return parseFloat(percent.toFixed(decimals));
}

export function calculateVitalityRegenAmount(maxHP, regenPercent) {
  const hp = Math.max(0, toNumber(maxHP, 0));
  const p  = Math.max(0, toNumber(regenPercent, 0));

  // Bonus vitalité = 0 si pas de HP exploitable ou pas de %
  if (hp === 0 || p === 0) return 0;

  const raw = hp * (p / 100);

  // Arrondi au plus proche (0.5 -> supérieur), toujours entier >= 0
  return Math.max(0, Math.round(raw));
}

export function calculateTotalRegenAmount(baseRegenAmount, bonusRegenAmount = 0) {
  let base = Math.max(0, Math.round(toNumber(baseRegenAmount, 0)));
  if (base === 0) base = balanceData.regeneration.vitalityDayHp.minTotalBaseAmount;

  const bonus = Math.max(0, Math.round(toNumber(bonusRegenAmount, 0)));
  return base + bonus;
}



export function calculateStatGraphValue(entiteStats, statDefinitions) {
  // Résultat
  const result = {
    force:       { attaque: 0, defense: 0, utilitaire: 0 },
    intelligence:{ attaque: 0, defense: 0, utilitaire: 0 },
    agilite:     { attaque: 0, defense: 0, utilitaire: 0 },
  };

  // Mapping spécial non présent dans les définitions “normales”
  const specialGraphMapping = {
    HP: {
      attribut: "force",
      type: "utilitaire-0.5", // HP.max => force / utilitaire-0.5
      valuePath: "max",
    },
    armor: {
      attribut: "force",
      type: "defense-0.5",
      valuePath: "current",
    },
    extraLife: {
      attribut: "intelligence",
      type: "utilitaire-3", // extraLife.max => intel / utilitaire-3
      valuePath: "max",
    },
  };

  // Index des définitions par key
  const configByKey = (Array.isArray(statDefinitions) ? statDefinitions : []).reduce((acc, def) => {
    if (!def || !def.key) return acc;
    if (!acc[def.key]) acc[def.key] = [];
    acc[def.key].push(def);
    return acc;
  }, {});

  const ignoredKeys = new Set(["strength", "agility", "intelligence", "will", "speed"]);

  // Sécurité : si entiteStats n’est pas un objet, on sort
  if (!entiteStats || typeof entiteStats !== "object") {
    console.warn("[calculateStatGraphValue] entiteStats invalide :", entiteStats);
    return result;
  }

  for (const [key, rawValue] of Object.entries(entiteStats)) {
    // 1) ignorés d’office
    if (ignoredKeys.has(key)) continue;

    // 2) Cas spéciaux (HP, armor, extraLife)
    if (specialGraphMapping[key]) {
      const mapping = specialGraphMapping[key];
      let numeric = 0;

      if (rawValue && typeof rawValue === "object" && mapping.valuePath in rawValue) {
        numeric = normalizeNumber(rawValue[mapping.valuePath]);
      }

      if (!numeric) continue;

      const [category, levelStr] = mapping.type.split("-");
      const weight = getPowerStatDefinition(key, mapping).coefficient;

      if (!weight) continue;
      if (result[mapping.attribut]?.[category] === undefined) continue;

      const score = numeric * weight;
      result[mapping.attribut][category] += score;
      continue;
    }

    // 3) Stats classiques
    let numericValue = rawValue;

    // Si c’est un objet {current, max}, on prend max
    if (rawValue && typeof rawValue === "object" && "max" in rawValue) {
      numericValue = rawValue.max;
    }

    numericValue = normalizeNumber(numericValue);
    if (!numericValue) continue;

    const defs = configByKey[key];
    if (!defs || !defs.length) continue;

    for (const def of defs) {
      const attribut = def.attribut; // "force" / "intelligence" / "agilite" ou null

      if (!attribut || !result[attribut]) continue;

      const typeStr = def.type; // "attaque-1", "defense-2", etc.
      if (!typeStr || !typeStr.includes("-")) continue;

      const [category, levelStr] = typeStr.split("-");
      const bucket = result[attribut][category];
      if (bucket === undefined) continue;

      const weight = getPowerStatDefinition(key, def).coefficient;
      if (!weight) continue;

      const score = numericValue * weight;
      result[attribut][category] += score;
    }
  }

  // Debug (tu peux enlever après vérif)
  console.log("[calculateStatGraphValue] stats =", entiteStats);
  console.log("[calculateStatGraphValue] result =", result);

  return result;
}
// === Broken Spell (range magical) ===

// Base : 30.0 (%)
export function baseBrokenSpellChance() {
  return balanceData.brokenSpell.chance.basePercent;
}

export function intelBrokenSpellChance(entite) {
  if (!entite) return 0.0;
  const cfg = balanceData.brokenSpell.chance;
  const intel = Number(getSafe(entite, "intelligence")) || 0;

  const eased = easeOutPowerRatio(intel, cfg.intelligenceCap, cfg.curvePower);

  const reduc = cfg.intelligenceMaxReductionPercent * eased;
  return roundBalance(clamp(reduc, 0, cfg.intelligenceMaxReductionPercent), cfg.decimals);
}

export function calculateBrokenSpellChance(entite) {
  const cfg = balanceData.brokenSpell.chance;
  const base = baseBrokenSpellChance();
  const reduc = entite ? intelBrokenSpellChance(entite) : 0.0;
  const purityMultiplier = 1 - getAttackNatureRules(entite?.currentAttack).overloadReduction / 100;
  return roundBalance(clamp(base - reduc, 0, cfg.maxPercent) * purityMultiplier, cfg.decimals);
}

export function baseBrokenSpellDamage() {
  return balanceData.brokenSpell.damage.basePercent;
}

export function intelBrokenSpellBaseDamage(entite) {
  if (!entite) return 0.0;
  const cfg = balanceData.brokenSpell.damage;
  const intel = Number(getSafe(entite, "intelligence")) || 0;

  const eased = easeOutPowerRatio(intel, cfg.intelligenceCap, cfg.curvePower);

  const reduc = cfg.intelligenceMaxReductionPercent * eased;
  return roundBalance(clamp(reduc, 0, cfg.intelligenceMaxReductionPercent), cfg.decimals);
}

export function magicalBrokenSpellDamage(entite) {
  if (!entite) return 0.0;
  const cfg = balanceData.brokenSpell.damage;

  // adapte ici si ta stat s'appelle différemment
  const magicAttack =
    Number(getSafe(entite, "magicAttack")) ||
    Number(getSafe(entite, "magicalAttack")) ||
    Number(getSafe(entite, "magicPower")) ||
    Number(getSafe(entite, "magicalPower")) ||
    0;

  const eased = easeOutPowerRatio(magicAttack, cfg.magicalPowerCap, cfg.curvePower);

  const bonus = cfg.magicalPowerMaxBonusPercent * eased;
  return roundBalance(clamp(bonus, 0, cfg.magicalPowerMaxBonusPercent), cfg.decimals);
}

export function calculateBrokenSpellDamage(entite) {
  if (!entite) return 0.0;
  const cfg = balanceData.brokenSpell.damage;

  const total =
    (baseBrokenSpellDamage() - intelBrokenSpellBaseDamage(entite)) +
    magicalBrokenSpellDamage(entite);

  return roundBalance(clamp(total, 0, cfg.maxPercent), cfg.decimals);
}
export function attemptRangeBrokenSpell(attacker, target, attack) {
  // Garde-fous
  if (!attacker || !attack || !canEntityProc(attacker)) {
    return { success: false, damagePct: 0, roll: 0, chance: 0 };
  }

  // Conditions d’éligibilité : range + magique exclusif
  const isRange = attack.attackRange && attack.attackRange.includes("range");
  const n = Array.isArray(attack.attacknature) ? attack.attacknature : [];
  const isMagicalOnly =
    n.includes("magicalDamage") &&
    !n.includes("physicalDamage") &&
    !n.includes("hybridDamage"); // si tu utilises ce tag

  if (!isRange || !isMagicalOnly) {
    return { success: false, damagePct: 0, roll: 0, chance: 0 };
  }

  // Jet
  const chance = calculateBrokenSpellChance(attacker); // 0..100 (1 décimale)
  const roll = Math.random() * 100;
  const success = roll < chance;

  console.log(
    `💥 [Broken Spell] ${attacker.name}${target?.name ? ` → ${target.name}` : ""} — chance ${chance.toFixed(
      1
    )}% | jet ${roll.toFixed(1)} → ${success ? "✅ PÈTE (retour)" : "❌ ok"}`
  );

  // Si ça pète : on calcule le % de dégâts renvoyés + VFX sur le lanceur
  let damagePct = 0;

  if (success) {
    damagePct = calculateBrokenSpellDamage(attacker); // 0..100 (1 décimale)

    // VFX sur le lanceur
    const effectsContainer = document.getElementById(`effectsContainer_${attacker.id}`);
    if (effectsContainer) {
      const brokenVFX = document.createElement("img");

      // ⚠️ adapte le nom/chemin du gif à ton projet
      playCachedGif(brokenVFX, `./media/assets/effects/broken-spell.gif`);
      brokenVFX.className = "effect-vfx broken-spell";
      brokenVFX.style.position = "absolute";
      brokenVFX.style.pointerEvents = "none";
      brokenVFX.style.zIndex = "10";

      effectsContainer.appendChild(brokenVFX);
      removeCombatVisualAfter(brokenVFX, 2100);
    }

    // Message visuel
    EffectMessage(attacker, `Sort brisé ! (-${damagePct.toFixed(1)}%)`);
  }

  return { success, damagePct, roll, chance };
}
export function attemptMeleeBrokenSpell(attacker, target, attack) {
  if (!attacker || !attack || !canEntityProc(attacker)) {
    return { success: false, damagePct: 0, roll: 0, chance: 0 };
  }

  // Conditions : melee + magique exclusif
  const isMelee = attack.attackRange && attack.attackRange.includes("melee");
  const n = Array.isArray(attack.attacknature) ? attack.attacknature : [];
  const isMagicalOnly =
    n.includes("magicalDamage") &&
    !n.includes("physicalDamage") &&
    !n.includes("hybridDamage");

  if (!isMelee || !isMagicalOnly) {
    return { success: false, damagePct: 0, roll: 0, chance: 0 };
  }

  const chance = calculateBrokenSpellChance(attacker); // 0..100
  const roll = Math.random() * 100;
  const success = roll < chance;

  console.log(
    `💥 [Broken Spell MELEE] ${attacker.name}${target?.name ? ` → ${target.name}` : ""} — chance ${chance.toFixed(
      1
    )}% | jet ${roll.toFixed(1)} → ${success ? "✅ PÈTE (double hit)" : "❌ ok"}`
  );

  let damagePct = 0;

  // helper : applique VFX + message sur une entité donnée
  const applyBrokenSpellFeedback = (entite, pct) => {
    if (!entite?.id) return;

    const effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);
    if (effectsContainer) {
      const brokenVFX = document.createElement("img");
      playCachedGif(brokenVFX, `./media/assets/effects/broken-spell.gif`);
      brokenVFX.className = "effect-vfx broken-spell";
      brokenVFX.style.position = "absolute";
      brokenVFX.style.pointerEvents = "none";
      brokenVFX.style.zIndex = "10";
      effectsContainer.appendChild(brokenVFX);
      removeCombatVisualAfter(brokenVFX, 2100);
    }

    EffectMessage(entite, `Sort brisé ! (-${pct.toFixed(1)}%)`);
  };

  if (success) {
    damagePct = calculateBrokenSpellDamage(attacker); // 0..100

    // VFX + message sur le lanceur ET la cible (si cible valide)
    applyBrokenSpellFeedback(attacker, damagePct);
    if (target && target.id !== attacker.id) {
      applyBrokenSpellFeedback(target, damagePct);
    }
  }

  return { success, damagePct, roll, chance };
}


// MELEE GENERAL BONUS
// 0 STR -> 0%
// 150 STR -> 10% max
// bonus entier, arrondi inférieur
export function calculateExecStrengthRatio(strength) {
  const cfg = balanceData.melee.execution;
  const str = Math.max(0, Number(strength) || 0);
  if (str === 0) return 0;

  const ratio = (str / cfg.strengthCap) * cfg.strengthMaxPercent;
  const capped = Math.min(ratio, cfg.strengthMaxPercent);
  return Math.floor(capped);
}

export function calculateMeleeExecBonus(attacker, ctx) {
  if (ctx && typeof ctx === 'object' && getAttackNatureRules(ctx).isInert) return 0;
  const cfg = balanceData.melee.execution;
  let bonus = cfg.basePercent;

  // ctx peut être : statKey (string) OU attack (object)
  const type =
    (typeof ctx === "string")
      ? ctx
      : (ctx?.statKey || ctx?.key || ctx?.attackKey || ctx?.type || null);

  if (type === "meleeAttackMagical") bonus += cfg.magicalTypeBonus;
  if (type === "meleeAttackHybridal") bonus += cfg.hybridalTypeBonus;
  if (type === "meleeAttackpiercing") bonus += cfg.piercingTypeBonus;

  return Math.floor(bonus); // entier
}

export function totalMeleeExecReduction(entite, ctx = null) {
  const attackExecutionReduc = Number(getFinalAttackExecutionReduc(entite)) || 0;
  const meleeReduc = Number(calculateMeleeExecBonus(entite, ctx)) || 0;

  const strength = Number(getSafe(entite, "strength", 0)) || 0;
  const strengthReduc = Number(calculateExecStrengthRatio(strength)) || 0;

  return clampPercent(attackExecutionReduc + meleeReduc + strengthReduc, 0, balanceData.attackTime.reductionCapPercent);
}


export function attemptMeleeExecBonus(attacker, attack, baseExecMs) {
  const base = Number(baseExecMs) || 0;

  const attackTimeCap = balanceData.attackTime.reductionCapPercent;
  const attackExecutionReduc = clampPercent(
    Number(getFinalAttackExecutionReduc(attacker)) || 0,
    0,
    attackTimeCap
  );
  const hasteReduc = clampPercent(Number(calculateHasteExecReduc(attacker)) || 0, 0, attackTimeCap);
  const directExecReduc = Math.max(0, attackExecutionReduc - hasteReduc);
  const meleeReduc = clampPercent(Number(calculateMeleeExecBonus(attacker, attack)) || 0, 0, attackTimeCap);

  const strength = Number(getSafe(attacker, "strength", 0)) || 0;
  const strengthReduc = clampPercent(
    Number(calculateExecStrengthRatio(strength)) || 0,
    0,
    balanceData.melee.execution.strengthMaxPercent
  );

  const totalReduc = clampPercent(attackExecutionReduc + meleeReduc + strengthReduc, 0, attackTimeCap);
  const finalExecMs = applyReducToMs(base, totalReduc);

  return {
    applied: totalReduc > 0,
    totalReduc,
    baseExecMs: base,
    finalExecMs,
    debug: {
      baseExecMs: base,
      attackExecutionReduc,
      directExecReduc,
      hasteReduc,
      meleeReduc,
      strengthReduc,
      totalReduc,
      finalExecMs
    },
  };
}
// piercing GENERAL BONUS (RECUP)
// 0 AGI -> 0%
// 150 AGI -> 10% max
// bonus entier, arrondi inférieur
export function calculateRecupAgilityRatio(agility) {
  const cfg = balanceData.piercing.recovery;
  const agi = Math.max(0, Number(agility) || 0);
  if (agi === 0) return 0;

  const ratio = (agi / cfg.agilityCap) * cfg.agilityMaxPercent;
  const capped = Math.min(ratio, cfg.agilityMaxPercent);
  return Math.floor(capped);
}

export function calculatePiercingRecupBonus(entite, attack = null) {
  return balanceData.piercing.recovery.piercingBasePercent + getAttackNatureRules(attack || entite?.currentAttack).recoveryExtra;
}

export function calculateTranspiercingRecupBonus(entite, attack = null) {
  return balanceData.piercing.recovery.transpiercingBasePercent + getAttackNatureRules(attack || entite?.currentAttack).recoveryExtra;
}

export function calculatePiercingRecupAgiRatio(entite) {
  const cfg = balanceData.piercing.recovery;
  const agility = Number(getSafe(entite, "agility", 0)) || 0;

  return Math.round(cfg.agilityMaxPercent * (agility / (agility + cfg.agilitySoftCapDivider)));
}

export function calculateTranspiercingRecupAgiRatio(entite) {
  const cfg = balanceData.piercing.recovery;
  const agility = Math.max(0, Number(getSafe(entite, "agility", 0)) || 0);

  return Math.round(cfg.transpiercingAgilityMultiplier * Math.log1p(agility / cfg.transpiercingAgilityDivider));
}
export function totalPiercingRecupReductionWithAgi(entite, attack = null) {
  const piercingRecup = Number(calculatePiercingRecupBonus(entite, attack)) || 0;
  const agiRecup = Number(calculatePiercingRecupAgiRatio(entite)) || 0;
  return clampPercent(piercingRecup + agiRecup, 0, balanceData.piercing.recovery.maxReductionPercent);
}

export function totalTranspiercingRecupReductionWithAgi(entite, attack = null) {
  const transpiercingRecup = Number(calculateTranspiercingRecupBonus(entite, attack)) || 0;
  const agiRecup = Number(calculateTranspiercingRecupAgiRatio(entite)) || 0;
  return clampPercent(transpiercingRecup + agiRecup, 0, balanceData.piercing.recovery.maxReductionPercent);
}

export function attemptPiercingRecupBonus(attacker, attack, baseRecupMs) {
  const base = Number(baseRecupMs) || 0;

  const maxReduction = balanceData.piercing.recovery.maxReductionPercent;
  const hasteRecup = clampPercent(Number(calculateHasteRecupReduc(attacker)) || 0, 0, maxReduction);
  const piercingRecup = clampPercent(Number(calculatePiercingRecupBonus(attacker, attack)) || 0, 0, maxReduction);

  const agility = Number(getSafe(attacker, "agility", 0)) || 0;
  const agiRecup = clampPercent(Number(calculateRecupAgilityRatio(agility)) || 0, 0, balanceData.piercing.recovery.agilityMaxPercent);

  const totalReduc = clampPercent(hasteRecup + piercingRecup + agiRecup, 0, maxReduction);
  const finalRecupMs = applyReducToMs(base, totalReduc);

  return {
    applied: totalReduc > 0,
    totalReduc,
    baseRecupMs: base,
    finalRecupMs,
    debug: {
      baseRecupMs: base,
      hasteRecup,
      piercingRecup,
      agility,
      agiRecup,
      totalReduc,
      finalRecupMs,
    },
  };
}

function getGeneratedUmbraStatsConfig() {
  return balanceData.generatedUmbraStats || { tiers: [], sources: {} };
}

export function getGeneratedUmbraStatConfigs() {
  const cfg = getGeneratedUmbraStatsConfig();
  const sources = cfg.sources && typeof cfg.sources === "object" ? cfg.sources : {};

  return Object.entries(sources).reduce((acc, [sourceKey, sourceCfg]) => {
    const source = normalizeStatKey(sourceKey);
    const target = normalizeStatKey(sourceCfg?.target);
    const attribute = normalizeStatKey(sourceCfg?.attribute);
    if (!source || !target || !attribute) return acc;

    acc[source] = {
      source,
      target,
      attribute,
      progressive: !!sourceCfg.progressive,
      ratioPercent: !!sourceCfg.ratioPercent,
      maxPercent: Number(sourceCfg.maxPercent) || 0,
      constant: Math.max(0, Number(sourceCfg.constant) || 0),
      flatPerPoint: Number(sourceCfg.flatPerPoint) || 0,
      decimals: Math.max(0, Number(sourceCfg.decimals ?? 0) || 0),
      tiers: Array.isArray(sourceCfg.tiers) ? sourceCfg.tiers : cfg.tiers,
      ratios: sourceCfg.ratios ? {
        source: Math.max(0, Number(sourceCfg.ratios.source ?? 1) || 0),
        attribute: Math.max(0, Number(sourceCfg.ratios.attribute) || 0),
      } : null,
    };
    return acc;
  }, {});
}

export function getGeneratedUmbraSourceKeys() {
  return Object.keys(getGeneratedUmbraStatConfigs());
}

export function getGeneratedUmbraTargetKeys() {
  return [
    ...new Set(
      Object.values(getGeneratedUmbraStatConfigs())
        .map(cfg => cfg.target)
        .filter(Boolean)
    ),
  ];
}

export function getGeneratedUmbraSourceForTarget(targetKey) {
  const target = normalizeStatKey(targetKey);
  return Object.values(getGeneratedUmbraStatConfigs())
    .find(cfg => cfg.target === target)?.source || null;
}

export function getGeneratedUmbraStatConfig(sourceKey) {
  return getGeneratedUmbraStatConfigs()[normalizeStatKey(sourceKey)] || null;
}

export function getGeneratedUmbraStatTier(sourceKey, attributeValue) {
  const cfg = getGeneratedUmbraStatConfig(sourceKey);
  const attribute = Math.max(0, Number(attributeValue) || 0);
  const tiers = Array.isArray(cfg?.tiers) ? cfg.tiers : [];

  return tiers.find((tier) => {
    const min = Number(tier.minAttribute ?? 0) || 0;
    const rawMax = tier.maxAttribute === Infinity
      ? Infinity
      : Number(tier.maxAttribute ?? Infinity);
    const max = Number.isFinite(rawMax) ? rawMax : Infinity;
    return attribute >= min && attribute <= max;
  }) || tiers[0] || { minAttribute: 0, maxAttribute: Infinity, multiplier: 0 };
}

export function calculateGeneratedUmbraStatRatio(entite, sourceKey, attributeOverride = null) {
  const cfg = getGeneratedUmbraStatConfig(sourceKey);
  if (!cfg) return 0;
  if (cfg.progressive || cfg.ratioPercent) return cfg.ratios.source * getProgressiveRatio(getSafe(entite, cfg.source, 0), cfg.source);
  if (cfg.ratios) return cfg.ratios.source;

  const attributeValue = Math.max(
    0,
    Number(attributeOverride ?? getSafe(entite, cfg.attribute, 0)) || 0
  );

  return Number(getGeneratedUmbraStatTier(sourceKey, attributeValue)?.multiplier ?? 0) || 0;
}

export function calculateGeneratedUmbraStatBonus(
  entite,
  sourceKey,
  sourceOverride = null,
  attributeOverride = null
) {
  const cfg = getGeneratedUmbraStatConfig(sourceKey);
  if (!cfg) return 0;

  const sourceValue = Math.max(
    0,
    Number(sourceOverride ?? getSafe(entite, cfg.source, 0)) || 0
  );
  if (sourceValue <= 0) return 0;

  if (cfg.ratioPercent) return globalThis.umbraProgression.vivaciteDetails(cfg.target, sourceValue,
    Number(attributeOverride ?? getSafe(entite, cfg.attribute, 0)) || 0).generated;
  if (cfg.progressive) return calculateProgressivePower(sourceValue,
    Number(attributeOverride ?? getSafe(entite, cfg.attribute, 0)) || 0, cfg, cfg.source);

  const ratio = calculateGeneratedUmbraStatRatio(entite, cfg.source, attributeOverride);
  const attributeBonus = cfg.ratios
    ? Math.max(0, Number(attributeOverride ?? getSafe(entite, cfg.attribute, 0)) || 0) * cfg.ratios.attribute
    : 0;
  const factor = 10 ** cfg.decimals;
  const bonus = Math.round((sourceValue * ratio + attributeBonus) * factor) / factor;

  return Object.is(bonus, -0) ? 0 : bonus;
}

export function calculateGeneratedUmbraStats(entite) {
  const generated = {};

  for (const cfg of Object.values(getGeneratedUmbraStatConfigs())) {
    const bonus = calculateGeneratedUmbraStatBonus(entite, cfg.source);
    if (bonus > 0) {
      generated[cfg.target] = (Number(generated[cfg.target]) || 0) + bonus;
    }
  }

  return generated;
}

function getGeneratedUmbraStatName(statKey) {
  const key = normalizeStatKey(statKey);
  return stats.find(stat => normalizeStatKey(stat.key) === key)?.name || key;
}

export function getGeneratedUmbraStatDetail(
  entite,
  sourceKey,
  sourceOverride = null,
  attributeOverride = null
) {
  const cfg = getGeneratedUmbraStatConfig(sourceKey);
  if (!cfg) return null;

  const sourceValue = Math.max(
    0,
    Number(sourceOverride ?? getSafe(entite, cfg.source, 0)) || 0
  );
  const attributeValue = Math.max(
    0,
    Number(attributeOverride ?? getSafe(entite, cfg.attribute, 0)) || 0
  );
  const tier = cfg.ratios ? null : getGeneratedUmbraStatTier(cfg.source, attributeValue);
  const ratio = cfg.progressive ? cfg.ratios.source * getProgressiveRatio(sourceValue, cfg.source)
    : calculateGeneratedUmbraStatRatio(entite, cfg.source, attributeValue);
  const bonus = calculateGeneratedUmbraStatBonus(entite, cfg.source, sourceValue, attributeValue);
  const factor = 10 ** cfg.decimals;
  const system = calculateStatSources({ [cfg.source]: sourceValue, [cfg.attribute]: attributeValue }, cfg.target, { effective: true });
  const sourceBonus = cfg.progressive || cfg.ratioPercent ? system.base : cfg.ratios ? Math.round(sourceValue * ratio * factor) / factor : sourceValue;

  return {
    ...cfg,
    sourceValue,
    attributeValue,
    tier,
    ratio,
    bonus,
    system,
    flatBonus: system.umbraFlat,
    sourceBonus,
    attributeBonus: bonus - sourceBonus - system.umbraFlat,
    sourceLabel: getGeneratedUmbraStatName(cfg.source),
    targetLabel: getGeneratedUmbraStatName(cfg.target),
    attributeLabel: getGeneratedUmbraStatName(cfg.attribute),
  };
}

export function getGeneratedUmbraTargetDetail(entite, targetKey, finalOverride = null) {
  const target = normalizeStatKey(targetKey);
  const source = getGeneratedUmbraSourceForTarget(target);
  if (!source) return null;

  const detail = getGeneratedUmbraStatDetail(entite, source);
  if (!detail) return null;

  const pool = getSafe(entite, target, 0);
  const finalValue = Math.max(0, number(finalOverride ?? (target === 'armor'
    ? pool?.totalMax ?? getStatSystemResult(entite, target)?.value ?? pool : pool)));
  const generatedBonus = Math.min(finalValue, Math.max(0, Number(detail.bonus) || 0));

  return {
    ...detail,
    finalValue,
    generatedBonus,
    autonomousValue: Math.max(0, finalValue - generatedBonus),
  };
}

export function brutalityPercantBonus(entite) {
  const cfg = balanceData.damageIntensifiers.brutality;
  const strength = Math.max(0, Number(getSafe(entite, "strength", 0)) || 0);
  const base = cfg.piercingBasePercent + getAttackPurity(entite?.currentAttack).bonus;
  const ratioBonus = brutalityBonus(entite);
  return Math.round(base + ratioBonus);
}

export function brutalityBonus(entite) {
  const cfg = balanceData.damageIntensifiers.brutality;
  const strength = Math.max(0, Number(getSafe(entite, "strength", 0)) || 0);
  return Math.max(cfg.minBonus, Math.round(cfg.maxRatioPercent * (strength / (strength + cfg.softCapDivider))));
}

export function brutalityPhysicalPowerBonus(entite) {
  const physicalPower = Math.max(0, Number(getSafe(entite, "physicalDamage", 0)) || 0);
  const ratioBonusPercent = brutalityBonus(entite) + getAttackPurity(entite?.currentAttack).bonus;
  return Math.max(balanceData.damageIntensifiers.brutality.minBonus, Math.round(physicalPower * (ratioBonusPercent / 100)) );
}

export function brutalityTotalBonus(entite) {
  const physicalPower = Math.max(0, Number(getSafe(entite, "physicalDamage", 0)) || 0);
  return physicalPower + brutalityPhysicalPowerBonus(entite);
}
function getPsionicDamageIntensifierConfig() {
  return balanceData.damageIntensifiers.psionic
    || balanceData.damageIntensifiers.intellect;
}

export function psionicPercantBonus(entite) {
  const cfg = getPsionicDamageIntensifierConfig();
  const base = cfg.piercingBasePercent + getAttackPurity(entite?.currentAttack).bonus;
  const ratioBonus = psionicBonus(entite);
  return Math.round(base + ratioBonus);
}

export function psionicBonus(entite) {
  const cfg = getPsionicDamageIntensifierConfig();
  const intelligence = Math.max(0, Number(getSafe(entite, "intelligence", 0)) || 0);
  return Math.max(cfg.minBonus, Math.round(cfg.maxRatioPercent * (intelligence / (intelligence + cfg.softCapDivider))));
}

export function psionicPMBonus(entite) {
  const magicalPower = Math.max(0, calculateMagicalTotal(entite));
  const ratioBonusPercent = psionicBonus(entite) + getAttackPurity(entite?.currentAttack).bonus;

  return Math.max(
    getPsionicDamageIntensifierConfig().minBonus,
    Math.round(magicalPower * (ratioBonusPercent / 100))
  );
}

export function psionicTotalBonus(entite) {
  const magicalPower = Math.max(0, calculateMagicalTotal(entite));

  return magicalPower + psionicPMBonus(entite);
}

export const intellectPercantBonus = psionicPercantBonus;
export const intellectBonus = psionicBonus;
export const intellectPMBonus = psionicPMBonus;
export const intellectTotalBonus = psionicTotalBonus;

export function attemptMysticismTrance(entite) {
  const chance = canEntityProc(entite) ? calculateMysticismProcChance(entite) : 0;

  if (chance <= 0) {
    return {
      success: false,
      chance: 0,
      roll: null,
      durationMs: 0,
      accelerationPercent: 0,
    };
  }

  const roll = Math.random() * 100;
  const success = roll < chance;

  const durationMs = success ? calculateMysticismTranceDuration(entite) : 0;
  const accelerationPercent = success
    ? calculateMysticismPreparationAcceleration(entite)
    : 0;

  console.log(
    `🔮 ${entite.name} → Mysticisme : ${chance}% | roll ${roll.toFixed(2)} → ${
      success ? "✅ TRANSE" : "❌ échec"
    }`
  );

  if (success) {
    const stopMysticismAnimation = animateMysticism(entite.id, durationMs);

    if (typeof stopMysticismAnimation === "function") {
      entite.stopMysticismAnimation = stopMysticismAnimation;
    }

    EffectMessage(entite, "Transe mystique !");
  }

  return {
    success,
    chance,
    roll: Number(roll.toFixed(2)),
    durationMs,
    accelerationPercent,
  };
}
function getMysticismValue(entite) {
  return Number(getSafe(entite, "mysticism", 0)) || 0;
}

function getIntelligenceValue(entite) {
  return Number(getSafe(entite, "intelligence", 0)) || 0;
}

function roundMysticismValue(value, decimals = balanceData.mysticism.proc.decimals) {
  return roundBalance(value, decimals);
}

function calculateMysticismSoftCapBonus(intelligence, maxBonus, targetIntel, curvePower = 2) {
  const intel = Math.max(0, Number(intelligence) || 0);
  const ratio = Math.min(intel / targetIntel, 1);
  return maxBonus * (1 - Math.pow(1 - ratio, curvePower));
}

export function calculateMysticismBaseProcChance(entite) {
  return getMysticismValue(entite) > 0 ? balanceData.mysticism.proc.baseChancePercent : 0;
}

export function calculateMysticismIntelProcChance(entite) {
  const cfg = balanceData.mysticism.proc;
  if (getMysticismValue(entite) <= 0) return 0;
  return roundMysticismValue(
    calculateMysticismSoftCapBonus(getIntelligenceValue(entite), cfg.intelligenceMaxBonusPercent, cfg.intelligenceTarget, cfg.curvePower),
    cfg.decimals
  );
}

export function calculateMysticismProcChance(entite) {
  const cfg = balanceData.mysticism.proc;
  if (getMysticismValue(entite) <= 0) return 0;
  return roundMysticismValue(
    calculateMysticismBaseProcChance(entite) + calculateMysticismIntelProcChance(entite),
    cfg.totalDecimals
  );
}

export function calculateMysticismBaseTranceDuration(entite) {
  return getMysticismValue(entite) > 0 ? balanceData.mysticism.trance.baseDurationMs : 0;
}

export function calculateMysticismIntelTranceDuration(entite) {
  const cfg = balanceData.mysticism.trance;
  if (getMysticismValue(entite) <= 0) return 0;
  return Math.round(
    calculateMysticismSoftCapBonus(getIntelligenceValue(entite), cfg.intelligenceMaxSeconds, cfg.intelligenceTarget, cfg.curvePower) * 1000
  );
}

export function calculateMysticismTranceDuration(entite) {
  if (getMysticismValue(entite) <= 0) return 0;
  return calculateMysticismBaseTranceDuration(entite) + calculateMysticismIntelTranceDuration(entite);
}

export function calculateMysticismBasePreparationAcceleration(entite) {
  return getMysticismValue(entite) > 0 ? balanceData.mysticism.preparation.baseAccelerationPercent : 0;
}

export function calculateMysticismIntelPreparationAcceleration(entite) {
  const cfg = balanceData.mysticism.preparation;
  if (getMysticismValue(entite) <= 0) return 0;
  return roundMysticismValue(
    calculateMysticismSoftCapBonus(getIntelligenceValue(entite), cfg.intelligenceMaxBonusPercent, cfg.intelligenceTarget, cfg.curvePower),
    cfg.decimals
  );
}

export function calculateMysticismPreparationAcceleration(entite) {
  const cfg = balanceData.mysticism.preparation;
  if (getMysticismValue(entite) <= 0) return 0;
  return roundMysticismValue(
    calculateMysticismBasePreparationAcceleration(entite) +
      calculateMysticismIntelPreparationAcceleration(entite),
    cfg.decimals
  );
}

export function calculateMysticismBaseDamageBonus(entite) {
  return getMysticismValue(entite) > 0 ? balanceData.mysticism.damage.baseBonusPercent : 0;
}

export function calculateMysticismIntelDamageBonus(entite) {
  const cfg = balanceData.mysticism.damage;
  if (getMysticismValue(entite) <= 0) return 0;
  return roundMysticismValue(
    calculateMysticismSoftCapBonus(getIntelligenceValue(entite), cfg.intelligenceMaxBonusPercent, cfg.intelligenceTarget, cfg.curvePower),
    cfg.decimals
  );
}

export function calculateMysticismTotalDamageBonus(attacker) {
  const cfg = balanceData.mysticism.damage;
  if (getMysticismValue(attacker) <= 0) return 0;
  return roundMysticismValue(
    calculateMysticismBaseDamageBonus(attacker) + calculateMysticismIntelDamageBonus(attacker),
    cfg.decimals
  );
}
function vivaciteResult(entity, key) {
  const system = getStatSystemResult(entity, key);
  if (system) return system;
  const inputs = entity?.baseStats ? getStatSystemInputs(entity) : { ...entity?.stats, vivacite: getSafe(entity, 'vivacite', 0) };
  return calculateStatSources(inputs, key, { effective: true });
}
export function calculateControlledSpeed(entity) { return vivaciteResult(entity, 'controlledSpeed').value; }
export function calculateAgileRetreatChance(entity) { return globalThis.umbraProgression.retreatChance(vivaciteResult(entity, 'velocity').value); }
function equilibreResult(entity, key) {
  const system = getStatSystemResult(entity, key);
  if (system) return system;
  const inputs = entity?.baseStats ? getStatSystemInputs(entity)
    : { ...entity?.stats, equilibre: getSafe(entity, 'equilibre', 0) };
  return calculateStatSources(inputs, key, { effective: true });
}
export function calculateEquilibreBaseAggroReduction(entity) {
  return equilibreResult(entity, 'equilibreAggroReduction').base;
}
export function calculateEquilibreIntelAggroReduction(entity) {
  return equilibreResult(entity, 'equilibreAggroReduction').bonuses[0]?.value || 0;
}
export function calculateEquilibreAggroReduction(entity) {
  return equilibreResult(entity, 'equilibreAggroReduction').value;
}
export function calculateEquilibreBaseInvisibleDetection(entity) {
  return equilibreResult(entity, 'equilibreInvisibleDetection').base;
}
export function calculateEquilibreAgiInvisibleDetection(entity) {
  return equilibreResult(entity, 'equilibreInvisibleDetection').bonuses[0]?.value || 0;
}
export function calculateEquilibreInvisibleDetection(entity) {
  return equilibreResult(entity, 'equilibreInvisibleDetection').value;
}
export function calculateEquilibreBaseBalancedAttackChance(entity) {
  return globalThis.umbraProgression.balancedAttackDetails(equilibreResult(entity, 'equilibreBalancedAttackChance').umbra, 0).percent;
}
export function calculateEquilibreIntelBalancedAttackChance(entity) {
  return equilibreResult(entity, 'equilibreBalancedAttackChance').generated - calculateEquilibreBaseBalancedAttackChance(entity);
}
export function calculateEquilibreAttackChance(entity) {
  return equilibreResult(entity, 'equilibreBalancedAttackChance').value;
}
export function attemptEquilibreAttack(entite) {
  const chance = canEntityProc(entite) ? calculateEquilibreAttackChance(entite) : 0;

  if (chance <= 0) {
    entite.attackBalancedNoAggro = false;
    return { success: false, chance: 0, roll: null };
  }

  const roll = Math.random() * 100;
  const success = roll < chance;

  entite.attackBalancedNoAggro = success;

  if (entite.currentAttack) {
    entite.currentAttack.isBalancedNoAggro = success;
  }

  console.log(
    `⚖️ ${entite.name} → Attaque équilibrée : ${chance}% | roll ${roll.toFixed(2)} → ${
      success ? "✅ 0 aggro" : "❌ aggro normale"
    }`
  );

  if (success) {
    const sprite = document.getElementById(`DragSprite_${entite.id}`);
    let effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);

    if (!effectsContainer && sprite?.parentNode) {
      effectsContainer = document.createElement("div");
      effectsContainer.id = `effectsContainer_${entite.id}`;
      effectsContainer.className = "effects-container";
      sprite.parentNode.appendChild(effectsContainer);
    }

    if (effectsContainer) {
      const balanceVFX = document.createElement("img");
      playCachedGif(balanceVFX, `./media/assets/effects/balance-strike.gif`);
      balanceVFX.className = "effect-vfx balance-strike";
      balanceVFX.alt = "";
      balanceVFX.style.position = "absolute";
      balanceVFX.style.pointerEvents = "none";
      balanceVFX.style.zIndex = "12";

      effectsContainer.appendChild(balanceVFX);
      removeCombatVisualAfter(balanceVFX, 3500);
    }

    EffectMessage(entite, "Attaque équilibrée !");
  }

  return {
    success,
    chance,
    roll: Number(roll.toFixed(2)),
  };
}
const FORCED_INVISIBLE_TARGET_ACCURACY_FLAG = "forcedInvisibleTargetAccuracy";

export function isOccultismInvisibleTarget(target) {
  return (
    Boolean(target?.flags?.occultismInvisible) ||
    Boolean(target?.isInvisible) ||
    Boolean(target?.invisible)
  );
}

export function markForcedInvisibleTargetAccuracy(attacker, target, source = "targeting") {
  if (!attacker || !target || target.id == null || !isOccultismInvisibleTarget(target)) return;

  if (!attacker.flags || typeof attacker.flags !== "object") {
    attacker.flags = {};
  }

  attacker.flags[FORCED_INVISIBLE_TARGET_ACCURACY_FLAG] = {
    targetId: String(target.id),
    source,
    createdAt: clockNow(),
  };
}

export function clearForcedInvisibleTargetAccuracy(attacker, target = null) {
  const marker = attacker?.flags?.[FORCED_INVISIBLE_TARGET_ACCURACY_FLAG];
  if (!marker) return;

  if (target?.id != null && String(marker.targetId) !== String(target.id)) {
    return;
  }

  delete attacker.flags[FORCED_INVISIBLE_TARGET_ACCURACY_FLAG];
}

export function shouldApplyForcedInvisibleTargetAccuracy(attacker, target) {
  const marker = attacker?.flags?.[FORCED_INVISIBLE_TARGET_ACCURACY_FLAG];
  if (!marker || !target || target.id == null) return false;
  if (String(marker.targetId) !== String(target.id)) return false;

  return isOccultismInvisibleTarget(target);
}

function getOccultismValue(entite) {
  return Number(getSafe(entite, "occultism", 0)) || 0;
}

function getOccultismAgilityValue(entite) {
  return Number(getSafe(entite, "agility", 0)) || 0;
}

function roundOccultismValue(value, decimals = balanceData.occultism.invisibility.decimals) {
  return roundBalance(value, decimals);
}

function calculateOccultismSoftCapBonus(value, maxBonus, targetValue, curvePower = 2) {
  const v = Math.max(0, Number(value) || 0);
  const ratio = Math.min(v / targetValue, 1);
  return maxBonus * (1 - Math.pow(1 - ratio, curvePower));
}

export function calculateOccultismBaseInvisibilityChance(entite) {
  return getOccultismValue(entite) > 0 ? balanceData.occultism.invisibility.baseChancePercent : 0;
}

export function calculateOccultismAgiInvisibilityChance(entite) {
  const cfg = balanceData.occultism.invisibility;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(
    calculateOccultismSoftCapBonus(getOccultismAgilityValue(entite), cfg.agilityMaxBonusPercent, cfg.agilityTarget, cfg.curvePower),
    cfg.decimals
  );
}

export function calculateOccultismInvisibilityChance(entite) {
  const cfg = balanceData.occultism.invisibility;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(
    calculateOccultismBaseInvisibilityChance(entite) +
      calculateOccultismAgiInvisibilityChance(entite),
    cfg.decimals
  );
}

export function calculateOccultismBaseTargetableChance(entite) {
  return getOccultismValue(entite) > 0 ? balanceData.occultism.targetable.baseChancePercent : 0;
}

export function calculateOccultismAgiTargetableChance(entite) {
  const cfg = balanceData.occultism.targetable;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(
    calculateOccultismSoftCapBonus(getOccultismAgilityValue(entite), cfg.agilityMaxBonusPercent, cfg.agilityTarget, cfg.curvePower),
    cfg.decimals
  );
}

export function calculateOccultismTargetableChance(entite) {
  const cfg = balanceData.occultism.targetable;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(
    calculateOccultismBaseTargetableChance(entite) -
      calculateOccultismAgiTargetableChance(entite),
    cfg.decimals
  );
}

export function calculateOccultismBaseDodgeBonus(entite) {
  return getOccultismValue(entite) > 0 ? balanceData.occultism.dodge.baseBonusPercent : 0;
}

export function calculateOccultismAgiDodgeBonus(entite) {
  const cfg = balanceData.occultism.dodge;
  if (getOccultismValue(entite) <= 0) return 0;

  return Math.round(
    calculateOccultismSoftCapBonus(getOccultismAgilityValue(entite), cfg.agilityMaxBonusPercent, cfg.agilityTarget, cfg.curvePower)
  );
}

export function calculateOccultismDodgeBonus(entite) {
  if (getOccultismValue(entite) <= 0) return 0;

  return Math.round(
    calculateOccultismBaseDodgeBonus(entite) +
    calculateOccultismAgiDodgeBonus(entite)
  );
}

export function calculateOccultismBaseCritChanceBonus(entite) {
  return balanceData.occultism.critical.baseChanceBonusPercent;
}

export function calculateOccultismAgiCritChanceBonus(entite) {
  const cfg = balanceData.occultism.critical;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(
    calculateOccultismSoftCapBonus(getOccultismAgilityValue(entite), cfg.agilityMaxBonusPercent, cfg.agilityTarget, cfg.curvePower),
    cfg.decimals
  );
}

export function calculateOccultismCritChanceBonus(entite) {
  const cfg = balanceData.occultism.critical;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(
    calculateOccultismAgiCritChanceBonus(entite),
    cfg.decimals
  );
}
export function calculateOccultismShadowFragilityPercent(entite) {
  return getOccultismValue(entite) > 0 ? balanceData.occultism.drawbacks.shadowFragilityPercent : 0;
}
export function calculateOccultismPreparationSpeedDebuff(entite) {
  return getOccultismValue(entite) > 0 ? balanceData.occultism.drawbacks.preparationSpeedDebuffPercent : 0;
}
export function calculateOccultismTargetableChanceDisplay(entite) {
  const cfg = balanceData.occultism.targetable;
  if (getOccultismValue(entite) <= 0) return 0;
  return roundOccultismValue(cfg.displayBasePercent - calculateOccultismTargetableChance(entite), cfg.decimals);
}

function getOccultismDomNodes(entite) {
  const id = entite?.id;
  if (!id) return [];

  return [
    getBattleEntityElement(entite),
    document.getElementById(`DragSprite_${id}`),
    document.getElementById(`spriteCanvas_${id}`),
    document.getElementById(`Animationsprite_${id}`),
  ].filter(Boolean);
}

export function setOccultismInvisibleState(entite) {
  if (!entite) return;

  entite.isInvisible = true;
  entite.invisible = true;

  entite.flags = entite.flags || {};
  entite.flags.occultismInvisible = true;

  getOccultismDomNodes(entite).forEach(node => {
    node.classList.add("invisible", "occultism-invisible");
    node.dataset.invisible = "true";
  });
}

export function clearOccultismInvisibleState(entite) {
  if (!entite) return;

  entite.isInvisible = false;
  entite.invisible = false;

  if (entite.flags) {
    entite.flags.occultismInvisible = false;
  }

if (typeof entite.stopOccultismAnimation === "function") {
  entite.stopOccultismAnimation();
  entite.stopOccultismAnimation = null;
}

if (typeof entite.removeOccultismDodgeBoost === "function") {
  entite.removeOccultismDodgeBoost();
  entite.removeOccultismDodgeBoost = null;
}

  getOccultismDomNodes(entite).forEach(node => {
    node.classList.remove("invisible", "occultism-invisible");
    delete node.dataset.invisible;
  });
}
export function attemptOccultismInvisibility(entite) {
  const chance = canEntityProc(entite) ? calculateOccultismInvisibilityChance(entite) : 0;

  if (chance <= 0) {
    return { success: false, chance: 0, roll: null };
  }

  const roll = Math.random() * 100;
  const success = roll < chance;

  console.log(
    `🌑 ${entite.name} → Occultisme : ${chance}% | roll ${roll.toFixed(2)} → ${
      success ? "✅ INVISIBLE jusqu'à la fin de la préparation" : "❌ visible"
    }`
  );

  if (success) {
    setOccultismInvisibleState(entite);
if (typeof entite.removeOccultismDodgeBoost === "function") {
  entite.removeOccultismDodgeBoost();
  entite.removeOccultismDodgeBoost = null;
}

const dodgeBoost = entityBattleBooste(entite, {
  stat: "dodge",
  value: calculateOccultismDodgeBonus(entite),
  source: "occultismInvisible",
  mode: "flat",
  durationMs: null,
  stackable: false,
});

entite.removeOccultismDodgeBoost = dodgeBoost.remove;
    if (typeof entite.stopOccultismAnimation === "function") {
      entite.stopOccultismAnimation();
      entite.stopOccultismAnimation = null;
    }

    entite.stopOccultismAnimation = animateOccultism(entite.id);

    EffectMessage(entite, "Invisible !");
  }
  return {
    success,
    chance,
    roll: Number(roll.toFixed(2)),
  };
}
export function applyOccultismExitCritBoost(entite) {
  if (!entite) {
    return { applied: false, remove: () => {} };
  }

  const critBonus = Number(calculateOccultismCritChanceBonus(entite)) || 0;

  if (critBonus <= 0) {
    return { applied: false, remove: () => {} };
  }

  if (typeof entite.removeOccultismCritBoost === "function") {
    entite.removeOccultismCritBoost();
    entite.removeOccultismCritBoost = null;
  }

  const critBoost = entityBattleBooste(entite, {
    stat: "criticalChance",
    value: critBonus,
    source: "occultismExitCrit",
    mode: "flat",
    durationMs: null,
    stackable: false,
  });

  entite.removeOccultismCritBoost = critBoost.remove;

  console.log(
    `🌑 Critique occulte appliqué : ${entite.name} | +${critBonus}% chance critique prochaine attaque`
  );

  return critBoost;
}

function getMovementValue(entite) {
  const movement = getSafe(entite, "movement", 0);

  if (movement && typeof movement === "object") {
    return Math.max(
      0,
      Math.round(Number(movement.max ?? movement.value ?? movement.current ?? 0) || 0)
    );
  }

  return Math.max(0, Math.round(Number(movement) || 0));
}

function getMovementAgilityValue(entite) {
  return Math.max(0, Number(getSafe(entite, "agility", 0)) || 0);
}

function calculateMovementAgilityPercent(entite) {
  const movementValue = getMovementValue(entite);
  const cfg = balanceData.movement.charges;

  if (movementValue <= 0) return 0;

  const agility = getMovementAgilityValue(entite);
  const percent = (agility / cfg.marathonAgilityCap) * cfg.marathonMaxPercent;

  return Math.max(0, Math.min(cfg.marathonMaxPercent, Math.round(percent)));
}

export function calculateMovementMaxCharges(entite) {
  return getMovementValue(entite);
}
export function calculateMovementStartingChargeDetails(entite) {
  const cfg = balanceData.movement.charges;
  const maxCharges = calculateMovementMaxCharges(entite);

  if (maxCharges <= 0) {
    return {
      totalCurrent: 0,
      basePercent: 0,
      agiRatioCurrent: 0,
    };
  }

  const agility = getMovementAgilityValue(entite);

  const basePercent = cfg.baseStartingPercent;
  const maxAgilityBonusPercent = cfg.maxAgilityStartingBonusPercent;
  const agilityHardCap = cfg.agilityCap;
  const softCapDivider = cfg.startingSoftCapDivider;

  const agiRatioCurrent =
    agility >= agilityHardCap
      ? maxAgilityBonusPercent
      : maxAgilityBonusPercent * (1 - Math.exp(-agility / softCapDivider));

  const totalCurrent = Math.min(cfg.maxStartingPercent, basePercent + agiRatioCurrent);

  return {
    totalCurrent: Math.round(totalCurrent),
    basePercent,
    agiRatioCurrent: Math.round(agiRatioCurrent),
  };
}

export function calculateMovementStartingChargePercent(entite) {
  return calculateMovementStartingChargeDetails(entite).totalCurrent;
}

export function calculateMovementStartingCharges(entite) {
  const maxCharges = calculateMovementMaxCharges(entite);
  const percent = calculateMovementStartingChargePercent(entite);

  if (maxCharges <= 0) return 0;

  return Math.max(0, Math.min(maxCharges, Math.ceil(maxCharges * percent / 100)));
}

export function calculateShiftDailyStartingCharges(entite) {
  const shift = entite?.stats?.shift;
  if (!shift || shift.baseDefault) return 0;
  return calculateMovementStartingCharges({ stats: {
    movement: shift.max,
    agility: entite.stats.agility,
  } });
}

export function calculateMovementMarathonChance(entite) {
  if (getMovementValue(entite) <= 0) return 0;
  const cfg = balanceData.movement.charges;
  return Math.min(cfg.chanceMaxPercent, Math.floor(cfg.marathonBasePercent
    + Math.max(0, Number(getSafe(entite, 'agility', 0)) || 0) * cfg.marathonAgilityRatio));
}

// export function calculateMovementTrailerChance(entite) {
  // const agility = Math.max(0, Number(getSafe(entite, "agility", 0)) || 0);

  // return Math.min(100, Math.round((agility / 150) * 10));
// }
export function calculateMovementTrailerChance(entite) {
  const movementValue = getMovementValue(entite);
  if (movementValue <= 0) return 0;

  const cfg = balanceData.movement.charges;
  return Math.min(cfg.chanceMaxPercent, Math.floor(cfg.trailerBasePercent + movementValue * cfg.trailerMovementRatio));
}

export function ensureMovementState(entite, { reset = false } = {}) {
  if (!entite) return { current: 0, max: 0 };
  if (!entite.stats) entite.stats = {};

  const rawShift = entite.stats.shift;
  const hasShiftObject = rawShift && typeof rawShift === "object";

  const movementMax = Math.max(0, Math.round(calculateMovementMaxCharges(entite)));

  const max = hasShiftObject
    ? Math.max(0, Math.round(Number(rawShift.max) || 0))
    : movementMax;

  if (reset || !hasShiftObject) {
    entite.stats.shift = {
      ...(rawShift?.baseDefault ? { baseDefault: true } : {}),
      current: hasShiftObject
  ? Math.round(Number(rawShift.current) || 0)
  : calculateMovementStartingCharges(entite),
      max,
    };

    return entite.stats.shift;
  }

  entite.stats.shift.max = max;
entite.stats.shift.current = Math.round(Number(entite.stats.shift.current) || 0);
  return entite.stats.shift;
}

 function initializeMovementStateAtBattleStart(entite) {
  const movement = ensureMovementState(entite, { reset: true });
  updateMovementDisplay(entite);
  return movement;
}

export function initializeAllMovementStatesAtBattleStart(entityList = entites) {
  if (!Array.isArray(entityList)) return [];
  return entityList.map(entite => initializeMovementStateAtBattleStart(entite));
}

function getMovementCounterState(entite) {
  const current = Math.round(Number(entite?.stats?.shift?.current) || 0);
  const max = Math.max(0, Math.round(Number(entite?.stats?.shift?.max) || 0));
  const durable = entite?.modifierStats?.durable;
  // Keep progression, but exclude equipment and temporary effects from the comparison.
  const native = entite?.baseStats ? getStatSystemResult({
    ...entite,
    modifierStats: { durable: { ...durable, stuff: { byId: {} } } },
    battleBoosts: {},
    _statSystemOverrides: undefined,
  }, 'shift') : null;
  const delta = entite?.baseStats ? max - (native?.value ?? 1) : 0;
  const extra = getEquipmentResourceCurrent(entite, 'shift')
    + Math.max(0, Number(entite?.resourceStocks?.shift?.temporary) || 0)
    + Math.max(0, Number(entite?.resourceStocks?.shift?.spell) || 0);
  return { current, max, delta, extra };
}

export function renderMovementCounter(node, entite, state = getMovementCounterState(entite)) {
  const { current, max, delta, extra } = state;
  let text = node;
  if (node.classList.contains('movement-counter')) {
    text = node.querySelector('.counter-shift');
    if (!text) {
      text = document.createElement('span');
      text.className = 'counter-shift hu';
      node.appendChild(text);
    }
  }
  text.innerHTML = `${text !== node ? ': ' : ''}<span class="current-shift current">${current}</span> / <span class="current-shift max">${max}</span>`;
  const currentSpan = text.querySelector('.current');
  const maxSpan = text.querySelector('.max');
  currentSpan.classList.toggle('negative-shift', current < 0);
  currentSpan.classList.toggle('movement-reduced', delta < 0 || current < 0);
  currentSpan.classList.toggle('movement-overflow', delta >= 0 && current > max);
  currentSpan.classList.toggle('movement-buffed', delta >= 0 && current >= 0 && current <= max && (delta > 0 || extra > 0));
  maxSpan.classList.toggle('movement-reduced', delta < 0);
  maxSpan.classList.toggle('movement-buffed', delta > 0);
  node.classList.toggle('empty', current <= 0);
  node.classList.toggle('full', current >= max && max > 0);
  return currentSpan;
}

export function updateMovementDisplay(entite, { animate = true } = {}) {
  if (!entite?.id) return;

  const rawMovement = entite?.stats?.shift;
  if (!rawMovement || typeof rawMovement !== "object") return;

  const previousCurrent = Number(rawMovement._lastDisplayedCurrent ?? rawMovement.current);

  const current = Math.round(Number(rawMovement.current) || 0);
  const max = Math.max(0, Math.round(Number(rawMovement.max) || 0));

  rawMovement.current = current;
  rawMovement.max = max;

  const hasGeneratedMove =
  animate &&
  current > previousCurrent &&
  previousCurrent < max &&
  current <= max;

  const state = getMovementCounterState(entite);
  document
    .querySelectorAll(`[data-movement-entity-id="${entite.id}"]`)
    .forEach(el => {
      const currentSpan = renderMovementCounter(el, entite, state);

      if (hasGeneratedMove && currentSpan) {
        battleLogs("trail_move_generated", {
          entity: entite
        });

        currentSpan.classList.remove("bounce-shift");
        void currentSpan.offsetWidth;
        currentSpan.classList.add("bounce-shift");

        setTimeout(() => {
          currentSpan.classList.remove("bounce-shift");
        }, 500);
      }

    });

  rawMovement._lastDisplayedCurrent = current;
}
export function createMovementDisplay(entite) {
  ensureMovementState(entite);

  const wrapper = document.createElement("div");
  wrapper.className = "movement-charge-display";
  wrapper.setAttribute("data-movement-entity-id", entite.id);
  renderMovementCounter(wrapper, entite);

  return wrapper;
}
export function animateMoveCounter(counterElement) {
    if (!counterElement) return;

    counterElement.classList.remove("counter-pop");
    void counterElement.offsetWidth;
    counterElement.classList.add("counter-pop");
}
export function refillEntityMovement(entite, amount = balanceData.movement.charges.refillBaseAmount) {
  const movement = ensureMovementState(entite);

  if (movement.max <= 0) {
    updateMovementDisplay(entite);
    return movement;
  }

  const before = movement.current;

const isAlreadyFull = movement.current >= movement.max;

const trailer = isAlreadyFull
  ? { success: false, chance: 0, roll: null, disabled: true, reason: "movement-full" }
  : attemptMovementTrailer(entite);

const refillAmount = trailer.success
  ? balanceData.movement.charges.trailerRefillAmount
  : Math.max(0, Math.round(Number(amount) || 0));
refillNaturalMovement(entite, refillAmount);

movement.trailer = trailer;

  updateMovementDisplay(entite);

if (movement.current !== before && trailer.success) {
  document
    .querySelectorAll(`[data-movement-entity-id="${entite.id}"] .counter-shift.hu`)
    .forEach(currentValue => {
      currentValue.classList.remove("trailer-proc-highlight");
      void currentValue.offsetWidth;
      currentValue.classList.add("trailer-proc-highlight");

      setTimeout(() => {
        currentValue.classList.remove("trailer-proc-highlight");
      }, 1000);
    });
}
  console.log(
    `👣 Recharge mouvement : ${entite.name} ${before}/${movement.max} → ${movement.current}/${movement.max}`
  );

  return movement;
}
export function attemptMovementMarathon(entite) {
  if (!canEntityProc(entite)) return { success: false, chance: 0, roll: null };
  // const chance = Math.max(
    // 0,
    // Math.min(100, Number(calculateMovementMarathonChance(entite)) || 0)
  // );
const chance = Math.max(
  0,
  Math.min(balanceData.movement.charges.chanceMaxPercent, Number(getMarathonChance(entite)) || 0)
);
  if (chance <= 0) {
    return {
      success: false,
      chance,
      roll: null,
    };
  }

  const roll = Math.random() * 100;
  const success = roll < chance;

  console.log(
    `🏃 Marathonien : ${entite.name} | ${chance}% | roll ${roll.toFixed(2)} → ${
      success ? "✅ déplacement gratuit" : "❌ charge consommée"
    }`
  );

  return {
    success,
    chance,
    roll: Number(roll.toFixed(2)),
  };
}


export function attemptMovementTrailer(entite) {
  if (!canEntityProc(entite)) return { success: false, chance: 0, roll: null };
  const movementValue = getMovementValue(entite);

  if (movementValue <= 0) {
    return {
      success: false,
      chance: 0,
      roll: null,
      disabled: true,
    };
  }

const chance = Math.max(
  0,
  Math.min(balanceData.movement.charges.chanceMaxPercent, Number(getTrailerChance(entite)) || 0)
);

  if (chance <= 0) {
    return {
      success: false,
      chance,
      roll: null,
    };
  }

  const roll = Math.random() * 100;
  const success = roll < chance;

  return {
    success,
    chance,
    roll: Number(roll.toFixed(2)),
  };
}

export function getMarathonChance(entiteOrValue) {
  return Number(
    typeof entiteOrValue === "number"
      ? entiteOrValue
      : getSafe(entiteOrValue, "marathon", 0)
  ) || 0;
}

export function getTrailerChance(entiteOrValue) {
  return Number(
    typeof entiteOrValue === "number"
      ? entiteOrValue
      : getSafe(entiteOrValue, "trailer", 0)
  ) || 0;
}

export function consumeEntityMovement(entite, amount = 1) {
  const rawMovement = entite?.stats?.shift;
  if (isEntityMovementBlocked(entite)) return { allowed: false, consumed: false, reason: 'immobilised', movement: rawMovement };

  if (
    !rawMovement ||
    typeof rawMovement !== "object" ||
    rawMovement.current == null ||
    Number(rawMovement.current) < 1
  ) {
    return {
      allowed: false,
      consumed: false,
      reason: "not-enough-current-movement",
      movement: rawMovement || { current: 0, max: 0 },
    };
  }

  const movement = ensureMovementState(entite);

  const marathon = attemptMovementMarathon(entite);

  if (marathon.success) {
    updateMovementDisplay(entite);

    return {
      allowed: true,
      consumed: false,
      reason: "marathon",
      movement,
      marathon,
    };
  }

  const weight = getMovementWeightMalus(entite);
  const weightResistance = weight.shiftCostModifier > 0
    ? attemptAlterationResistance(entite, entite, { type: ['entrave'], effectName: 'weight', increasesMovementCost: true }) : null;
  const cost = Math.max(1, Math.round(Number(amount) || 1))
    + (weightResistance?.canceled ? 0 : Number(weight?.shiftCostModifier || 0));

  const before = movement.current;
  spendMovementCharges(entite, cost);

  updateMovementDisplay(entite);

  console.log(
    `👣 Mouvement consommé : ${entite.name} ${before}/${movement.max} → ${movement.current}/${movement.max} coût ${cost}`
  );

  return {
    allowed: true,
    consumed: true,
    reason: "consumed",
    movement,
    marathon,
    cost,
    weight,
    weightResistance,
  };
}
export function calculateWeaponOrfevreWeaponMastery(entite, value) {
  const cfg = balanceData.weaponOrfevre.fromWeaponMastery;
  const weaponMastery = Math.max(
    0,
    Math.floor(Number(value ?? getSafe(entite, "weaponMastery", 0)) || 0)
  );

  if (weaponMastery <= 0) return 0;

  if (weaponMastery <= cfg.earlyCap) {
    return Math.floor(weaponMastery / cfg.earlyDivisor) + cfg.earlyBaseBonus;
  }

  return cfg.lateBaseBonus + Math.round((weaponMastery - cfg.earlyCap) / cfg.lateDivisor);
}

export function calculateWeaponOrfevreStrength(entite, value) {
  const cfg = balanceData.weaponOrfevre.fromStrength;
  const strength = Math.max(
    0,
    Math.floor(Number(value ?? getSafe(entite, "strength", 0)) || 0)
  );

  if (strength <= 0) return 0;

  if (strength <= cfg.earlyCap) {
    return Math.max(cfg.earlyMinBonus, Math.round(strength / cfg.earlyDivisor));
  }

  return cfg.lateBaseBonus + Math.round((strength - cfg.earlyCap) / cfg.lateDivisor);
}

export function calculateWeaponOrfevreBonus(entite) {
  const weaponMastery = Number(getSafe(entite, "weaponMastery", 0)) || 0;
  if (weaponMastery <= 0) return 0;

  const weaponMasteryBonus = calculateWeaponOrfevreWeaponMastery(entite);
  const strengthBonus = calculateWeaponOrfevreStrength(entite);

  return weaponMasteryBonus + strengthBonus;
}

export function calculateWeaponMasteryTotalTrophyChance(entite, value) {
  const weaponMasteryValue = Math.max(
    0,
    Math.floor(Number(value ?? getSafe(entite, "weaponMastery", 0)) || 0)
  );

  if (weaponMasteryValue <= 0) return 0;

  return (
    calculateWeaponMasteryTrophyChance(entite, weaponMasteryValue) +
    calculateWeaponMasteryTrophyStrengthBonus(entite)
  );
}
export function calculateWeaponMasteryTrophyChance(entite, value) {
  const cfg = balanceData.weaponMastery.trophy;
  const weaponMastery = Math.max(
    0,
    Math.floor(Number(value ?? getSafe(entite, "weaponMastery", 0)) || 0)
  );

  if (weaponMastery <= 0) return 0;

  return cfg.basePercent + Math.round((weaponMastery - 1) * (cfg.masteryMaxBonusPercent / cfg.masteryRange));
}
export function calculateWeaponMasteryTrophyStrengthBonus(entite, value) {
  const cfg = balanceData.weaponMastery.trophy;
  const strength = Math.max(
    0,
    Math.floor(Number(value ?? getSafe(entite, "strength", 0)) || 0)
  );

  if (strength <= 0) return 0;

  return Math.round(strength * (cfg.strengthMaxPercent / cfg.strengthCap));
}
export function getFinalWeaponOrfevreBonus(entite) {
  return Number(getSafe(entite, "weaponOrfevre", 0)) || 0;
}

export function getFinalWeaponCollectorBonus(entite) {
  return Number(getSafe(entite, "weaponCollector", 0)) || 0;
}
export function calculateChargeEquipmentSlots(entite, value) {
  return Math.max(
    0,
    Math.round(Number(value ?? getSafe(entite, "charge", 0)) || 0)
  );
}
export function weaponMasteryChargeStrenghtRatioBonus(entite, value) {
  const cfg = balanceData.weaponMastery.charge;
  const sourceValue =
    value ??
    (typeof entite === "number" ? entite : getSafe(entite, "strength", 0));

  const strength = Math.max(
    0,
    Math.floor(Number(sourceValue) || 0)
  );

  return Math.floor(strength / cfg.strengthDivisor);
}
export function calculateWeaponMasteryTotalChargeBonus(entite, value) {
  const weaponMasteryValue = Number(value ?? getSafe(entite, "weaponMastery", 0)) || 0;

  if (weaponMasteryValue <= 0) return 0;

  return (
    calculateWeaponMasteryCharge(entite, weaponMasteryValue) +
    weaponMasteryChargeStrenghtRatioBonus(entite)
  );
}
export function attemptBattleRegen(target, hpRestored) {
  if (!target || hpRestored <= 0) return;

  let container = document.getElementById(`effectsContainer_${target.id}`);

  if (!container) {
    const sprite = document.getElementById(`spriteContainer_${target.id}`);
    if (!sprite) return;

    container = document.createElement("div");
    container.id = `effectsContainer_${target.id}`;
    container.className = "effects-container";
    sprite.appendChild(container);
  }

  const vfx = document.createElement("div");
  vfx.className = "battle-regen-hp-vfx";

  vfx.innerHTML = `
    <img src="./media/assets/ui/picto-battle-regen-hp.svg" alt="">
    <span class="healthPoint">+${hpRestored} HP</span>
  `;

  container.appendChild(vfx);
  removeCombatVisualAfter(vfx, 1200);
}
