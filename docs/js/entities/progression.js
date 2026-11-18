import { gameStorage as localStorage } from "../storage/sessionStorage.js";
import { buildStatGraphHelper, buildMilestoneEssenceHelper } from "../data/helpers.js";
import { applyStatSystemTotals, STAT_SYSTEM_ORIGINS, getPointLimitedStatKeys } from "./statSystem.js";
import { getStatSystemInputs } from "./runtime.js";
import { getEquipmentResourceCurrent, syncLifeCurrent } from "../items/resourceStocks.js";
import {
  entites,
  recomputeEntityStats,
  updateExtraLifeRegenOrders,
  updateEternalLifeRegenOrders,
  rescaleHPCurrent,
  getStatMalusSources,
  levelDetails,
  calculateVitalityBonus,
  calculateVelocityReduction,
  calculateRobustnessBonus,
  calculateTranscendenceExtraLife,
  maxLevel as MAX_LEVEL,
  BaseDayHpRegen,
  calculateWeaponMasteryCharge,
  calculateBloodThirstyFromBloodFury,
  calculateGeneratedWeight,
  getWeaponOrfevrePreviewActivePercent,
  getWeaponOrfevreStuffPreviewDelta,
  calculatePhysicalPenPercent,
  calculateMagicalPenPercent,
  calculateEsoterismPercent,
  getBloodThirstyPercent,
} from "./runtime.js";
import {
  loadFromLocalStorage,
  saveToLocalStorage,
  removeFromEquippedItemsStorage,
  saveUpgradedEntity,
  purgeStatPreview,
  getAvailablePlayerExperience,
  spendPlayerExperience,
  creditPlayerExperience,
} from "../storage/gameStorage.js";
import { resetEntityAttackEssences, getMilestoneEssenceColor } from "../items/essenceInventory.js";
import { syncEntityLinkedEssenceInventory, updateMilestoneEssenceElement } from "../items/essences.js";
import {
  getSafe,
  CLASS_INDEX,
  DEFAULT_CYCLE,
  STAT_INDEX,
  ensureEntityLevelObject as ensureCoreEntityLevelObject,
  getArchetypeConfig,
  getArchetypeMilestones,
  getArchetypeUID,
  getClassFromAttributs,
  getClassLabel,
  getCycleForKey,
  getCycleLenFor,
  resolveMutation,
  getDisplayStatKey,
  normalizeStatKey,
  normalizeStatModifierMapInPlace,
} from "./rules.js";
import { validateAndSetNickname } from "./names.js";
import { stats as STATS_DATA } from "../data/statsData.js";
import { toRoman, showStatGainsFromDiff } from "../ui/display.js";
import { createUmbraBlock, syncStatCurseMarker } from "../ui/statistics/components.js";
import { bindHelperEntity, closeOpenHelpers } from "../ui/statistics/helpers.js";
import {
  toNumber, renderMovementCounter, updateMovementDisplay, calculateVitalityRegenPercent,
  calculateVitalityRegenAmount, calculateTotalRegenAmount, calculateHpBattleRegenStrengthRatio, calculateHpBattleRegenIndestructibilityRatio,
  weaponMasteryChargeStrenghtRatioBonus, calculateWeaponOrfevreWeaponMastery, calculateWeaponOrfevreStrength, calculateWeaponMasteryTrophyChance,
  calculateWeaponMasteryTrophyStrengthBonus, calculateMovementMarathonChance, calculateMovementTrailerChance, getMarathonChance,
  getTrailerChance, calculateMagicalTotal, calculateCritTotalChance, calculateCritDamageBonus,
  getFinalCriticalChanceFlat, getFinalCriticalDamageFlat, calculateAmbidextryTotalChance, calculateAmbidextryDamageBonus,
  calculateBloodFuryExecutionPercent, calculateBloodFuryTargetThreshold, calculateBloodFuryExecChanceBonus, calculateExecutionDamage,
  calculateBloodThirstyPercent, calculateHypercognitionEssences, calculateCognitiveExplosionTotal, calculateRangeRatio,
  calculateBullsEyePercent, calculateTotalDodgeBonus, calculateResilienceCritTotalBonus, calculateResilienceTotalCancelBonus,
  calculateResilienceAlterationTotalBonus, caluclateIndestructibilityReductionTotal, calculateIndestructibilityPercentFromEntity, calculateHpBattleRegenPercent,
  calculateAstralityTotal, calculateTranscendenceConsoProtectionTotal, getFinalAttackPreparationReduc, getFinalAttackExecutionReduc,
  getFinalAttackCooldownReduc, getFinalAttackRecoveryReduc, getFinalAttackProjectileSpeed, calculateInvisibleTargetAvoidChance,
  calculateBrokenSpellChance, calculateBrokenSpellDamage, totalMeleeExecReduction, totalPiercingRecupReductionWithAgi,
  totalTranspiercingRecupReductionWithAgi, transpiercingAgiRatio, transpiercingTotal, brutalityPercantBonus,
  psionicPercantBonus, calculateGeneratedUmbraStats, getGeneratedUmbraTargetKeys, calculateMeleeExecBonus,
  calculateMysticismProcChance, calculateMysticismTranceDuration, calculateMysticismPreparationAcceleration, calculateMysticismTotalDamageBonus,
  calculateLvlMaxEntiteWithWill, calculateEquilibreAggroReduction, calculateEquilibreInvisibleDetection, calculateEquilibreAttackChance,
  calculateAgileRetreatChance, calculateOccultismInvisibilityChance, calculateOccultismTargetableChanceDisplay, calculateOccultismDodgeBonus,
  calculateOccultismCritChanceBonus, calculateOccultismShadowFragilityPercent, calculateMovementMaxCharges, calculateMovementStartingChargePercent,
  calculateMovementStartingCharges, getFinalWeaponOrfevreBonus, getFinalWeaponCollectorBonus, calculateChargeEquipmentSlots,
  calculateWeaponMasteryTotalChargeBonus
} from "../combat/statistics.js";
import { calculateStatsDisplay } from "../ui/statistics/details.js";
import { startArchup } from "../biome/meteo.js";
import { updateBonusLifeCounters, updateArmorCounter } from "../combat/vitals.js";
import { recordEntityProgression, countCompletedArchetypes } from "../storage/entityStorage.js";
import { grantEntityRobustnessArmor } from "../items/armor.js";

// Reset progression and restore the entity's native state.
const RESET_FIELDS = [
  'level', 'experience', 'modifierStats', 'Archetype',
  'stats', 'stuff', 'extraLifeRegen', 'eternalLifeRegen', 'resourceStocks',
  'attackDetails', 'attacks', 'currentAttack', 'currentAttackId', 'attackEssenceInventory',
  'nativeAttacks', 'modifierAttacks', 'attackSelection',
];

function clonePlainData(value, ancestors = new Set()) {
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) return undefined;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null) return undefined;
  ancestors.add(value);
  const copy = Array.isArray(value) ? [] : {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = clonePlainData(entry, ancestors);
    if (cloned !== undefined) copy[key] = cloned;
  }
  ancestors.delete(value);
  return copy;
}

function rejectReset(message) {
  return { ok: false, refundXP: 0, refundPercent: 0, removedEssenceIds: [], returnedEquipmentIds: [], message };
}

function validateReset(entity) {
  if (!entity || entity.id == null || !entity.baseStats || !entity.stats?.HP) {
    return rejectReset('Entite introuvable ou statistiques absentes.');
  }
  if (entity.isDEAD || entity.isDead || entity.statut?.includes('dead') || !(Number(entity.stats.HP.current) > 0)) {
    return rejectReset('Une entite morte ne peut pas etre remise a zero.');
  }
  return null;
}

function equipmentIds(entity) {
  return new Set(Object.entries(entity.stuff || {})
    .sort(([a], [b]) => Number(b.slice(4)) - Number(a.slice(4)))
    .flatMap(([, ids]) => ids).filter(id => typeof id === 'string'));
}

function clearProgression(entity) {
  entity.level = { ...entity.level, current: 1 };
  entity.experience = 0;
  entity.modifierStats ??= {};
  entity.modifierStats.durable ??= {};
  const durable = entity.modifierStats.durable;
  for (const key of ['level', 'adminLevel', 'statLeveled', 'archetype', 'derived']) durable[key] = {};
  durable.archetypeMeta = null;
  delete durable.levelUpMeta;
  delete entity.modifierStats.preview;
  entity.Archetype = {
    current: { key: 'egare', level: 1, step: 0, milestone: [] },
    inProgress: [],
    achieve: [],
  };
}

function restoreResetResources(entity, fadedLife) {
  entity.stats.HP.current = entity.stats.HP.max;
  // Faded lives are consumable charges, never a refillable pool.
  const remaining = fadedLife + getEquipmentResourceCurrent(entity, 'fadedLife');
  if (remaining > 0) entity.stats.fadedLife = remaining;
  else delete entity.stats.fadedLife;
  for (const key of ['extraLife', 'eternalLife']) {
    const pool = entity.stats[key];
    if (!pool) continue;
    pool.current = pool.max;
    for (const [slotKey, slot] of Object.entries(entity[`${key}Regen`] || {})) {
      if (/^\d{3}$/.test(slotKey)) slot.currentRegen = slot.maxRegen;
    }
    syncLifeCurrent(entity, key);
  }
  updateExtraLifeRegenOrders(entity);
  updateEternalLifeRegenOrders(entity);
}

export function previewEntityReset(entity) {
  const rejected = validateReset(entity);
  if (rejected) return rejected;

  // The refund uses committed stats, including battle boosts, never a level-up preview.
  const committed = { ...entity, modifierStats: { durable: entity.modifierStats?.durable } };
  const will = Number(getSafe(committed, 'will', 0)) || 0;
  const refundPercent = 30 + will;
  const investedXP = Math.max(0, Number(entity.experience) || 0);
  const refundXP = Math.floor(investedXP * refundPercent / 100);
  const projection = clonePlainData(entity);
  const beforeEquipment = equipmentIds(projection);
  const fadedLife = Math.max(0, (Number(entity.stats.fadedLife) || 0) - getEquipmentResourceCurrent(entity, 'fadedLife'));

  clearProgression(projection);
  const essenceReset = resetEntityAttackEssences(projection);
  if (!essenceReset.ok) return rejectReset(essenceReset.message);
  recomputeEntityStats(projection, { persistEquipment: false, protectChargeMalus: false });
  restoreResetResources(projection, fadedLife);
  const keptEquipment = equipmentIds(projection);

  return {
    ok: true,
    refundXP,
    refundPercent,
    removedEssenceIds: essenceReset.removedEssenceIds,
    returnedEquipmentIds: [...beforeEquipment].filter(id => !keptEquipment.has(id)),
    message: 'Entite remise au niveau 1.',
    projection,
  };
}

function applyProjection(target, projection) {
  const data = clonePlainData(projection);
  for (const key of RESET_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) target[key] = data[key];
    else delete target[key];
  }
  // Keep the current attack attached to its live definition.
  target.currentAttack = target.attackDetails?.find(attack => (
    (attack.functionName || attack.attackId) === target.currentAttackId
  )) || target.currentAttack;
}

function persistAndSyncReset(entity) {
  const sameId = candidate => candidate && String(candidate.id) === String(entity.id);
  const saved = clonePlainData(entity);
  const armyA = loadFromLocalStorage('selectedArmyA', []);
  const inArmyA = Array.isArray(armyA) && armyA.some(sameId);
  if (inArmyA) saveToLocalStorage('selectedArmyA', armyA.map(entry => sameId(entry) ? saved : entry));

  const armyB = loadFromLocalStorage('ArmyB', { armies: {} });
  let changedArmyB = false;
  for (const army of Object.values(armyB?.armies || {})) {
    if (!Array.isArray(army.entities) || !army.entities.some(sameId)) continue;
    army.entities = army.entities.map(entry => sameId(entry) ? saved : entry);
    changedArmyB = true;
  }
  if (changedArmyB) saveToLocalStorage('ArmyB', armyB);

  const pools = [entites];
  if (typeof window !== 'undefined') pools.push(window.entites, window.selectedArmyA, window.selectedArmyB);
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const copy of pool) {
      if (copy !== entity && sameId(copy)) applyProjection(copy, entity);
    }
  }
  return inArmyA;
}

function refreshResetDom(entity, oldStats, entityApi, codexApi) {
  if (typeof document === 'undefined') return;
  // Existing consumables only change HP/status immediately and leave cosmetic effects.
  document.getElementById(`spriteContainer_${entity.id}`)?.classList.remove('itemheal', 'itemdamage', 'itemrez');
  document.getElementById(`codex-entity-sprite-container_${entity.id}`)
    ?.querySelectorAll('.itemeffectVfx').forEach(node => node.remove());
  document.querySelectorAll('.entity-level, [data-stat="lvl"][data-entity-id]').forEach(node => {
    if (String(node.dataset?.entityId) === String(entity.id)) node.textContent = '1';
  });
  syncDOMWithStats(oldStats, entity.stats, entity.id, entity);
  entityApi.updateBonusLifeCounters(entity);
  entityApi.updateCurrentAttackDisplay(entity);
  const codex = document.getElementById(`codex-entity_${entity.id}`);
  if (codex?.parentElement) {
    const parent = codex.parentElement;
    const position = codex.classList.contains('right') ? 'right' : codex.classList.contains('left') ? 'left' : '';
    const dual = codex.classList.contains('dual-view');
    const id = codex.id;
    codex.remove();
    codexApi.createCodexEntityScan(entity, parent, id, position);
    if (dual) document.getElementById(id)?.classList.add('dual-view');
  }
}

export async function resetEntityProgression(entity, { refundExperience = true } = {}) {
  const rejected = validateReset(entity);
  if (rejected) return rejected;
  // Resolve the combat and Codex UI at call time.
  const entityApi = await import("../combat/vitals.js");
  const codexApi = await import("../ui/codex/index.js");
  const preview = previewEntityReset(entity);
  if (!preview.ok) return preview;
  const { projection, ...result } = preview;
  const oldStats = clonePlainData(entity.stats);
  const adminShare = Math.min(1, Math.max(0, Number(entity.adminExperienceSpent) || 0) / Math.max(1, Number(entity.experience) || 0));
  if (!refundExperience) result.refundXP = 0;

  recordEntityProgression(entity);
  applyProjection(entity, projection);
  entity.adminExperienceSpent = 0;
  for (const id of result.returnedEquipmentIds) removeFromEquippedItemsStorage(id);
  syncEntityLinkedEssenceInventory(entity);
  const inArmyA = persistAndSyncReset(entity);
  if (refundExperience) {
    const adminRefund = Math.floor(result.refundXP * adminShare);
    creditPlayerExperience(adminRefund, { admin: true });
    creditPlayerExperience(result.refundXP - adminRefund);
  }
  try {
    refreshResetDom(entity, oldStats, entityApi, codexApi);
  } catch (error) {
    // A cosmetic failure must not report a committed reset as a failed item use.
    console.warn('Entity reset: affichage a rafraichir.', error);
  }
  if (typeof window !== 'undefined') {
    const detail = { source: 'entity-reset', entityId: entity.id, entite: entity, ...result };
    if (inArmyA) window.dispatchEvent(new CustomEvent('selectedArmyAUpdated', { detail }));
    window.dispatchEvent(new CustomEvent('entityProgressionReset', { detail }));
  }
  return result;
}

// Progression, upgrades and their interface.
export {
  CLASS_INDEX,
  DEFAULT_CYCLE,
  getArchetypeMilestones,
  getClassFromAttributs,
  getClassLabel,
  getCycleForKey,
  getCycleLenFor,
  resolveMutation,
};

export let playerExperience = getAvailablePlayerExperience();

export function setPlayerExperience(value) {
  const numericValue = Number(value);
  const next = Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
  const delta = next - getAvailablePlayerExperience();
  if (delta >= 0) creditPlayerExperience(delta);
  else spendPlayerExperience(-delta);
  playerExperience = getAvailablePlayerExperience();
  updateExperienceDisplay();
  return playerExperience;
}

for (const event of ['adminModeChanged', 'playerWalletChanged', 'playerExperienceUpdated']) {
  window.addEventListener(event, () => {
    playerExperience = getAvailablePlayerExperience();
    updateExperienceDisplay();
  });
}

const attributS = [
  { label: "Force",         key: "strength",     short: "F" },
  { label: "Agilite",       key: "agility",      short: "A" },
  { label: "Intelligence",  key: "intelligence", short: "I" },
];
const attribut_SHORT_TO_NAME = { F: 'force', A: 'agilite', I: 'intelligence' };
const KEY_TO_attributNAME    = { strength: 'force', agility: 'agilite', intelligence: 'intelligence' };
const whiteBarTimers = new Map(); // pour suivre les timers par barre

const GENERATED_UMBRA_TARGET_KEYS = getGeneratedUmbraTargetKeys();
const PREVIEW_GENERATED_ONLY_KEYS = new Set([
  "HP",
  "armor",
  "extraLife",
  ...GENERATED_UMBRA_TARGET_KEYS,
  "speed",
  "charge",
  "weaponOrfevre",
  "weaponCollector",
  "bloodThirsty",
  "marathon",
  "trailer",
  "weight",
  "dayHpRegen",
]);

const DISPLAYABLE_STAT_KEYS = new Set(
  STATS_DATA.flatMap(({ key }) => [key, normalizeStatKey(key)])
);

const DOM_NON_STAT_KEYS = new Set([
  "hp-bar",
  "armor-bar",
  "armor-text",
  "extraLife-value",
  "stuffSlot",
]);

const ZERO_VALUE_VISIBLE_STAT_KEYS = new Set([
  "HP",
  "armor",
  "extraLife",
  "shift",
  "speed",
  "strength",
  "agility",
  "intelligence",
  "will",
]);

function cloneLevelUpPlainData(value, fallback = null) {
  if (value === undefined) return fallback;

  const seen = new WeakSet();

  try {
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === "function" || typeof val === "symbol") return undefined;

      if (val && typeof val === "object") {
        if (typeof Node !== "undefined" && val instanceof Node) return undefined;
        if (seen.has(val)) return undefined;
        seen.add(val);
      }

      return val;
    });

    return json == null ? fallback : JSON.parse(json);
  } catch (_) {
    // Certains objets vivants du jeu peuvent embarquer du DOM. Pour les
    // snapshots internes, on tente tout de même une copie native en repli.
  }

  try {
    return structuredClone(value);
  } catch (_) {
    return fallback;
  }
}

function getLevelUpEntityId(value) {
  const id = value && typeof value === "object" ? value.id : value;
  return id == null ? "" : String(id);
}

function isSameLevelUpEntityId(a, b) {
  const left = getLevelUpEntityId(a);
  const right = getLevelUpEntityId(b);
  return !!left && !!right && left === right;
}

function upsertLevelUpEntityById(list, entity) {
  if (!Array.isArray(list) || !entity) return -1;

  const entityId = getLevelUpEntityId(entity);
  if (!entityId) return -1;

  let targetIndex = list.findIndex(entry => isSameLevelUpEntityId(entry, entity));

  if (targetIndex === -1) {
    list.push(entity);
    targetIndex = list.length - 1;
  } else {
    list[targetIndex] = entity;
  }

  for (let i = list.length - 1; i >= 0; i--) {
    if (i === targetIndex || getLevelUpEntityId(list[i]) !== entityId) continue;
    list.splice(i, 1);
    if (i < targetIndex) targetIndex -= 1;
  }

  return targetIndex;
}

function syncLevelUpArrayInPlace(target, source) {
  if (!Array.isArray(target) || !Array.isArray(source)) return;
  target.splice(0, target.length, ...source.map(entry => cloneLevelUpPlainData(entry, entry)));
}

function syncLevelUpEntityObject(target, source) {
  if (!target || !source || target === source) return;

  Object.keys(target).forEach(key => {
    if (!(key in source)) delete target[key];
  });
  Object.assign(target, cloneLevelUpPlainData(source, source));
}

function syncLevelUpEntityInPool(pool, entity) {
  if (!Array.isArray(pool) || !entity) return false;

  const idx = pool.findIndex(entry => isSameLevelUpEntityId(entry, entity));
  if (idx === -1) return false;

  syncLevelUpEntityObject(pool[idx], entity);
  return true;
}

function refreshConfirmedLevelDom(entite) {
  if (typeof document === "undefined" || !entite?.id) return;

  const entityId = cssEscapeValue(entite.id);
  const levelValue = getEntityLevelCurrent(entite);

  document
    .querySelectorAll(`[data-stat="lvl"][data-entity-id="${entityId}"]`)
    .forEach(node => { node.textContent = String(levelValue); });

  document
    .querySelectorAll(`#codex-entity_${entityId} .entite-stat-level`)
    .forEach(node => { node.textContent = ` - Level ${levelValue}`; });
}

function persistConfirmedLevelUpEntity(entite) {
  if (!entite?.id) return;

  let selectedArmy = [];
  try {
    const rawArmy = JSON.parse(localStorage.getItem("selectedArmyA") || "[]");
    selectedArmy = Array.isArray(rawArmy) ? rawArmy : [];
  } catch (_) {
    selectedArmy = [];
  }

  const storedEntite = cloneLevelUpPlainData(entite, entite);
  if (storedEntite?.level && typeof storedEntite.level === "object") {
    storedEntite.level.current = getEntityLevelCurrent(entite);
  }
  upsertLevelUpEntityById(selectedArmy, storedEntite);

  saveToLocalStorage("selectedArmyA", selectedArmy);

  if (typeof window !== "undefined") {
    if (Array.isArray(window.selectedArmyA)) {
      syncLevelUpArrayInPlace(window.selectedArmyA, selectedArmy);
    } else {
      window.selectedArmyA = selectedArmy.map(entry => cloneLevelUpPlainData(entry, entry));
    }

    syncLevelUpEntityInPool(window.entites, storedEntite);
    syncLevelUpEntityInPool(window.selectedArmyB, storedEntite);

    window.dispatchEvent(new CustomEvent("selectedArmyAUpdated", {
      detail: {
        source: "level-up",
        entityId: storedEntite.id,
        entite: storedEntite
      }
    }));
  }

  syncLevelUpEntityInPool(entites, storedEntite);
  refreshConfirmedLevelDom(entite);
}

function markConfirmedLevelUpMeta(entite, targetLevel) {
  if (!entite) return;

  entite.modifierStats ??= {};
  entite.modifierStats.durable ??= {};

  const durable = entite.modifierStats.durable;
  const previousMeta = durable.levelUpMeta || {};
  const reverseMeta = durable.archetypeMeta || {};
  const confirmedLevel =
    Number(targetLevel ?? getEntityLevelCurrent(entite)) ||
    getEntityLevelCurrent(entite);
  const reverseBaseLevel =
    Number(
      reverseMeta.level ??
      reverseMeta.requestedLevel ??
      previousMeta.reverseBaseLevel ??
      0
    ) || 0;

  durable.levelUpMeta = {
    ...previousMeta,
    source: "manualLevelUp",
    confirmedLevel,
    reverseBaseLevel,
  };
}

const STAT_SYNC_CALCULATORS = {
  calculateMagicalTotal,
  calculateMeleeExecutionPercent: entite =>
    Math.max(0, 100 - (Number(getFinalAttackExecutionReduc(entite)) || 0)),
  calculateCritTotalChance: entite => calculateCritTotalChance(entite),
  calculateCritDamageBonus: entite => calculateCritDamageBonus(entite),
  getFinalCriticalChanceFlat,
  getFinalCriticalDamageFlat,
  calculateAmbidextryTotalChance,
  calculateAmbidextryDamageBonus,
  calculateBloodFuryExecutionPercent,
  calculateBloodFuryTargetThreshold,
  calculateBloodFuryExecChanceBonus: entite =>
    calculateBloodFuryExecChanceBonus(Number(getSafe(entite, "strength", 0)) || 0),
  calculateExecutionDamage,
  calculateBloodThirstyPercent,
  getBloodThirstyPercent,
  calculatePhysicalPenPercent,
  calculateMagicalPenPercent,
  calculateHypercognitionEssences,
  calculateCognitiveExplosionTotal,
  calculateRangeRatio: entite => Number(calculateRangeRatio(entite).toFixed(2)),
  calculateBullsEyePercent,
  calculateTotalDodgeBonus,
  calculateResilienceCritTotalBonus,
  calculateResilienceTotalCancelBonus,
  calculateResilienceAlterationTotalBonus,
  caluclateIndestructibilityReductionTotal,
  calculateIndestructibilityPercentFromEntity,
  calculateHpBattleRegenPercent,
  calculateAstralityTotal,
  calculateTranscendenceConsoProtectionTotal,
  calculateTranscendenceExtraLife: entite =>
    calculateTranscendenceExtraLife(Number(getSafe(entite, "transcendence", 0)) || 0),
  calculateEsoterismPercent,
  calculateTotalRegenAmount,
  getFinalAttackPreparationReduc,
  getFinalAttackExecutionReduc,
  getFinalAttackCooldownReduc,
  getFinalAttackRecoveryReduc,
  getFinalAttackProjectileSpeed,
  calculateInvisibleTargetAvoidChance,
  calculateBrokenSpellChance,
  calculateBrokenSpellDamage,
  totalMeleeExecReduction,
  totalPiercingRecupReductionWithAgi,
  totalTranspiercingRecupReductionWithAgi,
  transpiercingAgiRatio,
  transpiercingTotal,
  brutalityPercantBonus,
  psionicPercantBonus,
  calculateMeleeExecBonus,
  calculateMysticismProcChance,
  calculateMysticismTranceDuration,
  calculateMysticismPreparationAcceleration,
  calculateMysticismTotalDamageBonus,
  calculateLvlMaxEntiteWithWill: entite =>
    calculateLvlMaxEntiteWithWill(entite, Number(getSafe(entite, "will", 0)) || 0),
  calculateEquilibreAggroReduction,
  calculateEquilibreInvisibleDetection,
  calculateEquilibreAttackChance,
  calculateAgileRetreatChance,
  calculateOccultismInvisibilityChance,
  calculateOccultismTargetableChanceDisplay,
  calculateOccultismDodgeBonus,
  calculateOccultismCritChanceBonus,
  calculateOccultismShadowFragilityPercent,
  calculateMovementMaxCharges,
  calculateMovementStartingChargePercent,
  calculateMovementStartingCharges,
  calculateMovementMarathonChance,
  getMarathonChance,
  getTrailerChance,
  getFinalWeaponOrfevreBonus,
  getFinalWeaponCollectorBonus,
  calculateChargeEquipmentSlots,
  calculateWeaponMasteryTotalChargeBonus,
  calculateWeaponMasteryTrophyChance,
};

const STATS_PANEL_DYNAMIC_ROWS = {
  fatalSurvival: { sectionClass: 'defence', sourceStat: 'fatalSurvival', label: 'Survie fatale :', valueTemplate: '${value} %', autonomousHelper: true },
  ...Object.fromEntries([
    ['criticalResistance', 'Résistance aux critiques'],
    ['alterationResistance', 'Résistance aux altérations'],
    ['hindranceResistance', 'Résistance aux entraves'],
    ['resilienceTotal', 'Résilience totale'],
  ].map(([key, label]) => [key, {
    sectionClass: 'defence', sourceStat: key, label: `${label} :`,
    valueTemplate: '${value} %', autonomousHelper: true, beforeStats: ['astrality'],
  }])),
  bloodThirsty: {
    sectionClass: "attack",
    sourceStat: "bloodThirsty",
    label: "Soif de sang :",
    value: value => `${formatDynamicStatValue(value)} %`,
    beforeStats: ["magicalDamage"],
  },
  hpBattleRegen: {
    sectionClass: "defence",
    sourceStat: "hpBattleRegen",
    label: "Régénération de Combat :",
    value: value => `${formatDynamicStatValue(value)} % des HP max / tour`,
    beforeStats: ["astrality"],
  },
  marathon: {
    sectionClass: "utilitaire",
    sourceStat: "marathon",
    label: "Marathonien :",
    value: value => `${formatDynamicStatValue(value)} %`,
    beforeStats: ["trailer", "weaponOrfevre", "weaponCollector", "charge"],
  },
  trailer: {
    sectionClass: "utilitaire",
    sourceStat: "trailer",
    label: "Trailer :",
    value: value => `${formatDynamicStatValue(value)} %`,
    beforeStats: ["weaponOrfevre", "weaponCollector", "charge"],
  },
  weaponOrfevre: {
    sectionClass: "utilitaire",
    sourceStat: "weaponOrfevre",
    label: "Efficacité des équipements :",
    value: value => `+ ${formatDynamicStatValue(value)}%`,
    beforeStats: ["weaponCollector", "charge"],
  },
  weaponCollector: {
    sectionClass: "utilitaire",
    sourceStat: "weaponCollector",
    label: "Butins d'équipement :",
    value: value => `+ ${formatDynamicStatValue(value)}%`,
    beforeStats: ["charge"],
  },
  attackCooldownReduc: {
    sectionClass: "utilitaire",
    displayStat: "cooldownTime",
    sourceStat: "attackCooldownReduc",
    originStat: "haste",
    label: "Durée de Cooldown :",
    valueTemplate: "- ${value} %",
    calculatorName: "getFinalAttackCooldownReduc",
  },
  attackPreparationReduc: {
    sectionClass: "utilitaire",
    displayStat: "preparationTime",
    sourceStat: "attackPreparationReduc",
    originStat: "haste",
    label: "Durée de Préparation :",
    valueTemplate: "- ${value} %",
    calculatorName: "getFinalAttackPreparationReduc",
  },
  attackExecutionReduc: {
    sectionClass: "utilitaire",
    displayStat: "executionTime",
    sourceStat: "attackExecutionReduc",
    originStat: "haste",
    label: "Durée d'Exécution :",
    valueTemplate: "- ${value} %",
    calculatorName: "getFinalAttackExecutionReduc",
  },
  attackRecoveryReduc: {
    sectionClass: "utilitaire",
    displayStat: "recuperationTime",
    sourceStat: "attackRecoveryReduc",
    originStat: "haste",
    label: "Durée de Récupération :",
    valueTemplate: "- ${value} %",
    calculatorName: "getFinalAttackRecoveryReduc",
  },
  attackProjectileSpeed: {
    sectionClass: "utilitaire",
    displayStat: "projectileTime",
    sourceStat: "attackProjectileSpeed",
    originStat: "haste",
    label: "Vitesse des projectiles :",
    valueTemplate: "+ ${value} %",
    calculatorName: "getFinalAttackProjectileSpeed",
  },
};

function getFallbackMaxLevel() {
  // Fallback global si l'entité n'a pas encore son .max dédié
  if (typeof MAX_LEVEL === 'number') return MAX_LEVEL;
  if (Array.isArray(levelDetails) && levelDetails.length) {
    return Math.max(...levelDetails.map(l => l.level || 0));
  }
  return 100; // dernier filet de sécurité
}

// Wrapper UI : les regles de progression vivent dans entities/rules.js.
export function ensureEntityLevelObject(entite) {
  return ensureCoreEntityLevelObject(entite, { maxLevel: getFallbackMaxLevel() });
}

function getEntityLevelCurrent(entite) {
  if (!entite) return 1;
  ensureEntityLevelObject(entite);
  return entite.level.current;
}

function getEntityLevelMax(entite) {
  if (!entite) return getFallbackMaxLevel();
  ensureEntityLevelObject(entite);
  return entite.level.max;
}

function setEntityLevelCurrent(entite, value) {
  if (!entite) return;
  ensureEntityLevelObject(entite);

  const max = entite.level.max;
  const clamped = Math.min(Math.max(1, value), max);

  entite.level.current = clamped;
  return clamped;
}
function ensureHPDom(entityId, label = "Points de vie") {
  const containers = document.querySelectorAll(
    `.stat-container[data-stat="HP"][data-entity-id="${entityId}"]`
  );
  if (!containers.length) return;

  containers.forEach(container => {
    const existing = container.querySelector(`.entite-stat[data-stat="HP"][data-entity-id="${entityId}"]`);
    if (existing) return;

    const oldText = container.textContent.trim();
    container.textContent = "";

    const wrap = document.createElement("div");
    wrap.className = "stat-picto-valeur HP";
    wrap.innerHTML = `
      <div class="picto-stat HP"></div>
      <div class="stat-name">${label}</div>
      <div class="entite-stat" data-entity-id="${entityId}" data-stat="HP"></div>
      <div class="separator-stats-preview">&gt;</div>
      <div class="entite-stat preview is-hidden" data-entity-id="${entityId}" data-stat="HP"></div>
    `;
    container.appendChild(wrap);

    const perm = wrap.querySelector(`.entite-stat[data-stat="HP"][data-entity-id="${entityId}"]:not(.preview)`);
    const m = oldText.match(/(\d+)\s*\/\s*(\d+)/);
if (perm && m) perm.textContent = `${m[1]} / ${m[2]}`;
  });
}

function containerOf(el) {
  if (!el || typeof el.closest !== "function") return null;
  return el.closest(".stat-container, .codex-profile-battle-stat, .codex-profile-umbra-stat");
}

function getStatComparableValue(value, fallback = 0) {
  if (value && typeof value === "object") {
    return Number(value.max ?? value.current ?? fallback) || 0;
  }

  return Number(value ?? fallback) || 0;
}

function getSnapshotComparableValue(stats, key, fallback = 0) {
  if (!stats || stats[key] === undefined) return fallback;
  return getStatComparableValue(stats[key], fallback);
}

function formatDynamicStatValue(value) {
  const n = getStatComparableValue(value, 0);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100).replace(/\.0+$/, "");
}

function formatSyncedStatValue(value) {
  if (value && typeof value === "object") {
    const current = Number(value.current ?? value.max ?? 0) || 0;
    const max = Number(value.max ?? value.current ?? 0) || 0;
    return current !== max ? `${formatDynamicStatValue(current)} / ${formatDynamicStatValue(max)}` : formatDynamicStatValue(max);
  }

  return formatDynamicStatValue(value);
}

function formatStatTemplate(template, value) {
  if (typeof template === "string" && template.includes("${value}")) {
    return template.replaceAll("${value}", formatSyncedStatValue(value));
  }

  return formatSyncedStatValue(value);
}

function getStatSyncCalculator(calculatorName) {
  const name = String(calculatorName || "").trim();
  return name ? STAT_SYNC_CALCULATORS[name] : null;
}

function resolveStatSyncValue(entite, statKey, {
  calculatorName = null,
  fallback = 0,
} = {}) {
  const canonical = normalizeStatKey(statKey);
  const fn = getStatSyncCalculator(calculatorName);

  if (typeof fn === "function") {
    try {
      return fn(entite, getSafe(entite, canonical, fallback));
    } catch (error) {
      console.warn(`Calculateur de stat impossible a executer: ${calculatorName}`, error);
    }
  }

  const rawValue = getSafe(entite, canonical, fallback);
  const computed = calculateStatsDisplay(canonical, entite, rawValue, { includeHelper: false });
  return computed?.displayValue ?? rawValue;
}

function resolveStatContainerValue(container, entite, statKey, fallback = 0) {
  const sourceStat = normalizeStatKey(container?.dataset?.sourceStat || statKey);
  const calculatorName = container?.dataset?.calculatorName || "";
  const value = resolveStatSyncValue(entite, sourceStat, { calculatorName, fallback });
  const html = formatStatTemplate(container?.dataset?.valueTemplate, value);

  return { value, html };
}

function getStatsPanelDynamicConfig(stat) {
  const statKey = normalizeStatKey(stat);
  return STATS_PANEL_DYNAMIC_ROWS[statKey] || null;
}

function getStatsPanelDynamicSourceStat(stat, config = null) {
  const statKey = normalizeStatKey(stat);
  if (STATS_PANEL_DYNAMIC_ROWS[statKey]) return statKey;
  return normalizeStatKey(config?.sourceStat || statKey);
}

function getStatsPanelDynamicDisplayStat(stat, config = null) {
  const cfg = config || getStatsPanelDynamicConfig(stat);
  return cfg?.displayStat || stat;
}

function getStatsPanelDynamicValue(stat, config, entite, fallback = 0) {
  if (!config) return fallback;
  return resolveStatSyncValue(entite, getStatsPanelDynamicSourceStat(stat, config), {
    calculatorName: config.calculatorName,
    fallback,
  });
}

function formatStatsPanelDynamicValue(config, value) {
  if (typeof config?.value === "function" && !config.valueTemplate) {
    return config.value(value);
  }

  return formatStatTemplate(config?.valueTemplate, value);
}

function cssEscapeValue(value) {
  return globalThis.CSS?.escape
    ? CSS.escape(String(value))
    : String(value).replace(/["\\]/g, "\\$&");
}

function getStatSnapshotValue(stats, statKey, fallback = undefined) {
  if (!stats) return fallback;
  const canonical = normalizeStatKey(statKey);
  if (stats[statKey] !== undefined) return stats[statKey];
  if (stats[canonical] !== undefined) return stats[canonical];
  return fallback;
}

function isStatsSnapshotDifferent(a, b) {
  if (a === b) return false;
  return JSON.stringify(a) !== JSON.stringify(b);
}

function getLiveEntityForStatSync(entityId) {
  const id = String(entityId);
  const win = globalThis.window || {};
  const pools = [
    entites,
    win.entites,
    win.selectedArmyA,
    win.selectedArmyB,
    win.entitesNestUp,
  ];

  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const found = pool.find(entity => String(entity?.id) === id);
    if (found) return found;
  }

  return null;
}

function buildStatsSnapshotEntity(liveEntity, statsSnapshot, entityId, modifierStatsSnapshot = undefined) {
  const modifierSource =
    modifierStatsSnapshot !== undefined
      ? modifierStatsSnapshot
      : liveEntity?.modifierStats;
  const modifierStats = {
    ...(modifierSource || {}),
    preview: null,
  };

  return {
    ...(liveEntity || {}),
    id: liveEntity?.id ?? entityId,
    stats: statsSnapshot || {},
    modifierStats,
  };
}

function getRenderedStatKeysForEntity(entityId) {
  if (typeof document === "undefined" || !entityId) return [];

  const escapedEntityId = cssEscapeValue(entityId);
  const renderedKeys = new Set();

  document
    .querySelectorAll(
      `.stat-container[data-entity-id="${escapedEntityId}"][data-stat], ` +
      `.codex-profile-battle-stat[data-entity-id="${escapedEntityId}"][data-stat], ` +
      `.codex-profile-umbra-stat[data-entity-id="${escapedEntityId}"][data-stat]`
    )
    .forEach((node) => {
      const statKey = node.dataset.stat;
      const canonical = normalizeStatKey(statKey);
      if (!statKey || DOM_NON_STAT_KEYS.has(statKey) || DOM_NON_STAT_KEYS.has(canonical)) return;
      if (!DISPLAYABLE_STAT_KEYS.has(statKey) && !DISPLAYABLE_STAT_KEYS.has(canonical)) return;
      renderedKeys.add(statKey);
    });

  return [...renderedKeys];
}

function getRenderedStatContainersForEntity(entityId) {
  const state = {
    containers: new WeakSet(),
    statKeys: new Set(),
  };

  if (typeof document === "undefined" || !entityId) return state;

  const escapedEntityId = cssEscapeValue(entityId);
  document
    .querySelectorAll(
      `.stat-container[data-entity-id="${escapedEntityId}"][data-stat], ` +
      `.codex-profile-battle-stat[data-entity-id="${escapedEntityId}"][data-stat], ` +
      `.codex-profile-umbra-stat[data-entity-id="${escapedEntityId}"][data-stat]`
    )
    .forEach((node) => {
      const statKey = node.dataset.stat;
      const canonical = normalizeStatKey(statKey);
      if (!statKey || DOM_NON_STAT_KEYS.has(statKey) || DOM_NON_STAT_KEYS.has(canonical)) return;

      state.containers.add(node);
      state.statKeys.add(statKey);
      state.statKeys.add(canonical);
      state.statKeys.add(getDisplayStatKey(canonical));
    });

  return state;
}

function shouldMarkExistingContainerAsNew(renderedBefore, container) {
  return Boolean(container && renderedBefore && !renderedBefore.containers.has(container));
}

function shouldRemoveFinalZeroStatContainer(container, stat, nextValue, beforeValue) {
  if (!container) return false;
  if (container.dataset.statCursed === 'true') return false;

  const statKey = normalizeStatKey(stat || container.dataset?.stat);
  if (!statKey) return false;
  if (DOM_NON_STAT_KEYS.has(statKey) || ZERO_VALUE_VISIBLE_STAT_KEYS.has(statKey)) return false;
  if (container.closest?.(".level-up-section")) return false;

  const beforeComparable = getStatComparableValue(beforeValue, 0);
  const nextComparable = getStatComparableValue(nextValue, 0);

  return beforeComparable > 0 && nextComparable <= 0;
}

function getStatDisplayImpactScore(statKey, entite, statsSnapshot) {
  if (!statKey || !entite) return null;

  try {
    const statValue = getStatSnapshotValue(statsSnapshot, statKey, undefined);
    const computed = calculateStatsDisplay(statKey, entite, statValue);
    if (!computed || typeof computed !== "object") return null;

    let score = 0;
    for (const [key, value] of Object.entries(computed)) {
      if (key === "helpContent" || key === "ambianceContent") continue;
      if (typeof value === "number" && Number.isFinite(value)) {
        score += value;
      }
    }

    return Math.round(score * 1000) / 1000;
  } catch (error) {
    console.warn(`Impact helper impossible a calculer pour ${statKey}`, error);
    return null;
  }
}

function addRenderedStatImpactDiffs(changedStats, oldStats, newStats, entityId, entityContext = null, options = {}) {
  const renderedStatKeys = getRenderedStatKeysForEntity(entityId);
  if (!renderedStatKeys.length) return changedStats;

  const liveEntity = entityContext || getLiveEntityForStatSync(entityId);
  if (!liveEntity) return changedStats;

  const beforeEntity = buildStatsSnapshotEntity(liveEntity, oldStats, entityId, options.oldModifierStats);
  const afterEntity = buildStatsSnapshotEntity(liveEntity, newStats, entityId, options.newModifierStats);

  for (const statKey of renderedStatKeys) {
    const beforeScore = getStatDisplayImpactScore(statKey, beforeEntity, oldStats);
    const afterScore = getStatDisplayImpactScore(statKey, afterEntity, newStats);

    if (!Number.isFinite(beforeScore) || !Number.isFinite(afterScore)) continue;
    if (beforeScore === afterScore) continue;

    const newValue = getStatSnapshotValue(newStats, statKey, 0);
    if (!changedStats[statKey]) {
      changedStats[statKey] = {
        value: newValue,
        isNew: false,
      };
    }

    changedStats[statKey].visualBefore = beforeScore;
    changedStats[statKey].visualAfter = afterScore;
  }

  return changedStats;
}

function addStatsPanelDynamicDiffs(changedStats, oldStats, newStats, entityId, entityContext = null, options = {}) {
  const liveEntity = entityContext || getLiveEntityForStatSync(entityId);
  const beforeEntity = buildStatsSnapshotEntity(liveEntity, oldStats, entityId, options.oldModifierStats);
  const afterEntity = buildStatsSnapshotEntity(liveEntity, newStats, entityId, options.newModifierStats);

  for (const statKey of Object.keys(STATS_PANEL_DYNAMIC_ROWS)) {
    const config = STATS_PANEL_DYNAMIC_ROWS[statKey];
    const displayStatKey = getStatsPanelDynamicDisplayStat(statKey, config);
    const beforeFallback = getStatSnapshotValue(oldStats, statKey, 0);
    const nextFallback = getStatSnapshotValue(newStats, statKey, 0);
    const beforeValue = getStatsPanelDynamicValue(statKey, config, beforeEntity, beforeFallback);
    const nextValue = getStatsPanelDynamicValue(statKey, config, afterEntity, nextFallback);
    const beforeComparable = getStatComparableValue(beforeValue, 0);
    const nextComparable = getStatComparableValue(nextValue, 0);

    if (beforeComparable === nextComparable) continue;

    const payload = {
      value: nextValue,
      isNew: false,
      visualBefore: beforeComparable,
      visualAfter: nextComparable,
    };

    changedStats[statKey] = payload;
    changedStats[displayStatKey] = payload;
  }

  return changedStats;
}

function getPayloadStatDeltaComparison(payload, nextValue, beforeValue) {
  const visualBefore = Number(payload?.visualBefore);
  const visualAfter = Number(payload?.visualAfter);

  if (Number.isFinite(visualBefore) && Number.isFinite(visualAfter)) {
    return { next: visualAfter, before: visualBefore };
  }

  return { next: nextValue, before: beforeValue };
}

function findStatsPanelSectionForEntity(entityId, sectionClass) {
  if (typeof document === "undefined" || !entityId || !sectionClass) return null;
  const escapedEntityId = cssEscapeValue(entityId);
  const sections = Array.from(document.querySelectorAll(`.stat-section-codex.${sectionClass}`));

  const exact = sections
    .find(section => section.querySelector(`[data-entity-id="${escapedEntityId}"]`));
  if (exact) return exact;

  const visibleStatsSections = sections.filter(section =>
    section.closest(".section-content.stats, .section-content.statistiques")
  );

  return visibleStatsSections.length === 1 ? visibleStatsSections[0] : null;
}

function findStatsPanelInsertionAnchor(section, beforeStats = []) {
  if (!section || !Array.isArray(beforeStats)) return null;
  const beforeSet = new Set(beforeStats.map(stat => normalizeStatKey(stat)));

  return Array.from(section.children).find(child => {
    const stat = normalizeStatKey(child?.dataset?.stat);
    return stat && beforeSet.has(stat);
  }) || null;
}

function getStatsDataSectionClass(def) {
  const type = String(def?.type || "").toLowerCase();
  if (type.startsWith("attaque")) return "attack";
  if (type.startsWith("defense") || type.startsWith("défense") || type.startsWith("defence")) return "defence";
  if (type.startsWith("utilitaire") || type === "special") return "utilitaire";
  return "utilitaire";
}

function findStatsPanelSectionForStat(entityId, def) {
  return findStatsPanelSectionForEntity(entityId, getStatsDataSectionClass(def));
}

function findStatsDefinition(stat) {
  const statKey = normalizeStatKey(stat);
  return STATS_DATA.find(def => normalizeStatKey(def.key) === statKey) || null;
}

function createMissingStatsPanelStatRow({
  entityId,
  stat,
  value,
  payload = {},
  entityContext = null,
}) {
  const statKey = normalizeStatKey(stat);
  const nextComparable = getStatComparableValue(payload?.visualAfter ?? value, 0);
  if (nextComparable <= 0 && !ZERO_VALUE_VISIBLE_STAT_KEYS.has(statKey) && !getStatMalusSources(entityContext, statKey).length) return null;

  const dynamicRow = createStatsPanelDynamicRow({
    entityId,
    stat: statKey,
    value,
    payload,
    beforeValue: 0,
    entityContext,
  });
  if (dynamicRow) return dynamicRow;

  const def = findStatsDefinition(statKey);
  const section = findStatsPanelSectionForStat(entityId, def);
  if (!def || !section) return null;

  const rowEntity = {
    ...(entityContext || {}),
    id: entityId,
    stats: {
      ...(entityContext?.stats || {}),
      [statKey]: value,
    },
  };

  createUmbraBlock(
    section,
    def.name,
    () => value,
    rowEntity,
    def.key,
    false,
    null,
    null,
    { forceNew: nextComparable > 0, newLineContext: "sync" }
  );

  return Array.from(section.children).find(child =>
    normalizeStatKey(child?.dataset?.stat) === statKey &&
    String(child?.dataset?.entityId || "") === String(entityId)
  ) || null;
}

function findStatsPanelDynamicRow(entityId, stat) {
  const statKey = normalizeStatKey(stat);
  const config = STATS_PANEL_DYNAMIC_ROWS[statKey];
  if (!config) return null;

  const section = findStatsPanelSectionForEntity(entityId, config.sectionClass);
  if (!section) return null;
  const displayStatKey = normalizeStatKey(getStatsPanelDynamicDisplayStat(statKey, config));
  const sourceStatKey = normalizeStatKey(getStatsPanelDynamicSourceStat(statKey, config));

  return Array.from(section.children).find(child =>
    (
      normalizeStatKey(child?.dataset?.stat) === statKey ||
      normalizeStatKey(child?.dataset?.stat) === displayStatKey ||
      normalizeStatKey(child?.dataset?.sourceStat) === statKey ||
      normalizeStatKey(child?.dataset?.sourceStat) === sourceStatKey
    ) &&
    String(child?.dataset?.entityId || "") === String(entityId)
  ) || null;
}

function createStatsPanelDynamicRow({
  entityId,
  stat,
  value,
  payload = {},
  beforeValue = 0,
  entityContext = null,
}) {
  const statKey = normalizeStatKey(stat);
  const config = STATS_PANEL_DYNAMIC_ROWS[statKey];
  if (!config) return null;

  const section = findStatsPanelSectionForEntity(entityId, config.sectionClass);
  if (!section) return null;

  const existing = findStatsPanelDynamicRow(entityId, statKey);
  if (existing) {
    updateStatsPanelDynamicRow(existing, {
      entityId,
      stat: statKey,
      value,
      payload: { ...payload, isNew: false },
      beforeValue,
      entityContext,
    });
    return existing;
  }

  const displayStatKey = getStatsPanelDynamicDisplayStat(statKey, config);
  const visualStatKey = getDisplayStatKey(displayStatKey);
  const root = document.createElement("div");
  root.className = `${visualStatKey}-stat stat-container`;
  root.dataset.stat = displayStatKey;
  root.dataset.sourceStat = normalizeStatKey(config.sourceStat || statKey);
  if (config.originStat) root.dataset.originStat = normalizeStatKey(config.originStat);
  if (config.calculatorName) root.dataset.calculatorName = config.calculatorName;
  if (config.valueTemplate) root.dataset.valueTemplate = config.valueTemplate;
  if (config.autonomousHelper) root.dataset.autonomousHelper = 'true';
  root.dataset.hover = "true";
  root.dataset.entityId = String(entityId);
  root.dataset.codexDynamicStat = "true";

  const wrap = document.createElement("div");
  wrap.className = `stat-picto-valeur ${visualStatKey}`;

  const picto = document.createElement("div");
  picto.className = `picto-stat ${visualStatKey}`;

  const name = document.createElement("div");
  name.className = "stat-name";
  name.textContent = config.label;

  const mainVal = document.createElement("div");
  mainVal.className = "entite-stat";
  mainVal.dataset.stat = displayStatKey;
  mainVal.dataset.hover = "true";
  mainVal.dataset.entityId = String(entityId);

  wrap.append(picto, name, mainVal);
  root.appendChild(wrap);

  updateStatsPanelDynamicRow(root, {
    entityId,
    stat: statKey,
    value,
    payload: { ...payload, isNew: true },
    beforeValue,
    entityContext,
  });

  const anchor = findStatsPanelInsertionAnchor(section, config.beforeStats);
  section.insertBefore(root, anchor);
  return root;
}

function updateStatsPanelDynamicRow(row, {
  entityId,
  stat,
  value,
  payload = {},
  beforeValue = 0,
  entityContext = null,
}) {
  const statKey = normalizeStatKey(stat);
  const config = STATS_PANEL_DYNAMIC_ROWS[statKey];
  if (!row || !config) return;

  const displayStatKey = getStatsPanelDynamicDisplayStat(statKey, config);
  const visualStatKey = getDisplayStatKey(displayStatKey);

  row.classList.add(`${visualStatKey}-stat`, "stat-container");
  row.dataset.stat = displayStatKey;
  row.dataset.sourceStat = getStatsPanelDynamicSourceStat(statKey, config);
  if (config.originStat) row.dataset.originStat = normalizeStatKey(config.originStat);
  if (config.calculatorName) row.dataset.calculatorName = config.calculatorName;
  if (config.valueTemplate) row.dataset.valueTemplate = config.valueTemplate;
  if (config.autonomousHelper) row.dataset.autonomousHelper = 'true';
  row.dataset.codexDynamicStat = "true";

  const mainVal = Array.from(row.querySelectorAll(".entite-stat"))
    .find(el => normalizeStatKey(el?.dataset?.stat) === statKey);
  if (mainVal) {
    mainVal.innerHTML = formatStatsPanelDynamicValue(config, value);
    mainVal.dataset.stat = displayStatKey;
    mainVal.dataset.hover = "true";
    mainVal.dataset.entityId = String(entityId);
  }

  row.dataset.hover = "true";
  row.dataset.entityId = String(entityId);

  const helperEntity = entityContext || { id: entityId, stats: { [statKey]: value } };
  syncStatCurseMarker(row, helperEntity, statKey);
  const computed = calculateStatsDisplay(displayStatKey, helperEntity, value);
  if (computed?.helpContent) row.dataset.helperText = computed.helpContent;

  const comparison = getPayloadStatDeltaComparison(payload, value, beforeValue);
  if (shouldRemoveFinalZeroStatContainer(row, displayStatKey, comparison.next, comparison.before)) {
    row.remove();
    return;
  }

  applyStatDeltaClass(row, comparison.next, comparison.before, {
    isNew: payload?.isNew === true,
    zeroAsHidden: false,
  });
}

function syncStatsPanelDynamicRows(entityId, oldStats = {}, newStats = {}, entityContext = null, changedStats = {}, renderedBefore = null, options = {}) {
  if (!entityId || typeof document === "undefined") return;

  const liveEntity = entityContext || getLiveEntityForStatSync(entityId);
  const beforeEntity = buildStatsSnapshotEntity(liveEntity, oldStats, entityId, options.oldModifierStats);
  const afterEntity = buildStatsSnapshotEntity(liveEntity, newStats, entityId, options.newModifierStats);

  for (const statKey of Object.keys(STATS_PANEL_DYNAMIC_ROWS)) {
    const config = STATS_PANEL_DYNAMIC_ROWS[statKey];
    const displayStatKey = getStatsPanelDynamicDisplayStat(statKey, config);
    const beforeFallback = getStatSnapshotValue(oldStats, statKey, 0);
    const nextFallback = getStatSnapshotValue(newStats, statKey, 0);
    const beforeValue = getStatsPanelDynamicValue(statKey, config, beforeEntity, beforeFallback);
    const nextValue = getStatsPanelDynamicValue(statKey, config, afterEntity, nextFallback);
    const beforeComparable = getStatComparableValue(beforeValue, 0);
    const nextComparable = getStatComparableValue(nextValue, 0);
    const existing = findStatsPanelDynamicRow(entityId, statKey);
    const existedBefore = existing && renderedBefore?.containers?.has(existing);
    const rowPayload = changedStats[statKey] || changedStats[displayStatKey] || {
      value: nextValue,
      isNew: false,
      visualBefore: beforeComparable,
      visualAfter: nextComparable,
    };

    if (existing) syncStatCurseMarker(existing, afterEntity, statKey);
    if (nextComparable <= 0 && !getStatMalusSources(afterEntity, statKey).length) {
      if (existing) existing.remove();
      continue;
    }

    createStatsPanelDynamicRow({
      entityId,
      stat: statKey,
      value: nextValue,
      payload: {
        ...rowPayload,
        isNew: (renderedBefore ? !existedBefore : !existing) && nextComparable > 0,
      },
      beforeValue,
      entityContext: afterEntity,
    });
  }
}

function applyStatDeltaClass(container, nextValue, beforeValue, { isNew = false, zeroAsHidden = true } = {}) {
  if (!container) return null;

  const nextComparable = getStatComparableValue(nextValue, 0);
  const beforeComparable = getStatComparableValue(beforeValue, 0);
  const showsNew = isNew && nextComparable > beforeComparable && nextComparable > 0;
  const valueEls = Array.from(container.querySelectorAll(".entite-stat:not(.preview)"));

  container.classList.remove("upgraded", "reducted", "new");
  container.removeAttribute("upgraded");
  delete container.dataset.previewDelta;
  valueEls.forEach(el => el.classList.remove("new-stat", "stat-new"));

  if (showsNew) {
    container.classList.add("new");
    valueEls.forEach(el => el.classList.add("new-stat"));
  }

  container.classList.remove("zero");

  if (nextComparable > beforeComparable) {
    container.classList.add("upgraded");
    return "up";
  }

  if (nextComparable < beforeComparable) {
    container.classList.add("reducted");
    return "down";
  }

  if (zeroAsHidden && nextComparable <= 0 && container.dataset.statCursed !== 'true'
    && !ZERO_VALUE_VISIBLE_STAT_KEYS.has(normalizeStatKey(container.dataset.stat))) {
    container.classList.add("zero");
    container.classList.remove("last");
  }

  return null;
}

function clearEntityStatDeltaClasses(entityId, root = document) {
  if (!entityId) return;
  const scope = root?.querySelectorAll ? root : document;
  const escapedEntityId = cssEscapeValue(entityId);

  scope
    .querySelectorAll(
      `.stat-container[data-entity-id="${escapedEntityId}"], ` +
      `.codex-profile-battle-stat[data-entity-id="${escapedEntityId}"], ` +
      `.codex-profile-umbra-stat[data-entity-id="${escapedEntityId}"]`
    )
    .forEach((container) => {
      if (container.dataset.codexDynamicStat === "true") {
        const valueEl = container.querySelector(".entite-stat:not(.preview)");
        const currentValue = Number(
          String(valueEl?.textContent || "0")
            .replace(",", ".")
            .replace(/[^0-9.\-]/g, "")
        ) || 0;

        if (currentValue <= 0 && container.dataset.statCursed !== 'true') {
          container.remove();
          return;
        }
      }

      container.classList.remove("upgraded", "reducted", "new");
      container.removeAttribute("upgraded");
      delete container.dataset.previewDelta;
      container
        .querySelectorAll(".entite-stat:not(.preview)")
        .forEach(el => el.classList.remove("new-stat", "stat-new"));
    });
}

export function updateHPCounters(entityId, currentHP, maxHP) {
  if (!entityId) return;

  const cur = Number(currentHP ?? 0);
  const max = Number(maxHP ?? 0);

  document
    .querySelectorAll(`.HP-counter[data-stat="HP"][data-entity-id="${entityId}"]`)
    .forEach(el => {
      el.textContent = `HP : ${cur} / ${max}`;
    });
}
function ensureArmorBarDom(entityId, initialArmor = 0) {
  const existingHpBar = document.querySelector(
    `.health-bar[data-stat="hp-bar"][data-entity-id="${entityId}"]`
  ) || document.querySelector(`.health-bar[data-entity-id="${entityId}"]`);

  const barsContainer =
    document.getElementById(`HeadsupLifeBars_${entityId}`) ||
    document.getElementById(`CodexLifeBars_${entityId}`) ||
    existingHpBar?.closest?.(".life-bars-container");

  if (!barsContainer) return null;

  let armorBar = barsContainer.querySelector(
    `.armor-bar[data-stat="armor-bar"][data-entity-id="${entityId}"]`
  );
  if (armorBar) return armorBar;

  const hpBar = barsContainer.querySelector(
    `.health-bar[data-stat="hp-bar"][data-entity-id="${entityId}"]`
  ) || barsContainer.querySelector(`.health-bar[data-entity-id="${entityId}"]`) || existingHpBar;

  const sideClass =
    hpBar?.classList.contains("A") ? "A" :
    hpBar?.classList.contains("B") ? "B" : "";

  armorBar = document.createElement("div");
  armorBar.className = `armor-bar ${sideClass}`.trim();
  armorBar.dataset.stat = "armor-bar";
  armorBar.dataset.entityId = entityId;
  armorBar.dataset.prevArmor = String(initialArmor);

  const armorFill = document.createElement("div");
  armorFill.className = "armor-fill";
  armorFill.style.width = "100%";
  armorFill.style.transition = "width 0.5s ease";

  armorBar.appendChild(armorFill);

  // insertion après HP bar (HP puis Armor dans la jauge)
  if (hpBar) hpBar.insertAdjacentElement("afterend", armorBar);
  else barsContainer.appendChild(armorBar);

  return armorBar;
}

// Render already applied resources. Combat arithmetic belongs to combat/vitalRules.js.
export function updateHealthBar(currentHP, maxHP, currentArmor, maxArmor, entityId) {
  ensureHPDom(entityId);

  // --- 2) Clamp ---
  const validHP = Math.max(0, Math.min(currentHP, maxHP));
  const validArmor = Math.max(0, Number(currentArmor) || 0);

  updateHPCounters(entityId, validHP, maxHP);

  // ✅ CRÉATION DOM ARMOR BAR (si elle n’existe pas)
  // Tu peux mettre la condition que tu veux :
  // - maxArmor > 0 (armure robuste régénérable)
  // - validArmor > 0 (armure externe ou stuff, même non régénérable)
  if (maxArmor > 0 || validArmor > 0) ensureArmorBarDom(entityId, validArmor);

  // --- 3) Calculs de base ---
  const totalHPArmor = validHP + validArmor;
  let hpPercent, armorPercent, mode;

  if (totalHPArmor < maxHP) {
    mode = "absolu";
    hpPercent = (validHP / maxHP) * 100;
    armorPercent = (validArmor / maxHP) * 100;
  } else if (totalHPArmor === maxHP) {
    mode = "plein";
    hpPercent = (validHP / maxHP) * 100;
    armorPercent = (validArmor / maxHP) * 100;
  } else {
    mode = "normalisé";
    const total = totalHPArmor;
    hpPercent = (validHP / total) * 100;
    armorPercent = (validArmor / total) * 100;
  }

  const hpColorPercent = (validHP / maxHP) * 100;

  // --- 4) ARMURE ---
  document.querySelectorAll(
    `.armor-bar[data-stat="armor-bar"][data-entity-id="${entityId}"]`
  ).forEach(armorBar => {
    const armorFill = armorBar.querySelector(".armor-fill");
    const armorText = armorBar.querySelector(
      `.armor-text[data-stat="armor-text"][data-entity-id="${entityId}"]`
    );

    if (armorFill) armorFill.style.transition = "width 0.5s ease";

    if (validArmor <= 0) {
      armorBar.style.display = "none";
    } else {
      armorBar.style.display = "";
      armorBar.style.setProperty("width", `${armorPercent}%`, "important");
      armorBar.style.flex = `0 0 ${armorPercent}%`;
      if (armorFill) armorFill.style.width = "100%";

      const prevArmor = Number(armorBar.dataset.prevArmor ?? validArmor);
      if (validArmor < prevArmor) (armorFill || armorBar).animate(
        [
          { backgroundColor: "rgba(255,255,255,0.7)", filter: "brightness(1.5)" },
          { filter: "brightness(1)" }
        ],
        { duration: 180, easing: "ease-out" }
      );

      armorBar.dataset.prevArmor = String(validArmor);
    }

    if (armorText) armorText.textContent = `🛡️ ${validArmor}`;
  });

  // --- 5) HP ---
  document.querySelectorAll(
    `.health-bar[data-stat="hp-bar"][data-entity-id="${entityId}"]`
  ).forEach(healthBar => {
    const healthFill = healthBar.querySelector(".health-fill");
    if (healthFill) healthFill.style.transition = "width 0.5s ease, background-color 0.5s ease";
    healthBar.style.setProperty("width", `${hpPercent}%`, "important");
    healthBar.style.flex = `0 0 ${hpPercent}%`;
    updateHealthBarAnimation(healthBar, hpColorPercent);
  });

  // --- 6) Texte HP ---
  document.querySelectorAll(
    `.entite-stat[data-stat="HP"][data-entity-id="${entityId}"]:not(.preview):not([data-display="max"])`
  ).forEach(el => {
    if (!el.closest('.item-description-card, .item-stats-block')) el.textContent = `${validHP} / ${maxHP}`;
  });

  // --- 7) Texte ARMURE ---
  document.querySelectorAll(
    `.armor-counter[data-entity-id="${entityId}"]`
  ).forEach(el => {
    if (validArmor <= 0) el.style.display = "none";
    else {
      el.style.display = "";
      el.textContent = `🛡️ ${validArmor}`;
    }
  });

  document.querySelectorAll(
    `.entite-stat[data-stat="armor"][data-entity-id="${entityId}"]:not(.preview):not([data-display="max"])`
  ).forEach(el => {
    if (el.closest('.item-description-card, .item-stats-block')) return;
    const profileRow = el.closest(".codex-profile-battle-stat");

    if (validArmor <= 0) {
      if (profileRow) profileRow.style.display = "none";
      else el.style.display = "none";
      return;
    }

    if (profileRow) profileRow.style.display = "";
    el.style.display = "";
    el.textContent = String(validArmor);
  });

  return { currentHP: validHP, currentArmor: validArmor };
}

export function updateHealthBarAnimation(healthBar, percentage) {
  const healthFill = healthBar.querySelector('.health-fill');

  // ✅ gère A/SideA et B/SideB
  const isA = healthBar.classList.contains('A') || healthBar.classList.contains('SideA');
  const isB = healthBar.classList.contains('B') || healthBar.classList.contains('SideB');

  let color;
  if (isA) {
    const red = Math.round(255 - (percentage / 100) * 255);
    const green = Math.round((percentage / 100) * 255);
    color = `rgb(${red}, ${green}, 0)`; // rouge → vert
  } else if (isB) {
    const red = Math.round(255 - (percentage / 100) * 173);
    color = `rgb(${red}, 0, 0)`; // rouge sombre
  } else {
    const red = Math.round(255 - (percentage / 100) * 255);
    const green = Math.round((percentage / 100) * 255);
    color = `rgb(${red}, ${green}, 0)`;
  }

  if (healthFill) {
    healthFill.style.transition = 'background-color 0.5s ease';
    healthFill.style.backgroundColor = color;
  } else {
    healthBar.style.transition = 'background-color 0.5s ease';
    healthBar.style.backgroundColor = color;
  }

if (percentage <= 30) {
  const maxDuration = 1.0;   // durée du clignotement à 30 % HP
  const minDuration = 0.04;  // durée minimale à 0 % HP
  const normalized = Math.max(0, Math.min(percentage / 30, 1));
  // exponent plus faible pour accélérer davantage à la fin
  const duration = minDuration + Math.pow(normalized, 1.5) * (maxDuration - minDuration);
  healthBar.style.animation = `blink ${duration}s ease-in-out infinite`;
} else {
  healthBar.style.animation = '';
  healthBar.style.opacity = '1';
}

}

export function updateStatsInDOM(statsObject, baseStats = {}, entityContext = null, options = {}) {
  const entityId = baseStats.id || statsObject.id || statsObject.entityId;
  if (!entityId) return;

  const renderedBefore = options.renderedBefore || getRenderedStatContainersForEntity(entityId);
  clearEntityStatDeltaClasses(entityId);

  const liveEntity = entityContext || getLiveEntityForStatSync(entityId) || { id: entityId };
  const nextStatsSnapshot = { ...baseStats };
  for (const [stat, payload] of Object.entries(statsObject || {})) {
    const statKey = normalizeStatKey(stat);
    if (!statKey || statKey === "id" || statKey === "entityId") continue;
    nextStatsSnapshot[statKey] =
      (typeof payload === "object" && payload !== null && "value" in payload)
        ? payload.value
        : payload;
  }
  const beforeEntity = buildStatsSnapshotEntity(liveEntity, baseStats, entityId);
  const afterEntity = entityContext || buildStatsSnapshotEntity(liveEntity, nextStatsSnapshot, entityId);

  document.querySelectorAll(`.stat-container[data-entity-id="${cssEscapeValue(entityId)}"][data-stat]`)
    .forEach(container => syncStatCurseMarker(container, afterEntity, container.dataset.stat));
  document.querySelectorAll(`[data-attribute-helper][data-entity-id="${cssEscapeValue(entityId)}"]`)
    .forEach(container => bindHelperEntity(container, afterEntity));

  const getDomStatKeys = (stat) => {
    const raw = String(stat || "");
    const canonical = normalizeStatKey(raw);
    const display = getDisplayStatKey(canonical);
    return [...new Set([raw, canonical, display].filter(Boolean))];
  };

  const qAll = (stat, { preview = false } = {}) => {
    const selectors = getDomStatKeys(stat).map((key) => {
      const statSelector = cssEscapeValue(key);
      const entitySelector = cssEscapeValue(entityId);
      return preview
        ? `.entite-stat.preview[data-stat="${statSelector}"][data-entity-id="${entitySelector}"]`
        : `.entite-stat[data-stat="${statSelector}"][data-entity-id="${entitySelector}"]:not(.preview)`;
    });

    return Array.from(document.querySelectorAll(selectors.join(","))).filter(el =>
      !el.closest(".Game-helper, .shop-item-card, .item-description-card, .item-stats-block")
    );
  };

  // 🔹 fonction utilitaire : gérer le "last"
  const setLastUpgraded = (containers) => {
    if (!Array.isArray(containers)) containers = [containers];

    // wipe tous les "last" avant
    const allStats = document.querySelectorAll(`.entite-stat[data-entity-id="${entityId}"]`);
    allStats.forEach((el) => {
      const c = containerOf(el);
      if (c) c.classList.remove("last");
    });

    // puis marquer tous les containers donnés
    containers.forEach(c => {
      if (c) c.classList.add("last");
    });
  };

  const shouldMarkNew = (container, requested = false) =>
    Boolean(requested && shouldMarkExistingContainerAsNew(renderedBefore, container));

  for (const [stat, payload] of Object.entries(statsObject)) {
    const value = (typeof payload === "object" && "value" in payload) ? payload.value : payload;
    const isNew = (typeof payload === "object" && payload.isNew);

    // --- VITALITY → met à jour HP.max ---
if (stat === "vitality") {
  const vitEls = Array.from(qAll("vitality"));
  const upgradedContainers = [];

  vitEls.forEach((vitEl) => {
    const vitC = containerOf(vitEl);
    if (!vitC) return;

    if (shouldRemoveFinalZeroStatContainer(vitC, stat, value, baseStats.vitality)) {
      vitC.remove();
      return;
    }

    vitEl.textContent = value;
    const direction = applyStatDeltaClass(
      vitC,
      value,
      baseStats.vitality,
      { isNew: shouldMarkNew(vitC, isNew) }
    );
    if (direction === "up") upgradedContainers.push(vitC);
  });

  if (upgradedContainers.length) {
    setLastUpgraded(upgradedContainers);
  }

  continue;
}
    // --- HP normal ---
// --- HP permanent (NE DOIT PAS écraser la preview) ---
if (stat === 'HP' && typeof value === 'object') {
  ensureHPDom(entityId);

  const els = qAll('HP'); // ✅ uniquement non-preview
  if (!els.length) continue;

  const baseMax =
    typeof baseStats.HP === 'object'
      ? (baseStats.HP.max ?? 0)
      : (baseStats.HP ?? 0);

  // 1) Texte permanent
  els.forEach((el) => {
    el.textContent = `${value.current} / ${value.max}`;

    const c = containerOf(el);
    if (!c) return;

    const direction = applyStatDeltaClass(
      c,
      value,
      { current: baseMax, max: baseMax },
      { isNew: shouldMarkNew(c, isNew) }
    );
    if (direction === "up") setLastUpgraded(c);
  });

  // 2) Barres HP/armure (permanent)
  const armorCur = (typeof baseStats.armor === "object")
    ? (baseStats.armor.current ?? 0)
    : (baseStats.armor ?? 0);

  const armorMax = (typeof baseStats.armor === "object")
    ? (baseStats.armor.max ?? 0)
    : (baseStats.armor ?? 0);

  updateHealthBar(value.current, value.max, armorCur, armorMax, entityId);
  updateHPCounters(entityId, value.current, value.max);
  continue;
}

if (stat === "armor" && value && typeof value === "object") {
  const els = qAll("armor");
  const armorMax = Number(value.max ?? value.current ?? 0) || 0;
  const baseArmorMax = getSnapshotComparableValue(baseStats, "armor", 0);

  els.forEach((armorEl) => {
    armorEl.textContent = String(armorMax);

    const armorContainer = containerOf(armorEl);
    if (!armorContainer) return;

    const direction = applyStatDeltaClass(
      armorContainer,
      { current: armorMax, max: armorMax },
      { current: baseArmorMax, max: baseArmorMax },
      { isNew: shouldMarkNew(armorContainer, isNew) }
    );

    if (direction === "up") {
      setLastUpgraded(armorContainer);
    }
  });

  continue;
}

if (
  (stat === "extraLife" || stat === "shift") &&
  value &&
  typeof value === "object"
) {
  const els = qAll(stat);
  const current = Number(value.current ?? 0) || 0;
  const max = Number(value.max ?? value.current ?? 0) || 0;
  const upgradedContainers = [];

  els.forEach((el) => {
    if (stat === 'shift') renderMovementCounter(el, { ...afterEntity, stats: { ...afterEntity.stats, shift: value } });
    else el.textContent = max > 0 ? `${current} / ${max}` : String(current);
    const c = containerOf(el);
    const direction = applyStatDeltaClass(c, value, baseStats[stat], {
      isNew: shouldMarkNew(c, isNew),
    });
    if (direction === "up" && c) upgradedContainers.push(c);
  });

  if (upgradedContainers.length) {
    setLastUpgraded(upgradedContainers);
  }

  continue;
}

    // --- autres stats ---
    const oldValueForStat = getStatSnapshotValue(baseStats, stat, 0);
    const dynamicComparable = getStatComparableValue(value, 0);
    const dynamicBaseComparable = getStatComparableValue(oldValueForStat, 0);

    if (
      STATS_PANEL_DYNAMIC_ROWS[normalizeStatKey(stat)] &&
      !findStatsPanelDynamicRow(entityId, stat) &&
      (dynamicComparable > 0 || dynamicBaseComparable > 0)
    ) {
      createStatsPanelDynamicRow({
        entityId,
        stat,
        value,
        payload,
        beforeValue: oldValueForStat,
        entityContext,
      });
    }

    const els = Array.from(qAll(stat));
    if (!els.length) {
      const createdDynamicRow = createMissingStatsPanelStatRow({
        entityId,
        stat,
        value,
        payload,
        entityContext,
      });

      if (createdDynamicRow) {
        continue;
      }
      continue;
    }

    if (stat === 'velocity') {
      const baseSpeed = baseStats.speed ?? 1000;
      const { adjustedSpeed } = calculateVelocityReduction(value, baseSpeed);

      const upgradedContainers = [];
      const velocityEls = Array.from(qAll("velocity"));
      velocityEls.forEach((velEl) => {
        const velC = containerOf(velEl);
        if (!velC) return;

        if (shouldRemoveFinalZeroStatContainer(velC, stat, value, baseStats.velocity)) {
          velC.remove();
          return;
        }

        velEl.textContent = value;
        const direction = applyStatDeltaClass(
          velC,
          value,
          baseStats.velocity,
          { isNew: shouldMarkNew(velC, isNew) }
        );
        if (direction === "up") upgradedContainers.push(velC);
      });

      const speedEls = Array.from(qAll('speed'));
      speedEls.forEach((speedEl) => {
        const spdC = containerOf(speedEl);
        if (!spdC) return;

        const sec = (Number(adjustedSpeed ?? 0) / 1000).toFixed(1);
		speedEl.textContent = `${sec} s`;
        const direction = applyStatDeltaClass(
          spdC,
          adjustedSpeed,
          baseSpeed,
          { isNew: false }
        );

        if (direction === "up") {
          upgradedContainers.push(spdC);
        }
      });

      if (upgradedContainers.length) {
        setLastUpgraded(upgradedContainers);
      }

      continue;
    }

    if (stat === 'speed') {
      const upgradedContainers = [];
      const speedEls = Array.from(qAll("speed"));
      const nextSpeed = Number(value ?? 0) || 0;
      const baseSpeed = getSnapshotComparableValue(baseStats, "speed", 0);

      speedEls.forEach((speedEl) => {
        const spdC = containerOf(speedEl);
        if (!spdC) return;

        speedEl.textContent = `${(nextSpeed / 1000).toFixed(2)} s`;
        const direction = applyStatDeltaClass(
          spdC,
          nextSpeed,
          baseSpeed,
          { isNew: shouldMarkNew(spdC, isNew) }
        );
        if (direction === "up") upgradedContainers.push(spdC);
      });

      if (upgradedContainers.length) {
        setLastUpgraded(upgradedContainers);
      }

      continue;
    }

    // cas générique
    const comparison = getPayloadStatDeltaComparison(payload, value, oldValueForStat);
    const dynamicRowConfig = STATS_PANEL_DYNAMIC_ROWS[normalizeStatKey(stat)];
    const upgradedContainers = [];

    els.forEach((el) => {
      const c = containerOf(el);
      const usesSyncedCalculator = Boolean(c?.dataset?.calculatorName || c?.dataset?.valueTemplate);
      let nextForClass = comparison.next;
      let beforeForClass = comparison.before;

      if (usesSyncedCalculator) {
        const resolvedNext = resolveStatContainerValue(c, afterEntity, stat, value);
        const resolvedBefore = resolveStatContainerValue(c, beforeEntity, stat, oldValueForStat);
        el.innerHTML = resolvedNext.html;
        nextForClass = payload?.visualAfter ?? resolvedNext.value;
        beforeForClass = payload?.visualBefore ?? resolvedBefore.value;
      } else if (dynamicRowConfig && el.closest(".stat-section-codex")) {
        el.innerHTML = formatStatsPanelDynamicValue(dynamicRowConfig, value);
      } else {
        el.textContent = value;
      }

      if (!c) return;

      if (shouldRemoveFinalZeroStatContainer(c, stat, nextForClass, beforeForClass)) {
        c.remove();
        return;
      }

      if (getStatComparableValue(nextForClass, 0) <= 0) {
        applyStatDeltaClass(c, nextForClass, beforeForClass, {
          isNew: shouldMarkNew(c, isNew),
        });
      } else {
        c.classList.remove("last");
        const direction = applyStatDeltaClass(c, nextForClass, beforeForClass, {
          isNew: shouldMarkNew(c, isNew),
        });
        if (direction === "up") upgradedContainers.push(c);
      }
    });

    if (upgradedContainers.length) {
      setLastUpgraded(upgradedContainers);
    }
  }
}

function syncEntityResourceCounters(entityId, stats, entityContext = null) {
  if (!entityId || !stats) return;

  const hp = stats.HP;
  const armor = stats.armor;
  const currentHP = Number(hp?.current ?? 0) || 0;
  const maxHP = Number(hp?.max ?? 0) || 0;
  const currentArmor = Number(armor?.current ?? 0) || 0;
  const maxArmor = Number(armor?.max ?? 0) || 0;
  const entity = { id: entityId, stats };

  if (hp && typeof hp === "object") {
    updateHealthBar(currentHP, maxHP, currentArmor, maxArmor, entityId);
    updateHPCounters(entityId, currentHP, maxHP);
  }

  updateArmorCounter(entity);
  updateBonusLifeCounters(entity);
  updateMovementDisplay({ ...(entityContext || getLiveEntityForStatSync(entityId)), ...entity }, { animate: false });
}

export function syncDOMWithStats(oldStats = {}, newStats = {}, entityId, entityContext = null, options = {}) {
  if (!entityId) return;

  const renderedBefore = options.renderedBefore || getRenderedStatContainersForEntity(entityId);
  const changedStats = {};
  const allKeys = new Set([...Object.keys(oldStats), ...Object.keys(newStats)]);

  for (const stat of allKeys) {
    const oldVal = oldStats[stat];
    const newVal = (newStats[stat] !== undefined) ? newStats[stat] : 0;

    if (isStatsSnapshotDifferent(oldVal, newVal)) {
      changedStats[stat] = {
        value: newVal,
        isNew: false
      };
    }
  }

  addRenderedStatImpactDiffs(changedStats, oldStats, newStats, entityId, entityContext, options);
  addStatsPanelDynamicDiffs(changedStats, oldStats, newStats, entityId, entityContext, options);

  // ✅ IMPORTANT : si velocity change, on force aussi la MAJ de speed
  // (sinon ton DOM peut garder une speed obsolète)
  if ("velocity" in changedStats) {
    if (newStats.speed !== undefined) {
      changedStats.speed = {
        value: newStats.speed,
        isNew: false
      };
    }
  }

  updateStatsInDOM(changedStats, { id: entityId, ...oldStats }, entityContext, { renderedBefore });
  syncStatsPanelDynamicRows(entityId, oldStats, newStats, entityContext, changedStats, renderedBefore, options);
  syncEntityResourceCounters(entityId, newStats, entityContext);
  const currentEntity = entityContext || getLiveEntityForStatSync(entityId);
  document.querySelectorAll('.level-up-section').forEach(section => section._refreshStats?.(currentEntity));
  document.querySelectorAll(`.attack-submenu-infos[data-entity-id="${cssEscapeValue(entityId)}"]`)
    .forEach(section => section._refreshStats?.(currentEntity || { id: entityId, stats: newStats }));
  if (typeof window !== "undefined" && typeof window.refreshCodexUmbraPanel === "function") {
    window.refreshCodexUmbraPanel(
      entityContext || { id: entityId, stats: newStats },
      { oldStats, newStats, changedStats }
    );
  }
  localStorage.setItem("entityStats", JSON.stringify(newStats));
  return changedStats; // optionnel, mais pratique en debug
}


export function createNicknameForm(entite, codexColumn) {
    let nicknameForm = document.createElement('div');
    nicknameForm.className = 'nickname-form-container';

    // H2 pour afficher le pseudo
    let nicknameDisplay = document.createElement('h2');
    nicknameDisplay.className = 'nickname-display';
    nicknameDisplay.textContent = entite.nickname || '';
    nicknameForm.appendChild(nicknameDisplay);

    // Picto éditer
    let editIcon = document.createElement('span');
    editIcon.className = 'icon edit-icon';
    editIcon.innerHTML = '&#9998;'; // Pencil symbol
    editIcon.style.visibility = 'hidden';
    editIcon.style.transition = 'opacity 2s';
    editIcon.style.opacity = '0';
    nicknameForm.appendChild(editIcon);

    // Bouton pour ajouter un surnom
    let addNicknameButton = document.createElement('div');
    addNicknameButton.className = 'new-nickname';
    addNicknameButton.textContent = 'Donner un surnom';
    addNicknameButton.style.display = entite.nickname ? 'none' : 'inline-block';
    nicknameForm.appendChild(addNicknameButton);

    // Champ de modification
    let nicknameInput = document.createElement('input');
    nicknameInput.type = 'text';
    nicknameInput.placeholder = 'Donner un surnom à votre entité';
    nicknameInput.className = 'nickname-input';
    nicknameInput.style.display = 'none';
    nicknameForm.appendChild(nicknameInput);

    // Picto valider
    let validateIcon = document.createElement('span');
    validateIcon.className = 'icon validate-icon';
    validateIcon.innerHTML = '&#10004;'; // Checkmark symbol
    validateIcon.style.display = 'none';
    nicknameForm.appendChild(validateIcon);

    // Picto effacer
    let clearIcon = document.createElement('span');
    clearIcon.className = 'icon clear-icon';
    clearIcon.innerHTML = '&#10006;'; // Cross symbol
    clearIcon.style.display = 'none';
    nicknameForm.appendChild(clearIcon);

    const toggleToEditMode = () => {
        nicknameDisplay.style.display = 'none';
        addNicknameButton.style.display = 'none';
        nicknameInput.style.display = 'inline-block';
        validateIcon.style.display = 'inline-block';
        clearIcon.style.display = 'inline-block';
        nicknameInput.value = entite.nickname || '';
        nicknameInput.focus();

        // Désactiver temporairement la transition
        editIcon.style.transition = 'none';
        editIcon.style.opacity = '0';

        // Réactiver la transition après la mise à jour de l'opacité
        setTimeout(() => {
            editIcon.style.transition = 'opacity 2s';
        });

        document.addEventListener('click', outsideClickListener);
    };

const toggleToDisplayMode = () => {
    nicknameDisplay.style.display = 'block';
    addNicknameButton.style.display = entite.nickname ? 'none' : 'inline-block';
    nicknameInput.style.display = 'none';
    validateIcon.style.display = 'none';
    clearIcon.style.display = 'none';
    nicknameDisplay.textContent = entite.nickname || '';

    // 🔄 Mise à jour de la liste Codex en temps réel
    const codexEntry = document.querySelector(`#CodexEntityList_${entite.id}`);
    if (codexEntry) {
        const nameLabel = codexEntry.querySelector('.codex-entity-name');
        if (nameLabel) {
            nameLabel.textContent = entite.nickname || entite.name;
        }
    }

    document.removeEventListener('click', outsideClickListener);
};

const outsideClickListener = (event) => {
  if (event.target === clearIcon) return; // laisser le handler clear gérer seul
  if (!nicknameForm.contains(event.target)) {
    if (nicknameInput.style.display === 'inline-block') {
      entite.nickname = nicknameInput.value.trim();
      if (validateAndSetNickname(entite, nicknameInput, nicknameDisplay)) {
        toggleToDisplayMode();
      }
    }
  }
};


    // Gestion de l'édition via hover sur le H2
    nicknameDisplay.addEventListener('mouseover', () => {
        if (entite.nickname) {
            editIcon.style.visibility = 'visible';
            editIcon.style.opacity = '1';
        }
        nicknameDisplay.style.cursor = 'pointer';
    });

    nicknameDisplay.addEventListener('mouseout', () => {
        editIcon.style.opacity = '0';
    });

    nicknameDisplay.addEventListener('click', toggleToEditMode);

    // Gestion de l'édition
    editIcon.addEventListener('click', toggleToEditMode);

    // Gestion de l'ajout de surnom
    addNicknameButton.addEventListener('click', toggleToEditMode);

    // Validation du surnom
    validateIcon.addEventListener('click', () => {
        entite.nickname = nicknameInput.value.trim();
        if (validateAndSetNickname(entite, nicknameInput, nicknameDisplay)) {
            toggleToDisplayMode(); // Quitte le mode édition seulement si le surnom est valide
        }
    });

    // Effacer le surnom
    clearIcon.addEventListener('click', () => {
        // Supprimer le pseudo quoi qu'il arrive
        entite.nickname = null;
        saveUpgradedEntity(entite); // Sauvegarder l'entité après suppression
        toggleToDisplayMode(); // Retourner au mode d'affichage
    });

    // Validation via la touche Entrée
    nicknameInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            entite.nickname = nicknameInput.value.trim();
            if (validateAndSetNickname(entite, nicknameInput, nicknameDisplay)) {
                toggleToDisplayMode(); // Quitte le mode édition seulement si le surnom est valide
            }
        }
    });

    // Ajouter le formulaire à la colonne spécifiée
    codexColumn.appendChild(nicknameForm);

    // Initialiser la visibilité des pictos
    if (entite.nickname) {
        editIcon.style.visibility = 'hidden';
    } else {
        editIcon.style.visibility = 'hidden';
    }
}
export function updateNickname(entite, newNickname, currentNickname) {
    newNickname = newNickname.trim();
    entite.nickname = newNickname;
    currentNickname.textContent = newNickname || 'Aucun surnom défini';
    console.log(`Le surnom de l'entité ID ${entite.id} a été modifié en : "${newNickname || 'Aucun'}"`);
} 

export function LevelupSignal(
  entite,
  type = 'bouton',
  { onOpen = null, section = 'Profil', parent = null } = {}
) {
  const currentLevel = getEntityLevelCurrent(entite);
  const maxLevelForEntity = getEntityLevelMax(entite);

  const nextLevelData = levelDetails.find(l => l.level === currentLevel + 1);
  const playerXP = getAvailablePlayerExperience();

  const canLevelUp = !!(
    nextLevelData &&
    currentLevel < maxLevelForEntity &&
    playerXP >= nextLevelData.cost
  );

  const el = document.createElement(type === 'bouton' ? 'div' : 'span');
  el.className = type === 'bouton' ? 'btn levelup-btn' : 'levelup-icon';

  if (type === 'bouton') {
    el.textContent = 'Monter le niveau 🡅';
  } else {
    el.innerHTML = '🡅';
    el.title = 'Monter le niveau';
  }

  // ✅ resolve parent (Element ou selector)
  const parentEl =
    parent instanceof Element ? parent :
    (typeof parent === 'string' ? document.querySelector(parent) : null);

  // ✅ si pas de level up possible, on cache et (optionnel) on retire du parent
  if (!canLevelUp) {
    if (type !== 'bouton' && parentEl) {
      parentEl.querySelectorAll('.levelup-icon').forEach(n => n.remove());
    }
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  const triggerOpen = (e) => {
    e?.stopPropagation?.();

    const statsMenuIndex = 2;
    const levelUpSubmenuIndex = 2;

    saveToLocalStorage('CodexMenuIndex', statsMenuIndex);
    saveToLocalStorage('CodexSubmenuIndex', levelUpSubmenuIndex);

    if (typeof showSection === 'function') showSection('Stats');
    if (typeof createLevelUpForm === 'function') createLevelUpForm(entite);

    if (typeof onOpen === 'function') onOpen(section);
  };

  el.style.cursor = 'pointer';
  el.tabIndex = 0;
  el.addEventListener('click', triggerOpen);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') triggerOpen(e);
  });

  // ✅ si on a un parent cible + type icon => on mount ici (sans doublon)
if (type !== 'bouton' && parentEl) {
  parentEl.querySelectorAll('.levelup-icon').forEach(n => n.remove());

  const soulPicto = parentEl.querySelector('.codex-soul');

  if (soulPicto) {
    soulPicto.insertAdjacentElement('afterend', el);
    soulPicto.insertAdjacentText('afterend', ' ');
  } else {
    parentEl.appendChild(el);
  }
}

  return el;
}

// Fonction pour mettre à jour l'affichage de l'Experience à chaque modification
export function updateExperienceDisplay() {
    const scoringDiv = document.getElementById('score');
    if (scoringDiv) {
        scoringDiv.textContent = `Experience : ${playerExperience}`;
    }
}

function levelUpWithXP(entite, xpCost) {
    playerExperience = getAvailablePlayerExperience();
    if (playerExperience >= xpCost) {
        // Retrancher l'XP du joueur
        const payment = spendPlayerExperience(xpCost);
        if (!payment) return;
        entite.adminExperienceSpent = (Number(entite.adminExperienceSpent) || 0) + payment.admin;
        playerExperience = getAvailablePlayerExperience();

        // Ajouter l'XP à l'entité
        entite.experience += xpCost;

        let currentLevel = getEntityLevelCurrent(entite);
        const maxLevelForEntity = getEntityLevelMax(entite);

        let nextLevelData = levelDetails.find(level => level.level === currentLevel + 1);

        while (
          nextLevelData &&
          entite.experience >= nextLevelData.totalExperience &&
          currentLevel < maxLevelForEntity
        ) {
            currentLevel++;
            setEntityLevelCurrent(entite, currentLevel);
            nextLevelData = levelDetails.find(level => level.level === currentLevel + 1);

            console.log(`🎉 ${entite.name} est passé au niveau ${currentLevel} !`);

            const levelDisplay = document.querySelector(`#level-${entite.id}`);
            if (levelDisplay) {
                levelDisplay.textContent = `Niveau actuel : ${currentLevel}`;
            }
        }

        recordEntityProgression(entite, { experienceSpent: xpCost });
        // Sauvegarde dans selectedArmyA
        const enrichedArmyA = JSON.parse(localStorage.getItem('selectedArmyA')) || [];
        const index = enrichedArmyA.findIndex(e => e.id === entite.id);
        if (index !== -1) {
            enrichedArmyA[index] = entite;
            localStorage.setItem('selectedArmyA', JSON.stringify(enrichedArmyA));
        }

        // Sauvegarder l'XP joueur
        console.log(`Experience restante du joueur : ${playerExperience}`);

        updateExperienceDisplay();
    } else {
        console.warn("Pas assez d'Experience pour augmenter le niveau !");
    }
}

function buildCostMap(levelDetails) {
  const map = new Map();
  for (const l of levelDetails) map.set(l.level, l.cost);
  return map;
}
function costAt(costMap, level) { return costMap.get(level) ?? null; }

// DOM LVL UP
function createLevelElements(entite) {
	
	const levelUpSection = document.createElement('div');
	levelUpSection.className = 'level-up-section';

	const SoulSection = document.createElement('div');
	SoulSection.className = 'soul-section';
	SoulSection.id = `soul-section-${entite.id}`;

	// Icones Archetypes
	const ArchSection = document.createElement('div');
	ArchSection.className = 'archetype-icon-section';
	ArchSection.id = `archetype-icons-${entite.id}`;

	// On STOCKE les achieve. On NE crée PAS les icônes maintenant !
	const achievedList = (entite.Archetype && Array.isArray(entite.Archetype.achieve))
		? [...entite.Archetype.achieve]
		: [];

	// Graphique temps réel (camembert) — tout en haut
	const graphcontainer = document.createElement('div');
	graphcontainer.className = 'attribut-graph-container';
	graphcontainer.id = `soul-${entite.id}`;
	graphcontainer.classList.add("created");
	setTimeout(() => { graphcontainer.classList.remove("created"); }, 500);

	const graphCanvas = document.createElement('canvas');
	graphCanvas.width = 122;
	graphCanvas.height = 122;
	graphCanvas.className = 'attribut-graph';

	const eclipseCanvas = document.createElement('img');
	eclipseCanvas.src = './media/assets/misc/soul-eclipsaura.webp';
	eclipseCanvas.className = 'attribut-eclipse';
	eclipseCanvas.id = 'eclipse';

	const circleSoul = document.createElement('div');
	circleSoul.className = 'attribut-circleSoul';

	const soulEntity = document.createElement('div');
	soulEntity.className = 'attribut-entitySoul';

	const entitySoulImg1 = document.createElement('img');
	entitySoulImg1.src = './media/assets/misc/soul-entity-01.png';
	entitySoulImg1.className = 'attribut-entitySoul one';

	const entitySoulImg2 = document.createElement('img');
	entitySoulImg2.src = './media/assets/misc/soul-entity-02.png';
	entitySoulImg2.className = 'attribut-entitySoul two';

	const entitySoulBg = document.createElement('div');
	entitySoulBg.className = 'entitySoul-bg';

	const entitySoulblack = document.createElement('div');
	entitySoulblack.className = 'black-circle';

	soulEntity.appendChild(entitySoulImg1);
	soulEntity.appendChild(entitySoulImg2);

	const soulDepth = document.createElement('div');
	soulDepth.className = 'soul-depth';

	const soulAura = document.createElement('div');
	soulAura.className = 'soul-aura';

	graphcontainer.appendChild(soulEntity);
	graphcontainer.appendChild(entitySoulBg);
	graphcontainer.appendChild(entitySoulblack);
	graphcontainer.appendChild(eclipseCanvas);
	graphcontainer.appendChild(graphCanvas);
	graphcontainer.appendChild(circleSoul);
	graphcontainer.appendChild(soulDepth);
	graphcontainer.appendChild(soulAura);

	// Archétype actif — juste en dessous du graph
	const archetypeLine = document.createElement('div');
	archetypeLine.className = 'archetype-line';
	archetypeLine.id = `archetype-line-${entite.id}`;
	
	const archetypeLabel = document.createElement('span');
	archetypeLabel.className = 'archetype-title';

	const archetypeDesc = document.createElement('p');
	archetypeDesc.className = 'archetype-description';
	archetypeDesc.textContent = '';

	// Jauge de progression
	const gaugeWrap = document.createElement('div');
	gaugeWrap.className = 'archetype-bar';

	const canvasUp = document.createElement('canvas');
	canvasUp.id = 'archup';
	canvasUp.className = 'arch-up';

	const gaugeBar = document.createElement('div');
	gaugeBar.className = 'archetype-lvl-bar';

	const gaugeFill = document.createElement('div');
	gaugeFill.className = 'archetype-level-fill';

	const gaugeLabel = document.createElement('div');
	gaugeLabel.className = 'archetype-lvl-label';
	gaugeLabel.style.opacity = '0';
	gaugeLabel.style.transition = 'opacity 250ms ease';
	gaugeLabel.style.pointerEvents = 'none';

	const showGaugeHint = () => { gaugeLabel.style.opacity = '1'; };
	const hideGaugeHint = () => { gaugeLabel.style.opacity = '0'; };

	gaugeWrap.addEventListener('mouseenter', showGaugeHint);
	gaugeWrap.addEventListener('mouseleave', hideGaugeHint);
	gaugeWrap.addEventListener('focusin',   showGaugeHint);
	gaugeWrap.addEventListener('focusout',  hideGaugeHint);

	gaugeBar.appendChild(gaugeFill);

	const gaugeMilestones = document.createElement('div');
	gaugeMilestones.className = 'archetype-milestones';
	gaugeWrap.appendChild(gaugeMilestones);

	gaugeWrap.append(gaugeBar, gaugeLabel);
	gaugeWrap.appendChild(canvasUp);

	SoulSection.appendChild(ArchSection);
	SoulSection.appendChild(graphcontainer);

	levelUpSection.appendChild(SoulSection);

	archetypeLine.appendChild(archetypeLabel);
	archetypeLine.appendChild(gaugeWrap);
	archetypeLine.appendChild(archetypeDesc);
	SoulSection.appendChild(archetypeLine);

	// Ligne Niveau
	const currentLevel = getEntityLevelCurrent(entite);

	const levelBloc = document.createElement('div');
	levelBloc.className = 'level-bloc';
	levelUpSection.appendChild(levelBloc);

	// ✅ bloc 1 (infos lvl + XP)
	const levelInfosBloc = document.createElement('div');
	levelInfosBloc.className = 'level-infos-bloc';

	// ✅ bloc 2 (boutons)
	const levelButtonsBloc = document.createElement('div');
	levelButtonsBloc.className = 'level-buttons-bloc';

	const levelLine = document.createElement('div');
	levelLine.className = 'level-line';

	const levelName = document.createElement('span');
	levelName.className = 'levelup-name';
	levelName.textContent = 'Niveau : ';

	const levelCurrent = document.createElement('span');
	levelCurrent.className = 'level-current';
	levelCurrent.textContent = currentLevel;
	levelCurrent.setAttribute('data-stat', 'lvl');

	const levelTransition = document.createElement('span');
	levelTransition.className = 'level-transi is-hidden';
	levelTransition.textContent = ' > ';

	const levelFuture = document.createElement('span');
	levelFuture.className = 'level-future is-hidden';
	levelFuture.textContent = currentLevel;

	levelLine.append(levelName, levelCurrent, levelTransition, levelFuture);

	// XP
	const XPTitle = document.createElement('p');
	XPTitle.textContent = 'Expérience :';

	const DivXpDisplay = document.createElement('div');
	DivXpDisplay.className = 'div-xp-display';
	DivXpDisplay.appendChild(XPTitle);
	const initialXPDisplay = document.createElement('p');
	initialXPDisplay.className = 'initial-xp-display';
	DivXpDisplay.appendChild(initialXPDisplay);

	const transitionXP = document.createElement('p');
	transitionXP.className = 'xp-transi is-hidden';
	transitionXP.textContent = ' > ';
	DivXpDisplay.appendChild(transitionXP);

	const playerXPDisplay = document.createElement('p');
	playerXPDisplay.className = 'xp-display is-hidden';
	DivXpDisplay.appendChild(playerXPDisplay);

	const investedXPDisplay = document.createElement('p');
	investedXPDisplay.className = 'invested-xp-display is-hidden';
	investedXPDisplay.textContent = `- 0 XP`;

	const xpCostDisplay = document.createElement('p');

	// Bloc attributs
	const attributibutUp = document.createElement('div');
	attributibutUp.className = 'attribut-up';

	// Boutons
	const levelupbuttons = document.createElement('div');
	levelupbuttons.className  = 'level-up-buttons';

	const confirmButton = document.createElement('div');
	confirmButton.textContent = 'Confirmer';
	confirmButton.className = 'confirm-button yes level is-hidden';

	const clearBtn = document.createElement('div');
	clearBtn.id = 'clear-history-btn';
	clearBtn.textContent = 'Réinitialiser';
	clearBtn.className = 'confirm-button clear is-hidden';

	levelupbuttons.append(confirmButton, clearBtn);

	// ✅ Assemblage : infos dans un bloc, boutons dans un autre
	levelInfosBloc.append(
		levelLine,
		DivXpDisplay,
		investedXPDisplay,
		xpCostDisplay
	);

	levelButtonsBloc.appendChild(levelupbuttons);

	// ✅ levelBloc contient : infos, attributs, boutons
	levelBloc.append(
	attributibutUp,
		levelInfosBloc,
		
		levelButtonsBloc
	);

	// 🔥 CREATION DES ICONES APRÈS INSERTION DANS LE DOM
	requestAnimationFrame(() => {
	    achievedList.forEach(ach => {
	       createArchetypeIcon(entite, ach.key, ach.level, ach.uid);
	    });
	});

	return {
		levelUpSection,
		gauge: { wrap: gaugeWrap, bar: gaugeBar, fill: gaugeFill, label: gaugeLabel, milestones: gaugeMilestones },
		levelCurrent, levelTransition, levelFuture,
		initialXPDisplay, transitionXP, playerXPDisplay, investedXPDisplay, xpCostDisplay,
		attributibutUp,
		confirmButton, clearBtn,
		archetypeLabel,
		archetypeDesc,
		graphCanvas,
	};
}

function buildattributibutLine(attribut, baseValue, entite) {

  const attributLine = document.createElement('div');
  attributLine.className = 'level-up-attribut-line';

  const axisLine = document.createElement('div');
  axisLine.className = 'axis-line';
  axisLine.dataset.short = attribut.short;  // "F" | "A" | "I"
  axisLine.dataset.key   = attribut.key;

  // ✅ PICto (F/A/I -> strength/agility/intelligence)
  const map = { F: 'strength', A: 'agility', I: 'intelligence' };
  const pictoName = map[attribut.short];

  const pictoWrap = document.createElement('div');
  pictoWrap.className = 'attribut-picto';
  pictoWrap.dataset.short = attribut.short;
  Object.assign(pictoWrap.dataset, { stat: attribut.key, entityId: String(entite.id), hover: 'true', attributeHelper: 'true' });
  pictoWrap.tabIndex = 0;
  pictoWrap.setAttribute('role', 'button');
  pictoWrap.setAttribute('aria-label', attribut.label);
  bindHelperEntity(pictoWrap, entite);

  const picto = document.createElement('div');
  picto.className = `picto-stat ${pictoName} attribut`;

  pictoWrap.appendChild(picto);

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = attribut.label;

  const leftArrow = document.createElement('span');
  leftArrow.className = 'xp-arrow left-arrow is-hidden';
  leftArrow.textContent = '<';

  const valueDisplay = document.createElement('div');
  valueDisplay.className = 'axis-value-display';
  valueDisplay.textContent = baseValue;

  const rightArrow = document.createElement('span');
  rightArrow.className = 'xp-arrow right-arrow';
  rightArrow.textContent = '>';

  axisLine.append(label, leftArrow, valueDisplay, rightArrow);

  // ✅ ordre DOM demandé : picto d'abord, axisLine en dessous
  attributLine.append(pictoWrap, axisLine);

  // ✅ compat si ton code lit dataset sur l'élément retourné
  attributLine.dataset.short = axisLine.dataset.short;
  attributLine.dataset.key   = axisLine.dataset.key;

  return attributLine;
}



// LEVEL LOGIQUE DOM
function findAvailableAnimaId() {
  const player = loadFromLocalStorage('PlayerSave', {});
  const items = loadFromLocalStorage('IngameItemsData', {}).items || [];
  const inventory = Array.isArray(player.Playerinventory) ? player.Playerinventory : [];
  for (const entry of inventory) {
    const item = typeof entry === 'string' ? items.find(candidate => candidate.itemId === entry) : entry;
    if (item?.functionName === 'AnimaOmbilicale' && item.itemType?.includes('consumable')) return item.itemId;
  }
  return null;
}

function refreshPurificationButtons() {
  const available = Boolean(findAvailableAnimaId());
  const army = loadFromLocalStorage('selectedArmyA', []);
  document.querySelectorAll('.level-purify-button').forEach(button => {
    const entity = Array.isArray(army)
      ? army.find(entry => String(entry.id) === button.dataset.entityId)
      : null;
    const level = entity ? getEntityLevelCurrent(entity) : Number(button.dataset.entityLevel);
    button.hidden = !available || !(level > 1);
  });
}

let purificationInventoryListenerBound = false;
function createPurificationButton(entity, form, purificationHost = null) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'level-purify-button';
  button.dataset.entityId = String(entity.id);
  button.dataset.entityLevel = String(getEntityLevelCurrent(entity));
  button.textContent = `Purifier ${entity.nickname || entity.name}`;
  button.hidden = !findAvailableAnimaId() || !(getEntityLevelCurrent(entity) > 1);
  if (!purificationInventoryListenerBound) {
    window.addEventListener('inventoryItemsUpdated', refreshPurificationButtons);
    window.addEventListener('selectedArmyAUpdated', refreshPurificationButtons);
    purificationInventoryListenerBound = true;
  }
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const itemId = findAvailableAnimaId();
    if (!itemId) { refreshPurificationButtons(); return; }
    button.disabled = true;
    try {
      const { useConsumableItem } = await import("../items/itemManager.js");
      const result = await useConsumableItem(itemId, entity);
      // The codex may already have rebuilt its form during purification.
      if (result?.ok && form.isConnected) {
        form.replaceWith(createLevelUpForm(entity, { purificationHost }));
      }
    } finally {
      button.disabled = false;
      refreshPurificationButtons();
    }
  });
  return button;
}

export function createLevelUpForm(entite, { purificationHost = null } = {}) {
  const dom = createLevelElements(entite);
  bindHelperEntity(dom.levelUpSection, entite);
  bindLevelUpLogic(entite, dom, levelDetails);
  const host = purificationHost || dom.levelUpSection;
  host.querySelectorAll(':scope > .level-purify-button').forEach(button => button.remove());
  host.prepend(createPurificationButton(entite, dom.levelUpSection, purificationHost));

  const currentLevel = getEntityLevelCurrent(entite);
  const lvl = Math.max(1, Math.min(99, currentLevel)); // si tu veux garder ce clamp

  setTimeout(() => {
    soulScaling(currentLevel);
  }, 0);

  return dom.levelUpSection;
}

function soulScaling(level) {
  const element = document.getElementById('eclipse');
  const soul = document.querySelector('.attribut-entitySoul');
  const soulTwo = document.querySelector('.attribut-entitySoul.two');

  // clamp 1..99
  level = Math.max(1, Math.min(100, level));
  const isMax = level === 100;

  const opacityMin = 0.6, opacityMax = 0.8;
  const scaleMin = 0.5, scaleMax = 0.9;

  // taille entitySoul
  const sizeMin = 30; // px
  const sizeMax = 85; // px
  const sizeMaxLevel99 = 125; // statut spécial level max

  // soulTwo scaling
  const soulTwoMin = 0.1;
  const soulTwoMax = 0.8;

  const ratio = (level - 1) / 98;

  const opacity = opacityMin + (opacityMax - opacityMin) * ratio;
  const scale = scaleMin + (scaleMax - scaleMin) * ratio;
  let size = sizeMin + (sizeMax - sizeMin) * ratio;

  // filter scaling (100% → 120%)
  const satPct = isMax ? 120 : 100 + 20 * ratio;
  const ctrPct = isMax ? 120 : 100 + 20 * ratio;

  const soulTwoValue = soulTwoMin + (soulTwoMax - soulTwoMin) * ratio;

  if (element) {
    element.style.opacity = (isMax ? opacityMax : opacity).toFixed(3);
    element.style.transform = `scale(${(isMax ? scaleMax : scale).toFixed(3)})`;
  }

  if (soul) {
    if (isMax) {
      soul.style.width = `${sizeMaxLevel99}px`;
      soul.style.height = `${sizeMaxLevel99}px`;
    } else {
      soul.style.width = `${size.toFixed(1)}px`;
      soul.style.height = `${size.toFixed(1)}px`;
    }
    soul.style.filter = `saturate(${satPct.toFixed(1)}%) contrast(${ctrPct.toFixed(1)}%)`;
  }

  if (soulTwo) {
    soulTwo.style.opacity = (isMax ? soulTwoMax : soulTwoValue).toFixed(3);
  }
}

function determineNextSubStat(attributName, counters, subHistory, currentLevel = 1) {
  const { stratArchetype } = getArchetypeConfig();

  // 1️⃣ Archetype réel
  const realKey = String(
    getClassFromAttributs(
      counters.force,
      counters.agilite,
      counters.intelligence,
      currentLevel
    )
  ).trim().toLowerCase();

  // 2️⃣ Archetype verrouillé tant que pas éveillé
  const classKey = (currentLevel < stratArchetype)
    ? "egare"
    : realKey;

  // 3️⃣ Cycle (normal ou “égaré” forcé)
  const cycle = CLASS_INDEX[classKey]?.cycle ?? DEFAULT_CYCLE;

  // 4️⃣ Index du cycle selon historique
  const idx = (subHistory[attributName]?.length ?? 0) % cycle.length;

  // 5️⃣ Résolution mutation + nom final d’étape
  const rawCycleName = String(cycle[idx]).trim();
  const { finalName: cycleName, mutationLevel } = resolveMutation(
    rawCycleName,
    counters.force,
    counters.agilite,
    counters.intelligence
  );

  // 6️⃣ Sous-stat attribuée
  const key =
    STAT_INDEX.typeToKey[attributName]?.[cycleName] ||
    STAT_INDEX.byattribut[attributName]?.[0];

  // 7️⃣ Historique
  if (!subHistory[attributName]) subHistory[attributName] = [];
  subHistory[attributName].push(key);

  // 8️⃣ Logs
  console.log("🔹 Sous-stat attribuée :");
  console.log("   Attribut :", attributName);
  console.log("   Archetype actif :", classKey);
  console.log("   (Archetype réel :", realKey, ")");
  console.log("   Cycle :", cycle);
  console.log("   Index :", idx);
  console.log("   Étape brute :", rawCycleName);
  console.log("   Étape finale :", cycleName);
  console.log("   Mutation level :", mutationLevel);
  console.log("   Clé attribuée :", key);
  console.log("   Historique :", subHistory[attributName]);

  return { key, classKey, cycleName, mutationLevel };
}

function roundTripleTo100(fPct, aPct, iPct) {
  let f = Math.round(fPct), a = Math.round(aPct), i = Math.round(iPct);
  let corr = 100 - (f + a + i);
  if (corr !== 0) {
    const arr = [{k:'f',v:f},{k:'a',v:a},{k:'i',v:i}].sort((x,y)=>y.v-x.v);
    arr[0].v += corr; f = arr.find(x=>x.k==='f').v; a = arr.find(x=>x.k==='a').v; i = arr.find(x=>x.k==='i').v;
  }
  return { f, a, i };
}
function normalizeAngle(a) {
  // Ramène un angle dans [0, 2π)
  return (a + 2 * Math.PI) % (2 * Math.PI);
}
function drawRealtimegraph(ctx, strength, agility, intelligence, hoverSlice = null) {
  if (!ctx) return;
  const canvas = ctx.canvas;
  const total = strength + agility + intelligence;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (total <= 0) return;

  const { f, a, i } = roundTripleTo100(
    (strength / total) * 100,
    (agility / total) * 100,
    (intelligence / total) * 100
  );

  const sections = [
    { label: 'Force',        value: f, color: '#870000' },
    { label: 'Agilité',      value: a, color: '#ffde00' },
    { label: 'Intelligence', value: i, color: '#001a66' }
  ];

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r  = Math.min(cx, cy) - 6;

  let currentAngle = -Math.PI / 2;

  sections.forEach(sec => {
    const slice = (sec.value / 100) * 2 * Math.PI;
    const start = currentAngle;
    const end   = currentAngle + slice;

    sec.start = normalizeAngle(start);
    sec.end   = normalizeAngle(end);

    ctx.save();

    // ⚡ Si hover actif et ce n’est PAS la portion survolée → désaturation
    if (hoverSlice && hoverSlice.label !== sec.label) {
      ctx.filter = "grayscale(100%)";
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = sec.color;
    ctx.fill();

    ctx.restore();

    currentAngle = end;
  });

  // --- Tooltip ---
  let tooltip = document.querySelector('.graph-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    document.body.appendChild(tooltip);
  }

  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    const dist = Math.sqrt(x * x + y * y);

    if (dist <= r) {
      let ang = normalizeAngle(Math.atan2(y, x));

      const slice = sections.find(sec => {
        if (sec.start < sec.end) {
          return ang >= sec.start && ang < sec.end;
        } else {
          return ang >= sec.start || ang < sec.end;
        }
      });

      if (slice) {
        tooltip.textContent = buildStatGraphHelper(slice);
        tooltip.style.left = e.pageX + 10 + 'px';
        tooltip.style.top  = e.pageY + 10 + 'px';
        tooltip.style.display = 'block';

        // redraw en mode focus
        drawRealtimegraph(ctx, strength, agility, intelligence, slice);
        return;
      }
    }
    tooltip.style.display = 'none';
    drawRealtimegraph(ctx, strength, agility, intelligence, null);
  };

  canvas.onmouseleave = () => {
    tooltip.style.display = 'none';
    drawRealtimegraph(ctx, strength, agility, intelligence, null);
  };
}






export function initArchetypeProgress(entite) {
  const progress = {};

  if (!entite || !entite.Archetype) return progress;
  const arch = entite.Archetype;

  const register = (entry) => {
    if (!entry || !entry.key) return;
    const key   = String(entry.key).toLowerCase();
    const lvl   = entry.level ?? 1;
    const stage = entry.step ?? entry.stage ?? 0;
    const uid   = entry.uid || getArchetypeUID();
    const milestoneArr = Array.isArray(entry.milestone)
      ? [...entry.milestone]
      : [];

    const existing = progress[key];
    // On garde la version la plus “avancée”
    if (!existing ||
        lvl > existing.level ||
        (lvl === existing.level && stage > existing.stage)) {
      progress[key] = {
        level: lvl,
        stage,
        uid,
        milestones: milestoneArr.slice(0, stage)
      };
    }
  };

  if (arch.current) register(arch.current);
  if (Array.isArray(arch.inProgress)) arch.inProgress.forEach(register);

  // arch.achieve reste pour state.achievedArchetypes, pas dans progress

  return progress;
}

function removeOtherLevels(obj, archetypeName, keepLevel) {
  const base = String(archetypeName).toLowerCase() + ' ';
  const keepKey = buildArchetypeKey(archetypeName, keepLevel);
  for (const key of Object.keys(obj)) {
    if (key.startsWith(base) && key !== keepKey) {
      delete obj[key]; // on enlève les niveaux obsolètes (ex. "shinobi 1")
    }
  }
}

function applyModifiers(target, modSet) {
  if (!modSet?.statLeveled) return;

  for (const [k, v] of Object.entries(modSet.statLeveled)) {
    const key = normalizeStatKey(k);
    if (!key) continue;

    if (isObjStat(v)) {
      target[key] = addObj(target[key], v);      // ✅ HP current/max
    } else {
      target[key] = Number(target[key] ?? 0) + Number(v ?? 0);
    }
  }
}

function getPermStats(entite) {
  // stats = déjà durable + dérivées (HP incluse)
  return entite?.stats || {};
}

function getPreviewStats(entite) {
  // preview.total = stats + preview.statLeveled + preview.generated
  return entite?.modifierStats?.preview?.total || getPermStats(entite);
}

function ensurePreviewGenerated(entite) {
  entite.modifierStats ??= {};
  entite.modifierStats.preview ??= { statLeveled: {} };
  entite.modifierStats.preview.statLeveled ??= {};
  entite.modifierStats.preview.generated ??= {};
  return entite.modifierStats.preview.generated;
}

function isZeroPreviewDelta(value) {
  if (isObjStat(value)) {
    return (
      Number(value.current ?? 0) === 0 &&
      Number(value.max ?? 0) === 0
    );
  }

  if (value && typeof value === "object") {
    return (
      Number(value.flat ?? 0) === 0 &&
      Number(value.percent ?? 0) === 0
    );
  }

  return Number(value ?? 0) === 0;
}

function normalizeFlatPercentDelta(value) {
  if (typeof value === "number") {
    return {
      flat: Number(value) || 0,
      percent: 0,
    };
  }

  return {
    flat: Number(value?.flat ?? 0) || 0,
    percent: Number(value?.percent ?? 0) || 0,
  };
}

function setPreviewGeneratedStat(entite, key, value) {
  key = normalizeStatKey(key);
  if (!entite || !key) return;

  const generated = ensurePreviewGenerated(entite);

  if (isZeroPreviewDelta(value)) {
    delete generated[key];
    return;
  }

  generated[key] = isObjStat(value)
    ? normObj(value)
    : value && typeof value === "object"
      ? normalizeFlatPercentDelta(value)
      : Number(value ?? 0);
}

function addPreviewGeneratedStat(entite, key, value) {
  key = normalizeStatKey(key);
  if (!entite || !key || isZeroPreviewDelta(value)) return;

  const generated = ensurePreviewGenerated(entite);
  const current = generated[key];
  let next;

  if (isObjStat(current) || isObjStat(value)) {
    next = addObj(current, value);
  } else if (
    (current && typeof current === "object") ||
    (value && typeof value === "object")
  ) {
    const a = normalizeFlatPercentDelta(current);
    const b = normalizeFlatPercentDelta(value);
    next = {
      flat: a.flat + b.flat,
      percent: a.percent + b.percent,
    };
  } else {
    next = (Number(current ?? 0) || 0) + (Number(value ?? 0) || 0);
  }

  setPreviewGeneratedStat(entite, key, next);
}

function clearPreviewGeneratedStat(entite, key) {
  key = normalizeStatKey(key);
  const generated = entite?.modifierStats?.preview?.generated;
  if (!generated || !key) return;
  delete generated[key];
}

function clearPreviewGeneratedStats(entite) {
  if (!entite?.modifierStats?.preview) return;
  entite.modifierStats.preview.generated = {};
}

function removeGeneratedStatsFromPreviewLeveled(entite) {
  const statLeveled = entite?.modifierStats?.preview?.statLeveled;
  if (!statLeveled) return;

  normalizeStatModifierMapInPlace(statLeveled);

  for (const key of PREVIEW_GENERATED_ONLY_KEYS) {
    if (STAT_SYSTEM_ORIGINS[key]) continue;
    delete statLeveled[key];
  }
}

function applyPreviewDelta(target, key, delta) {
  key = normalizeStatKey(key);
  if (!target || !key) return;

  if (key === "shift") {
    const rawDelta = isObjStat(delta)
      ? Number(delta.max ?? delta.current ?? 0)
      : Number(delta ?? 0);
    const shift = isObjStat(target.shift)
      ? normObj(target.shift)
      : normObj(Number(target.shift ?? 0) || 0);

    target.shift = {
      current: Math.max(0, shift.current + rawDelta),
      max: Math.max(0, shift.max + rawDelta),
    };
    return;
  }

  if (isObjStat(delta)) {
    target[key] = addObj(target[key], delta);
    return;
  }

  if (delta && typeof delta === "object") {
    const flat = Number(delta.flat ?? 0) || 0;
    const percent = Number(delta.percent ?? 0) || 0;
    const baseValue = Number(target[key] ?? 0) || 0;
    const afterFlat = baseValue + flat;
    target[key] = percent
      ? afterFlat * (1 + percent / 100)
      : afterFlat;
    return;
  }

  target[key] =
    Number(target[key] ?? 0) +
    Number(delta ?? 0);
}

function applyPreviewDeltaSet(target, deltas = {}, { skip = new Set() } = {}) {
  normalizeStatModifierMapInPlace(deltas);
  for (const [key, delta] of Object.entries(deltas || {})) {
    if (skip.has(key)) continue;
    applyPreviewDelta(target, key, delta);
  }
}
function ensureStatNodes(entiteId, key, rootEl) {
  // rootEl doit être un ELEMENT, pas document
  let container = rootEl;

  // Fallbacks intelligents si rootEl non fourni ou invalide
  if (!container || container.nodeType !== 1) {
    // Essaye de trouver un container dédié à l’entité
    container = document.querySelector(`.entity-stats-section[data-entity-id="${entiteId}"]`)
             || document.querySelector(`#stats-${entiteId}`)
             || document.body; // dernier recours, mais ÉVITE si possible
  }

  // Recherche dans le container
  let perm = container.querySelector(`.entite-stat[data-entity-id="${entiteId}"][data-stat="${key}"]:not(.preview)`);
  let prev = container.querySelector(`.entite-stat.preview[data-entity-id="${entiteId}"][data-stat="${key}"]`);

  // Crée le permanent si absent
  if (!perm) {
    perm = document.createElement('div');
    perm.className = 'entite-stat';
    perm.dataset.entityId = String(entiteId);
    perm.dataset.stat = key;
    container.insertAdjacentElement('beforeend', perm);
  }

  // Crée le preview si absent (juste après le perm)
  if (!prev) {
    prev = document.createElement('div');
    prev.className = 'entite-stat preview is-hidden';
    prev.dataset.entityId = String(entiteId);
    prev.dataset.stat = key;
    perm.insertAdjacentElement('afterend', prev);
  }

  return { perm, prev };
}
function isEntityAwakened(entite) {
  return !!(
    entite?.Archetype?.current &&
    entite.Archetype.current.key &&
    entite.Archetype.current.key !== "egare"
  );
}
function fmt(v) {
  if (isObjStat(v)) return `${Number(v.current ?? 0)} / ${Number(v.max ?? 0)}`;
  return String(v ?? "");
}

function isLevelUpNewStatsArea(container) {
  return !!container?.closest?.(
    ".level-up-section, .umbra-submenu.new.entity-stats-section"
  );
}

function renderStatPair(entite, key, rootEl) {
  const { perm, prev } = ensureStatNodes(entite.id, key, rootEl);

  const permStats = getPermStats(entite);
  const prevStats = getPreviewStats(entite);

  const statContainer = containerOf(perm);
  syncStatCurseMarker(statContainer, entite, key);
  const usesSyncedCalculator = Boolean(
    statContainer?.dataset?.calculatorName ||
    statContainer?.dataset?.valueTemplate
  );

  let permVal = getStatSnapshotValue(permStats, key, undefined);
  let prevVal = getStatSnapshotValue(prevStats, key, undefined);
  let permHtml = null;
  let prevHtml = null;

  if (usesSyncedCalculator) {
    const permEntity = buildStatsSnapshotEntity(entite, permStats, entite.id);
    const prevEntity = buildStatsSnapshotEntity(entite, prevStats, entite.id);
    const resolvedPerm = resolveStatContainerValue(statContainer, permEntity, key, permVal);
    const resolvedPrev = resolveStatContainerValue(statContainer, prevEntity, key, prevVal);

    permVal = resolvedPerm.value;
    prevVal = resolvedPrev.value;
    permHtml = resolvedPerm.html;
    prevHtml = resolvedPrev.html;
  }

  const isObj = (v) => v && typeof v === "object" && ("current" in v || "max" in v);

  const toMs = (v) => {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    // tolère "2426 ms", "2.4 s", etc.
    return parseFloat(String(v).replace(",", ".")) || 0;
  };

  const isZero = (v) => {
    if (isObj(v)) return Number(v.current ?? 0) <= 0 && Number(v.max ?? 0) <= 0;
    return v == null || Number(v) <= 0;
  };

  const hasPreview =
    !!entite?.modifierStats?.preview?.statLeveled &&
    Object.keys(entite.modifierStats.preview.statLeveled).length > 0;

  // ✅ SPEED: comparaison sur la valeur BRUTE (ms), pas sur le texte formaté
  const permMs = key === "speed" ? toMs(permVal) : null;
  const prevMs = key === "speed" ? toMs(prevVal) : null;
const SPEED_DISPLAY_STEP_MS = 10; // 0.01 s = 10 ms (car toFixed(2))
const speedHasDelta =
  key === "speed" &&
  hasPreview &&
  Math.round(permMs / SPEED_DISPLAY_STEP_MS) !== Math.round(prevMs / SPEED_DISPLAY_STEP_MS);
  // ✅ affichage "MAX only" pour HP + armor (+ speed en secondes)
  const fmtKey = (v) => {
   if ((key === "HP" || key === "armor" || key === "extraLife") && isObj(v)) {
      return String(Number(v.max ?? 0));
    }
if (key === "speed") {
  const ms = toMs(v);
  return `${(ms / 1000).toFixed(2)} s`; // ✅ visuel uniquement
}
    return fmt(v);
  };

  const showPrev = hasPreview && (
    usesSyncedCalculator
      ? getStatComparableValue(prevVal, 0) !== getStatComparableValue(permVal, 0)
      : key === "speed"
        ? speedHasDelta
        : fmtKey(prevVal) !== fmtKey(permVal)
  );

  const isNew =
    showPrev &&
    statContainer?.dataset?.statLineCreatedAsNew === "preview" &&
    !isZero(prevVal);
  const setPreviewDeltaState = (container, up, down) => {
    if (!container) return;

    if (up || down) {
      container.dataset.previewDelta = up ? "up" : "down";
      container.classList.remove("zero");
      container.removeAttribute("upgraded");
      container.classList.toggle("upgraded", up);
      container.classList.toggle("reducted", down);
      return;
    }

    container.classList.remove("upgraded", "reducted");
    container.removeAttribute("upgraded");
    delete container.dataset.previewDelta;
  };

  const comparableValue = (v) => {
    return getStatComparableValue(v, 0);
  };

  if (statContainer && isLevelUpNewStatsArea(statContainer)) {
    statContainer.classList.toggle("new", isNew);
  }

  // ✅ ARMOR: suppression si 0/0 sans preview
if (key === "armor" || key === "extraLife" || key === "charge") {
  const container =
    containerOf(perm) ||
    document.querySelector(`.stat-container[data-stat="${key}"][data-entity-id="${entite.id}"]`);

  if (!showPrev && isZero(permVal) && !getStatMalusSources(entite, key).length) {
    if (container) container.remove();
    return;
  }
}

  // ✅ upgraded/reducted sur container pour HP/armor
if (key === "HP" || key === "armor" || key === "extraLife" || key === "charge") {
  const container = containerOf(perm);
  if (container) {
    const permMax = isObj(permVal) ? Number(permVal.max ?? 0) : Number(permVal ?? 0);
    const prevMax = isObj(prevVal) ? Number(prevVal.max ?? 0) : Number(prevVal ?? 0);

    const up = showPrev && prevMax > permMax;
    const down = showPrev && prevMax < permMax;

    setPreviewDeltaState(container, up, down);
  }
}


  // SPEED : la classe reflète la variation numérique brute.
  if (key === "speed") {
    const container = containerOf(perm);
    if (container) {
      const p = permMs;
      const n = prevMs;

      const up   = showPrev && n > p;
      const down = showPrev && n < p;

      setPreviewDeltaState(container, up, down);
    }
  }
  if (key === "dayHpRegen") {
    const container = containerOf(perm);
    if (container) {
      const p = Number(permVal ?? 0) || 0;
      const n = Number(prevVal ?? 0) || 0;

      const up   = showPrev && n > p;
      const down = showPrev && n < p;

      setPreviewDeltaState(container, up, down);
    }
  }

  if (!["HP", "armor", "extraLife", "charge", "speed", "dayHpRegen"].includes(key)) {
    const p = comparableValue(permVal);
    const n = comparableValue(prevVal);

    setPreviewDeltaState(
      statContainer,
      showPrev && n > p,
      showPrev && n < p
    );
  }

  // Helpers resolve the active draft on hover. Do not build every closed tooltip
  // for each point spent, or retain text from a previous preview.
  if (statContainer) delete statContainer.dataset.helperText;

  // 1) Permanent
  if (isNew) {
    perm.classList.add("stat-new", "new-stat");
    perm.textContent = "";
  } else {
    perm.classList.remove("stat-new", "new-stat");
    if (permHtml != null) {
      if (perm.innerHTML !== permHtml) perm.innerHTML = permHtml;
    } else {
      const permTxt = fmtKey(permVal);
      if (perm.textContent !== permTxt) perm.textContent = permTxt;
    }
  }

  // 2) Preview
  if (showPrev) {
    if (prevHtml != null) {
      if (prev.innerHTML !== prevHtml) prev.innerHTML = prevHtml;
    } else {
      const prevTxt = fmtKey(prevVal);
      if (prev.textContent !== prevTxt) prev.textContent = prevTxt;
    }
    prev.classList.remove("is-hidden");
  } else {
    prev.classList.add("is-hidden");
  }
  if (key === 'shift') {
    if (!isNew && isObj(permVal)) renderMovementCounter(perm, buildStatsSnapshotEntity(entite, permStats, entite.id));
    if (showPrev && isObj(prevVal)) renderMovementCounter(prev, buildStatsSnapshotEntity(entite, prevStats, entite.id));
  }
}

function isObjStat(v) {
  return v && typeof v === "object" && ("current" in v || "max" in v);
}

function normObj(v) {
  if (typeof v === "number") return { current: v, max: v };
  return { current: Number(v?.current ?? 0), max: Number(v?.max ?? 0) };
}

function addObj(a, b) {
  const A = normObj(a);
  const B = normObj(b);
  return { current: A.current + B.current, max: A.max + B.max };
}

function getConfirmedStatValue(entite, key, fallback = 0) {
  const value = entite?.stats?.[key] ?? entite?.baseStats?.[key] ?? fallback;
  if (value && typeof value === "object") {
    return Number(value.max ?? value.current ?? fallback) || 0;
  }

  return Number(value ?? fallback) || 0;
}

function getLevelUpAttributes(entite, includePreview = false) {
  const source = includePreview ? entite : {
    ...entite,
    modifierStats: { ...entite.modifierStats, preview: null },
  };
  return Object.fromEntries(['strength', 'agility', 'intelligence']
    .map(key => [key, Number(getSafe(source, key, 0)) || 0]));
}

function applyCurrentPoolDelta(entite, key, delta) {
  const currentDelta = Number(delta?.current ?? 0) || 0;
  if (!currentDelta || !entite?.stats?.[key] || typeof entite.stats[key] !== "object") {
    return;
  }

  const pool = entite.stats[key];
  const max = Number(pool.max ?? 0) || 0;
  pool.current = Math.max(
    0,
    Math.min(max, (Number(pool.current ?? 0) || 0) + currentDelta)
  );
}

function applyConfirmedGeneratedPoolDeltas(entite, generated = {}) {
  grantEntityRobustnessArmor(entite, generated.armor?.current);
  applyCurrentPoolDelta(entite, "extraLife", generated.extraLife);
}
function getMaxHPValue(entite) {
  const hp = entite?.stats?.HP ?? entite?.baseStats?.HP;
  if (hp && typeof hp === "object") return Number(hp.max ?? 0) || 0;
  return Number(hp ?? 0) || 0;
}

function syncPreviewHPFromVitality(entite) {
  const preview = entite?.modifierStats?.preview;
  if (!preview?.statLeveled) return;
  if (!entite?.stats?.HP || typeof entite.stats.HP !== "object") return;

  const generated = ensurePreviewGenerated(entite);
  delete preview.statLeveled.HP;

  const baseVit = getConfirmedStatValue(entite, "vitality", 0);       // baseline (sans preview)
  const dv = Number(preview.statLeveled.vitality ?? 0);               // delta preview
  const deltaHP = calculateVitalityBonus(baseVit + dv) - calculateVitalityBonus(baseVit);

  if (!dv || deltaHP === 0) {
    delete generated.HP;
    delete preview.meta?.derived?.hpFromVitality;
    return;
  }

  generated.HP = { current: deltaHP, max: deltaHP };
  preview.meta ??= {};
  preview.meta.derived ??= {};
  preview.meta.derived.hpFromVitality = true;
}
function syncPreviewArmorFromRobustness(entite) {
  const preview = entite?.modifierStats?.preview;
  if (!preview?.statLeveled) return;

  const generated = ensurePreviewGenerated(entite);
  delete preview.statLeveled.armor;

  // base = stats durables déjà calculées (comme pour HP)
  const baseRob = getConfirmedStatValue(entite, "robustness", 0);
  const dr = Number(preview.statLeveled.robustness ?? 0);
  const baseStrength = getConfirmedStatValue(entite, "strength", 0);
  const ds = Number(preview.statLeveled.strength ?? 0);

  const deltaArmor =
    calculateRobustnessBonus(baseRob + dr, baseStrength + ds) - calculateRobustnessBonus(baseRob, baseStrength);

  if (deltaArmor === 0) {
    delete generated.armor;
    delete preview.meta?.derived?.armorFromRobustness;
    return;
  }

  generated.armor = { current: deltaArmor, max: deltaArmor };
  preview.meta ??= {};
  preview.meta.derived ??= {};
  preview.meta.derived.armorFromRobustness = true;
}
function syncPreviewSpeedFromVelocity(entite) {
  const preview = entite?.modifierStats?.preview;
  if (!preview?.statLeveled) return;

  const generated = ensurePreviewGenerated(entite);
  delete preview.statLeveled.speed;

  const dv = Number(preview.statLeveled.velocity ?? 0) || 0;

  preview.meta ??= {};
  preview.meta.derived ??= {};

  if (!dv) {
    delete generated.speed;
    delete preview.meta.derived.speedFromVelocity;
    return;
  }

  // baseSpeed = vitesse "de référence" avant réduction vel
  const baseSpeed = Number(entite?.baseStats?.speed ?? 1000) || 0;

  // vel permanente (déjà durable), sans preview
  const baseVel = getConfirmedStatValue(entite, "velocity", 0);

  // oldAdjusted = la speed actuelle (déjà réduite) => fiable et évite les dérives
  const oldAdjusted = getConfirmedStatValue(entite, "speed", baseSpeed) || baseSpeed;

  const newAdjusted =
    (baseSpeed > 0 && (baseVel + dv) > 0)
      ? calculateVelocityReduction(baseVel + dv, baseSpeed).adjustedSpeed
      : baseSpeed;

  const delta = newAdjusted - oldAdjusted; // négatif = mieux

  if (!delta) {
    delete generated.speed;
    delete preview.meta.derived.speedFromVelocity;
    return;
  }

  generated.speed = delta;                         // float ms OK
  preview.meta.derived.speedFromVelocity = true;   // marqueur dérivé
}
export const EXTRA_LIFE_GIVEN_EVERY_MAX = 10;
function countGrantedExtraLifeCurrentFromMax(maxExtraLife, everyMax = EXTRA_LIFE_GIVEN_EVERY_MAX) {
  const m = Math.floor(Number(maxExtraLife ?? 0));
  if (m <= 0) return 0;

  const n = Math.max(1, Math.floor(Number(everyMax ?? 10)));
  // 1er current au 1er max, puis 1 current à chaque palier de n max
  return 1 + Math.floor(m / n);
}
export function giveCurrentExtraLife(beforeMax, afterMax, everyMax = EXTRA_LIFE_GIVEN_EVERY_MAX) {
  const before = countGrantedExtraLifeCurrentFromMax(beforeMax, everyMax);
  const after  = countGrantedExtraLifeCurrentFromMax(afterMax, everyMax);
  return after - before;
}

function syncPreviewExtraLifeFromTranscendence(entite) {
  const preview = entite?.modifierStats?.preview;
  if (!preview?.statLeveled) return;

  const generated = ensurePreviewGenerated(entite);
  delete preview.statLeveled.extraLife;

  const baseTr = Number(entite.stats?.transcendence ?? 0);
  const dtr    = Number(preview.statLeveled.transcendence ?? 0);

  const beforeMax = calculateTranscendenceExtraLife(baseTr);
  const afterMax  = calculateTranscendenceExtraLife(baseTr + dtr);

  const deltaMax = afterMax - beforeMax;

  // ✅ DELTA current selon paliers (1er point => +1 current, puis tous les N max)
  const deltaCurrent = giveCurrentExtraLife(beforeMax, afterMax, EXTRA_LIFE_GIVEN_EVERY_MAX);

  // Rien à faire → on nettoie
  if (!dtr || (deltaMax === 0 && deltaCurrent === 0)) {
    delete generated.extraLife;
    delete preview.meta?.derived?.extraLifeFromTranscendence;
    return;
  }

  generated.extraLife = {
    current: deltaCurrent,
    max: deltaMax
  };
  preview.meta ??= {};
  preview.meta.derived ??= {};
  preview.meta.derived.extraLifeFromTranscendence = true;
}

function syncPreviewGeneratedDeltaFromTotals(entite, total, key, delta, metaKey) {
  const preview = entite?.modifierStats?.preview;
  if (!preview || !total) return;

  if (isZeroPreviewDelta(delta)) {
    if (!ensurePreviewGenerated(entite)[key]) {
      clearPreviewGeneratedStat(entite, key);
    }
    if (metaKey) delete preview.meta?.derived?.[metaKey];
    return;
  }

  addPreviewGeneratedStat(entite, key, delta);
  applyPreviewDelta(total, key, delta);

  if (metaKey) {
    preview.meta ??= {};
    preview.meta.derived ??= {};
    preview.meta.derived[metaKey] = true;
  }
}

function syncPreviewCoreDerivedFromTotals(entite, total) {
  const preview = entite?.modifierStats?.preview;
  if (!preview?.statLeveled || !total) return;

  delete preview.statLeveled.HP;
  delete preview.statLeveled.armor;
  delete preview.statLeveled.speed;
  delete preview.statLeveled.extraLife;

  const baseVit = getConfirmedStatValue(entite, "vitality", 0);
  const nextVit = Math.max(0, Number(total.vitality ?? baseVit) || 0);
  const deltaHP = calculateVitalityBonus(nextVit) - calculateVitalityBonus(baseVit);

  syncPreviewGeneratedDeltaFromTotals(
    entite,
    total,
    "HP",
    deltaHP
      ? {
          current: deltaHP > 0 ? deltaHP : 0,
          max: deltaHP,
        }
      : 0,
    "hpFromVitality"
  );

  const baseRob = getConfirmedStatValue(entite, "robustness", 0);
  const nextRob = Math.max(0, Number(total.robustness ?? baseRob) || 0);
  const baseStrength = getConfirmedStatValue(entite, "strength", 0);
  const nextStrength = Math.max(0, Number(total.strength ?? baseStrength) || 0);
  const deltaArmor = calculateRobustnessBonus(nextRob, nextStrength) - calculateRobustnessBonus(baseRob, baseStrength);

  syncPreviewGeneratedDeltaFromTotals(
    entite,
    total,
    "armor",
    deltaArmor
      ? {
          current: deltaArmor > 0 ? deltaArmor : 0,
          max: deltaArmor,
        }
      : 0,
    "armorFromRobustness"
  );

  const baseTr = Math.max(0, getConfirmedStatValue(entite, "transcendence", 0));
  const nextTr = Math.max(0, Number(total.transcendence ?? baseTr) || 0);
  const beforeExtraMax = calculateTranscendenceExtraLife(baseTr);
  const afterExtraMax = calculateTranscendenceExtraLife(nextTr);
  const deltaExtraMax = afterExtraMax - beforeExtraMax;
  const deltaExtraCurrent = giveCurrentExtraLife(
    beforeExtraMax,
    afterExtraMax,
    EXTRA_LIFE_GIVEN_EVERY_MAX
  );

  syncPreviewGeneratedDeltaFromTotals(
    entite,
    total,
    "extraLife",
    (deltaExtraMax || deltaExtraCurrent)
      ? {
          current: deltaExtraCurrent,
          max: deltaExtraMax,
        }
      : 0,
    "extraLifeFromTranscendence"
  );

  const baseSpeed = Number(entite?.baseStats?.speed ?? 1000) || 0;
  const oldAdjusted = getConfirmedStatValue(entite, "speed", baseSpeed) || baseSpeed;
  const nextVel = Math.max(0, Number(total.velocity ?? 0) || 0);
  const newAdjusted =
    baseSpeed > 0 && nextVel > 0
      ? calculateVelocityReduction(nextVel, baseSpeed).adjustedSpeed
      : baseSpeed;
  const speedDelta = newAdjusted - oldAdjusted;

  syncPreviewGeneratedDeltaFromTotals(
    entite,
    total,
    "speed",
    speedDelta,
    "speedFromVelocity"
  );
}

function applyPreviewWeaponOrfevreStuffDelta(entite, total) {
  const preview = entite?.modifierStats?.preview;
  if (!preview || !total) return;

  const previewActivePercent = getWeaponOrfevrePreviewActivePercent(entite);
  const stuffDelta = getWeaponOrfevreStuffPreviewDelta(entite, previewActivePercent);
  const entries = Object.entries(stuffDelta);

  if (!entries.length) {
    delete preview.meta?.derived?.stuffWeaponOrfevre;
    return;
  }

  for (const [key, delta] of entries) {
    applyPreviewDelta(total, key, delta);
    addPreviewGeneratedStat(entite, key, delta);
  }

  preview.meta ??= {};
  preview.meta.derived ??= {};
  preview.meta.derived.stuffWeaponOrfevre = {
    activePercent: previewActivePercent,
    delta: stuffDelta,
  };
}

function getPreviewNumber(stats, key) {
  return Math.max(0, Number(stats?.[key] ?? 0) || 0);
}

function calculateGeneratedChargeFromStats(stats) {
  const weaponMastery = getPreviewNumber(stats, "weaponMastery");
  if (weaponMastery <= 0) return 0;

  return (
    Number(calculateWeaponMasteryCharge(null, weaponMastery) || 0) +
    Number(weaponMasteryChargeStrenghtRatioBonus(null, getPreviewNumber(stats, "strength")) || 0)
  );
}

function calculateGeneratedWeaponOrfevreFromStats(stats) {
  const weaponMastery = getPreviewNumber(stats, "weaponMastery");
  if (weaponMastery <= 0) return 0;

  return (
    Number(calculateWeaponOrfevreWeaponMastery(null, weaponMastery) || 0) +
    Number(calculateWeaponOrfevreStrength(null, getPreviewNumber(stats, "strength")) || 0)
  );
}

function calculateGeneratedWeaponCollectorFromStats(stats) {
  const weaponMastery = getPreviewNumber(stats, "weaponMastery");
  if (weaponMastery <= 0) return 0;

  return (
    Number(calculateWeaponMasteryTrophyChance(null, weaponMastery) || 0) +
    Number(calculateWeaponMasteryTrophyStrengthBonus(null, getPreviewNumber(stats, "strength")) || 0)
  );
}

function calculateGeneratedMarathonFromStats(stats) {
  return Number(calculateMovementMarathonChance({ stats }) || 0);
}

function calculateGeneratedTrailerFromStats(stats) {
  return Number(calculateMovementTrailerChance({ stats }) || 0);
}

function calculateGeneratedBloodThirstyFromStats(stats) {
  return Number(calculateBloodThirstyFromBloodFury(stats) || 0);
}

function calculateGeneratedWeightFromStats(stats, entite) {
  return Number(calculateGeneratedWeight({ ...entite, stats }) || 0);
}

function calculateGeneratedUmbraTargetFromStats(stats, targetKey) {
  const generated = calculateGeneratedUmbraStats({ stats });
  return Number(generated?.[targetKey] || 0);
}

function sanitizeChargePreviewDelta(entite) {
  const previewStats = entite?.modifierStats?.preview?.statLeveled;
  if (!previewStats) return;

  normalizeStatModifierMapInPlace(previewStats);

  const chargeDelta = previewStats.charge;
  if (typeof chargeDelta === "number" && chargeDelta < 0) {
    delete previewStats.charge;
  }
}

function applyGeneratedStat(entite, total, key, calculator) {
  const currentStats = entite?.stats || {};
  const currentGenerated = Number(calculator(currentStats, entite) || 0);
  const nextGenerated = Number(calculator(total, entite) || 0);
  const currentFinal = Number(currentStats?.[key] ?? 0) || 0;
  const previewBeforeGeneratedDelta = Number(total?.[key] ?? currentFinal) || 0;
  const generatedDelta = nextGenerated - currentGenerated;
  const nextFinal = Math.max(0, previewBeforeGeneratedDelta + generatedDelta);

  if (nextFinal || currentFinal || previewBeforeGeneratedDelta) {
    total[key] = nextFinal;
  } else {
    delete total[key];
  }

  addPreviewGeneratedStat(entite, key, generatedDelta);
  return generatedDelta;
}

function syncPreviewShiftFromMovement(entite, total) {
  const oldMovement = Math.max(0, Math.round(Number(entite?.stats?.movement ?? 0) || 0));
  const newMovement = Math.max(0, Math.round(Number(total?.movement ?? 0) || 0));

  if (oldMovement === newMovement) return;

  const previewShift = total?.shift;
  const oldShift = entite?.stats?.shift;
  const shiftSource =
    previewShift && typeof previewShift === "object"
      ? previewShift
      : oldShift;
  const hasShift = shiftSource && typeof shiftSource === "object";
  const oldCurrent = hasShift
    ? Math.max(0, Math.round(Number(shiftSource.current) || 0))
    : 0;
  const oldMax = hasShift
    ? Math.max(0, Math.round(Number(shiftSource.max) || 0))
    : oldMovement;

  if (newMovement > 0) {
    const deltaMax = newMovement - oldMovement;
    const max = Math.max(0, oldMax + deltaMax);
    const current = Math.max(
      0,
      Math.min(oldCurrent + Math.max(0, deltaMax), max)
    );

    total.shift = { current, max };
    return;
  }

  total.shift = { current: 0, max: 1, baseDefault: true };
}

function applyGeneratedPreviewStats(entite, total) {
  const preview = entite?.modifierStats?.preview;
  if (!preview || !total) return;

  preview.meta ??= {};
  preview.meta.derived ??= {};

  const chargeDelta = applyGeneratedStat(
    entite,
    total,
    "charge",
    calculateGeneratedChargeFromStats
  );

  if (chargeDelta) {
    preview.meta.derived.chargeFromWeaponMastery = true;
    preview.meta.derived.chargeDelta = chargeDelta;
  } else {
    delete preview.meta.derived.chargeFromWeaponMastery;
    delete preview.meta.derived.chargeDelta;
  }

  applyGeneratedStat(
    entite,
    total,
    "weaponOrfevre",
    calculateGeneratedWeaponOrfevreFromStats
  );

  applyGeneratedStat(
    entite,
    total,
    "weaponCollector",
    calculateGeneratedWeaponCollectorFromStats
  );

  applyGeneratedStat(
    entite,
    total,
    "marathon",
    calculateGeneratedMarathonFromStats
  );

  applyGeneratedStat(
    entite,
    total,
    "trailer",
    calculateGeneratedTrailerFromStats
  );

  GENERATED_UMBRA_TARGET_KEYS.forEach((targetKey) => {
    if (targetKey === 'armor') return; // Handled by the existing current/max pool preview.
    applyGeneratedStat(
      entite,
      total,
      targetKey,
      (stats) => calculateGeneratedUmbraTargetFromStats(stats, targetKey)
    );
  });

  applyGeneratedStat(
    entite,
    total,
    "weight",
    calculateGeneratedWeightFromStats
  );

  applyGeneratedStat(
    entite,
    total,
    "bloodThirsty",
    calculateGeneratedBloodThirstyFromStats
  );

  syncPreviewShiftFromMovement(entite, total);
}

function renderAllStats(entite, rootEl) {
  const perm = getPermStats(entite);
  for (const key of Object.keys(perm)) {
    renderStatPair(entite, key, rootEl);
  }
}

function findEntityStatContainer(entityId, stat, root = document) {
  if (!entityId || !root?.querySelectorAll) return null;

  const statKey = normalizeStatKey(stat);
  const escapedEntityId = cssEscapeValue(entityId);

  return Array.from(
    root.querySelectorAll(`.stat-container[data-entity-id="${escapedEntityId}"][data-stat]`)
  ).find(block => normalizeStatKey(block?.dataset?.stat) === statKey) || null;
}

function getPreviewNewStatsParent(entite, root = document) {
  if (!entite?.id) return null;
  const escapedEntityId = cssEscapeValue(entite.id);
  const scoped =
    root?.querySelector?.(`#codex-entity_${escapedEntityId} .umbra-submenu.new.entity-stats-section`) ||
    root?.closest?.(".umbra-submenu.new.entity-stats-section");
  if (scoped) return scoped;

  return (
    document.querySelector(`#codex-entity_${escapedEntityId} .umbra-submenu.new.entity-stats-section`) ||
    document.querySelector(".umbra-submenu.new.entity-stats-section")
  );
}

function configureSyncedStatContainer(block, stat, config) {
  if (!block || !config) return;

  const statKey = normalizeStatKey(stat);
  const displayStatKey = getStatsPanelDynamicDisplayStat(statKey, config);

  block.dataset.stat = displayStatKey;
  block.dataset.sourceStat = getStatsPanelDynamicSourceStat(statKey, config);
  if (config.originStat) block.dataset.originStat = normalizeStatKey(config.originStat);
  if (config.calculatorName) block.dataset.calculatorName = config.calculatorName;
  if (config.valueTemplate) block.dataset.valueTemplate = config.valueTemplate;

  block
    .querySelectorAll(".entite-stat")
    .forEach(el => {
      el.dataset.stat = displayStatKey;
      el.dataset.hover = "true";
    });
}

function createPreviewStatBlock(parent, entite, stat, value, {
  forceNew = false,
  syncedConfig = null,
} = {}) {
  if (!parent || !entite?.id) return null;

  const statKey = normalizeStatKey(stat);
  const displayStatKey = syncedConfig
    ? getStatsPanelDynamicDisplayStat(statKey, syncedConfig)
    : getDisplayStatKey(statKey);
  const def = findStatsDefinition(displayStatKey);
  if (!def && !syncedConfig) return null;

  const existing = findEntityStatContainer(entite.id, displayStatKey, parent);
  if (existing) {
    configureSyncedStatContainer(existing, statKey, syncedConfig);
    renderStatPair(entite, displayStatKey, parent);
    return existing;
  }

  createUmbraBlock(
    parent,
    def?.name || syncedConfig?.label || displayStatKey,
    () => value,
    entite,
    displayStatKey,
    false,
    null,
    def?.nature === "umbra",
    { showMissingAsNew: true, forceNew, newLineContext: "preview" }
  );

  const block = findEntityStatContainer(entite.id, displayStatKey, parent);
  if (block && forceNew) block.dataset.statLineCreatedAsNew = "preview";
  configureSyncedStatContainer(block, statKey, syncedConfig);
  renderStatPair(entite, displayStatKey, parent);
  return block;
}

function syncPreviewIntroducedRows(entite, total, root = document) {
  if (!entite?.id || !total) return;

  const parent = getPreviewNewStatsParent(entite, root);
  if (!parent) return;

  const beforeEntity = buildStatsSnapshotEntity(entite, entite.stats || {}, entite.id);
  const afterEntity = buildStatsSnapshotEntity(entite, total, entite.id);

  parent
    .querySelectorAll(`.stat-container[data-entity-id="${cssEscapeValue(entite.id)}"][data-stat]`)
    .forEach((block) => {
      const statKey = normalizeStatKey(block.dataset.stat);
      const config = getStatsPanelDynamicConfig(statKey);
      const beforeValue = config
        ? getStatsPanelDynamicValue(statKey, config, beforeEntity, getStatSnapshotValue(entite.stats, statKey, 0))
        : getStatSnapshotValue(entite.stats, statKey, 0);
      const nextValue = config
        ? getStatsPanelDynamicValue(statKey, config, afterEntity, getStatSnapshotValue(total, statKey, 0))
        : getStatSnapshotValue(total, statKey, 0);
      const beforeComparable = getStatComparableValue(beforeValue, 0);
      const nextComparable = getStatComparableValue(nextValue, 0);

      // Bind the actual draft, not a snapshot mistaken for an external update.
      // The helper resolver already reads its preview totals.
      syncStatCurseMarker(block, entite, statKey);
      if (beforeComparable <= 0 && nextComparable <= 0
        && !ZERO_VALUE_VISIBLE_STAT_KEYS.has(statKey) && block.dataset.statCursed !== 'true') {
        block.remove();
      }
    });

  for (const [key, value] of Object.entries(total)) {
    const statKey = normalizeStatKey(key);
    if (
      !statKey ||
      ["strength", "agility", "intelligence"].includes(statKey) ||
      DOM_NON_STAT_KEYS.has(statKey)
    ) continue;
    const def = findStatsDefinition(statKey);
    if (!def) continue;

    const beforeValue = getStatSnapshotValue(entite.stats, statKey, 0);
    const beforeComparable = getStatComparableValue(beforeValue, 0);
    const nextComparable = getStatComparableValue(value, 0);
    const existing = findEntityStatContainer(entite.id, statKey, parent);

    if (getStatMalusSources(afterEntity, statKey).length || (nextComparable > 0 && (beforeComparable <= 0 || existing))) {
      createPreviewStatBlock(parent, entite, statKey, beforeValue, {
        forceNew: beforeComparable <= 0 && nextComparable > 0,
      });
    } else if (existing && beforeComparable <= 0 && nextComparable <= 0) {
      existing.remove();
    }
  }

  for (const [statKey, config] of Object.entries(STATS_PANEL_DYNAMIC_ROWS)) {
    const displayStatKey = getStatsPanelDynamicDisplayStat(statKey, config);
    const beforeFallback = getStatSnapshotValue(entite.stats, statKey, 0);
    const nextFallback = getStatSnapshotValue(total, statKey, 0);
    const beforeValue = getStatsPanelDynamicValue(statKey, config, beforeEntity, beforeFallback);
    const nextValue = getStatsPanelDynamicValue(statKey, config, afterEntity, nextFallback);
    const beforeComparable = getStatComparableValue(beforeValue, 0);
    const nextComparable = getStatComparableValue(nextValue, 0);
    const existing = findEntityStatContainer(entite.id, displayStatKey, parent);

    if (getStatMalusSources(afterEntity, statKey).length || (nextComparable > 0 && (beforeComparable <= 0 || existing))) {
      createPreviewStatBlock(parent, entite, statKey, beforeValue, {
        forceNew: beforeComparable <= 0 && nextComparable > 0,
        syncedConfig: config,
      });
    } else if (existing && beforeComparable <= 0 && nextComparable <= 0) {
      existing.remove();
    }
  }
}

function createArchetypeIcon(entite, archetypeKey, archetypeLevel, archetypeUid) {
  if (!entite || !entite.id || !archetypeUid) return;

  const keyNorm = String(archetypeKey || "").trim().toLowerCase();

  // 🚫 RÈGLE ABSOLUE : aucun icon pour Égaré
  if (!keyNorm || keyNorm === "egare") {
    return;
  }

  const container = document.querySelector(`#archetype-icons-${entite.id}`);
  if (!container) return;

  // ⛔ ANTI-DOUBLON PAR UID
  const exists = container.querySelector(`[data-archetype-uid="${archetypeUid}"]`);
  if (exists) return;

  const icon = document.createElement("div");
  icon.classList.add("archetype-icon");

  icon.dataset.entite = entite.id;
  icon.dataset.archetypeLevel = archetypeLevel;
  icon.dataset.archetypeUid = archetypeUid;
  icon.dataset.archetypeKey = keyNorm;  // ✅ ici, jamais "egare"

  container.appendChild(icon);
}

function computeDayHpRegenFromTotals(entite, total, deltas) {
  // vitality et HP.max = VALEURS PREVIEW (donc total)
  const vitality = toNumber(total?.vitality ?? 0, 0);

  const hp = total?.HP;
  const maxHP =
    (hp && typeof hp === "object")
      ? toNumber(hp.max ?? 0, 0)
      : toNumber(hp ?? 0, 0);

  // Base regen "hors bonus vitality" (ta fonction existante)
  // IMPORTANT : si tu autorises une montée DIRECTE de dayHpRegen,
  // elle doit impacter la base, donc on ajoute deltas.dayHpRegen.
  const baseRegen = BaseDayHpRegen(entite) + toNumber(deltas?.dayHpRegen ?? 0, 0);

  const regenPercent = calculateVitalityRegenPercent(vitality);
  const bonus = calculateVitalityRegenAmount(maxHP, regenPercent);

  return calculateTotalRegenAmount(baseRegen, bonus);
}

function computeHpBattleRegenFromTotals(entite, total, deltas) {
  const nativeHpBattleRegen = Math.max(0, getConfirmedStatValue(entite, "hpBattleRegen", 0));
  const permanentIndestructibility = Math.max(0, getConfirmedStatValue(entite, "indestructibility", 0));
  const previewIndestructibility = Math.max(0, Number(total?.indestructibility) || 0);
  const permanentStrength = Math.max(0, getConfirmedStatValue(entite, "strength", 0));
  const previewStrength = Math.max(0, Number(total?.strength) || 0);

  /*
   * On retire d'abord la génération permanente déjà incluse
   * dans entite.stats.hpBattleRegen.
   */
  const permanentGenerated = permanentIndestructibility > 0 ? Math.max(0, Number(calculateHpBattleRegenStrengthRatio({ ...entite, stats: { ...entite.stats, strength: permanentStrength, indestructibility: permanentIndestructibility } })) || 0) + Math.max(0, Number(calculateHpBattleRegenIndestructibilityRatio({ ...entite, stats: { ...entite.stats, strength: permanentStrength, indestructibility: permanentIndestructibility } })) || 0) : 0;
  const nativeOnly = Math.max(0, nativeHpBattleRegen - permanentGenerated);
  const previewEntity = { ...entite, stats: { ...total, strength: previewStrength, indestructibility: previewIndestructibility } };
  const previewGenerated = previewIndestructibility > 0 ? Math.max(0, Number(calculateHpBattleRegenStrengthRatio(previewEntity)) || 0) + Math.max(0, Number(calculateHpBattleRegenIndestructibilityRatio(previewEntity)) || 0) : 0;

  const directHpBattleRegenDelta = Math.max(
  0,
  Number(deltas?.hpBattleRegen) || 0
);

return Math.max(
  0,
  nativeOnly +
  directHpBattleRegenDelta +
  previewGenerated
);
}
export function ComputeStatPreview(entite) {
  if (!entite?.stats) return;

  entite.modifierStats ??= {};
  entite.modifierStats.preview ??= {
    statLeveled: {}
  };

  entite.modifierStats.preview.statLeveled ??= {};
  normalizeStatModifierMapInPlace(entite.modifierStats.preview.statLeveled);
  const sourceDeltas = Object.fromEntries(Object.entries(entite.modifierStats.preview.statLeveled)
    .filter(([key]) => STAT_SYSTEM_ORIGINS[key]));
  if (entite.modifierStats.preview.generated) {
    normalizeStatModifierMapInPlace(entite.modifierStats.preview.generated);
  }

  clearPreviewGeneratedStats(entite);
  removeGeneratedStatsFromPreviewLeveled(entite);
  sanitizeChargePreviewDelta(entite);

  const base = entite.stats;
  const deltas =
    entite.modifierStats.preview.statLeveled || {};

  const total = {};

  // 2) Copie des stats permanentes.
  for (const [k, v] of Object.entries(base)) {
    total[k] = isObjStat(v)
      ? normObj(v)
      : v;
  }

  // 3) Application des deltas de level-up.
  applyPreviewDeltaSet(total, deltas, { skip: PREVIEW_GENERATED_ONLY_KEYS });

  // 4) Écart de stuff boosté si Orfèvre change dans l'aperçu.
  applyPreviewWeaponOrfevreStuffDelta(entite, total);
  const directingInputs = getStatSystemInputs(entite);
  for (const key of getPointLimitedStatKeys()) if (Object.hasOwn(directingInputs, key)) total[key] = directingInputs[key];

  // 5) Dérivés classiques recalculés depuis les totaux déjà prévisualisés.
  syncPreviewCoreDerivedFromTotals(entite, total);

  // 6) Régénération journalière avec les valeurs preview.
  const dayHpRegenBeforeGenerated = Number(total.dayHpRegen ?? 0) || 0;
  total.dayHpRegen =
    computeDayHpRegenFromTotals(
      entite,
      total,
      deltas
    );
  const dayHpRegenGeneratedDelta =
    (Number(total.dayHpRegen ?? 0) || 0) -
    dayHpRegenBeforeGenerated;

  addPreviewGeneratedStat(entite, "dayHpRegen", dayHpRegenGeneratedDelta);

  // 7) Régénération de combat avec strength et indestructibility preview.
  const previewHpBattleRegen =
    computeHpBattleRegenFromTotals(
      entite,
      total,
      deltas
    );

  if (previewHpBattleRegen > 0) {
    total.hpBattleRegen =
      previewHpBattleRegen;
  } else {
    delete total.hpBattleRegen;
  }

  // 8) Dérivés complets identiques au recalcul final, mais seulement dans l'aperçu.
  applyGeneratedPreviewStats(entite, total);
  Object.assign(entite.modifierStats.preview.statLeveled, sourceDeltas);
  applyStatSystemTotals(entite, total, getStatSystemInputs(entite));

  if (total.shift) {
    total.shift.current = Number(base.shift?.current || 0)
      - getEquipmentResourceCurrent(entite, 'shift')
      + getEquipmentResourceCurrent(entite, 'shift', getWeaponOrfevrePreviewActivePercent(entite));
  }

  if (total.HP && typeof total.HP === 'object') {
    total.HP.max = Math.max(1, Math.round(Number(total.HP.max) || 1));
    total.HP.current = rescaleHPCurrent(base.HP, total.HP.max);
    const generatedHP = entite.modifierStats.preview.generated?.HP;
    if (generatedHP && typeof generatedHP === 'object') {
      generatedHP.current = total.HP.current - base.HP.current;
    }
  }

  entite.modifierStats.preview.total = total;

  return total;
}

export function refreshActiveStatPreview(entite, rootEl = document, { recalculate = true } = {}) {
  if (!entite?.id || !entite?.stats) {
    return null;
  }

  const total = !recalculate && entite.modifierStats?.preview?.total || ComputeStatPreview(entite);
  const root = rootEl?.querySelectorAll ? rootEl : document;
  const escape = (value) =>
    globalThis.CSS?.escape
      ? CSS.escape(String(value))
      : String(value).replace(/["\\]/g, "\\$&");

  root
    .querySelectorAll(`.stat-container[data-entity-id="${escape(entite.id)}"][data-stat]`)
    .forEach((block) => {
      const key = block.dataset.stat;
      if (!key) return;

      renderStatPair(entite, key, block);
    });

  syncPreviewIntroducedRows(entite, total, root);

  return total;
}
// LEVEL UP LOGIC MECHANICS
function bindLevelUpLogic(entite, dom, levelDetails) {
const ATTRIBUTE_KEYS = new Set(["strength", "agility", "intelligence"]);
const isAttributeKey = (k) => ATTRIBUTE_KEYS.has(String(k));
function refreshPreviewHP(entite) {
  ComputeStatPreview(entite);
  renderStatPair(entite, "HP", nodes.statsRoot);
}
function refreshPreviewSpeed(entite) {
  ComputeStatPreview(entite);
  renderStatPair(entite, "velocity", nodes.statsRoot);
  renderStatPair(entite, "speed", nodes.statsRoot);
}
 const costMap = buildCostMap(levelDetails);
  const { stratArchetype } = getArchetypeConfig(entite);

  const alreadyAwakened =
    !!(entite?.Archetype?.current &&
       entite.Archetype.current.key &&
       entite.Archetype.current.key !== "egare");

  const initialLevel = getEntityLevelCurrent(entite);

  const state = {
    currentEntity: entite,
    tempLevel: initialLevel,
    tempXP: playerExperience,
    investedXP: 0,
    history: [],
    archetypeProgress: initArchetypeProgress(entite),
    touchedArchetypes: new Set(),
    stats: getLevelUpAttributes(entite),
    investmentCounters: { force: 0, agilite: 0, intelligence: 0 },
    subHistory: { force: [], agilite: [], intelligence: [] },
    xpBaseline: playerExperience,
    awakened: alreadyAwakened,
    egareCycleSnapshot: null,
    achievedArchetypes: []
  };

// 🔁 Hydrate les cycles déjà achevés depuis l'entité
if (entite.Archetype && Array.isArray(entite.Archetype.achieve)) {
  state.achievedArchetypes = entite.Archetype.achieve.map(a => ({
    key: String(a.key || "").toLowerCase(),
    level: a.level ?? 1,
    step: a.step ?? a.stage ?? 0,
    uid: a.uid || getArchetypeUID(),
    milestone: Array.isArray(a.milestone) ? [...a.milestone] : []
  }));
}


state.currentEntity = entite;
  const setInvisible = (el, inv) => el.classList.toggle('is-hidden', !!inv);

  // Cache des nœuds attributibuts (création unique)
  const nodes = {
    confirm: dom.confirmButton,
    clear: dom.clearBtn,
    cost: dom.xpCostDisplay,
    xp: {
      initial: dom.initialXPDisplay,
      player: dom.playerXPDisplay,
      invested: dom.investedXPDisplay,
      transi: dom.transitionXP,
    },
    level: {
      current: dom.levelCurrent,
      future: dom.levelFuture,
      transi: dom.levelTransition,
    },
    attributs: {},
    archetypeLabel: dom.archetypeLabel,
    archetypeDesc: dom.archetypeDesc,
    graphCtx: dom.graphCanvas?.getContext('2d'),
    gauge: dom.gauge,
  };

nodes.statsRoot =
  document.querySelector(`#codex-entity_${entite.id} .entity-stats-section.left`)
  || document.querySelector(`.entity-stats-section.left[data-entity-id="${entite.id}"]`)
  || document.querySelector(".entity-stats-section.left")
  || document.body;
  
  dom.attributibutUp.innerHTML = '';
  for (const attribut of attributS) {
    const line = buildattributibutLine(attribut, state.stats[attribut.key], entite);
    dom.attributibutUp.appendChild(line);
    nodes.attributs[attribut.short] = {
      line,
      left:  line.querySelector('.left-arrow'),
      right: line.querySelector('.right-arrow'),
      value: line.querySelector('.axis-value-display')
    };
  }

  function updateHeader() {
    // 💰 XP
    nodes.xp.initial.textContent  = `${state.xpBaseline}`;
    nodes.xp.player.textContent   = `${state.tempXP}`;
    nodes.xp.invested.textContent = `- ${state.xpBaseline - state.tempXP} XP`;

    const entityMaxLevel = getEntityLevelMax(entite);
    const nextCost = costAt(costMap, state.tempLevel + 1);

    nodes.cost.textContent =
      state.tempLevel >= entityMaxLevel
        ? `Niveau maximum atteint (${entityMaxLevel})`
        : (nextCost != null
            ? `Coût prochain lvl. : ${nextCost} XP`
            : `Niveau maximum atteint (${entityMaxLevel})`);

    const hasHistory = state.history.length > 0;
    setInvisible(nodes.xp.player,   !hasHistory);
    setInvisible(nodes.xp.invested, !hasHistory);
    setInvisible(nodes.xp.transi,   !hasHistory);

    const baseLevel = getEntityLevelCurrent(entite);
    nodes.level.current.textContent = baseLevel;
    nodes.level.future.textContent  = state.tempLevel;

    document
      .querySelectorAll(`[data-stat="lvl"][data-entity-id="${entite.id}"]`)
      .forEach(el => el.textContent = baseLevel);

    const raised = state.tempLevel > baseLevel;
    setInvisible(nodes.level.transi, !raised);
    setInvisible(nodes.level.future, !raised);
    nodes.level.future.classList.toggle('augmented', raised);
  }
  function updateArrows() {
    const entityMaxLevel = getEntityLevelMax(entite);
    const canUp =
      state.tempLevel < entityMaxLevel &&
      state.tempXP >= (costAt(costMap, state.tempLevel + 1) ?? Infinity);

    for (const short in nodes.attributs) {
      const a = nodes.attributs[short];
      setInvisible(a.right, !canUp);
      a.line.classList.toggle('can-invest', canUp);
      a.line.querySelector('.axis-line')?.classList.toggle('can-invest', canUp);

      const last = state.history[state.history.length - 1];
      const isLast = !!last && last.short === short;
      setInvisible(a.left, !isLast);
      a.line.classList.toggle('can-uninvest', isLast);
      a.line.querySelector('.axis-line')?.classList.toggle('can-uninvest', isLast);
    }
  }


  function updateButtons() {
    const hasHistory = state.history.length > 0;
    setInvisible(nodes.confirm, !hasHistory);
    setInvisible(nodes.clear,   state.history.length <= 1);
  }

   
  const GAUGE_ANIM_DELAY = 450;  // délai pour la grosse jauge seulement
  let archetypeUpdateTimeout = null;
  let awakeningPresentationPending = false;

  function getActiveArchetypeKey(levelOverride = null, statsOverride = null) {
    const s = statsOverride || state.stats;
    const fallbackLevel = getEntityLevelCurrent(entite);
    const lvl = levelOverride ?? (state.tempLevel ?? fallbackLevel);

    return String(
      getClassFromAttributs(
        s.strength,
        s.agility,
        s.intelligence,
        lvl,
        state.awakened,
        entite
      ) || ""
    ).trim().toLowerCase();
  }

  function renderAll(mode = 'normal', prevKey = null, nextKey = null) {
    // Annule un éventuel timeout en cours
    if (archetypeUpdateTimeout) {
      clearTimeout(archetypeUpdateTimeout);
      archetypeUpdateTimeout = null;
    }

    const changed =
      prevKey &&
      nextKey &&
      prevKey !== nextKey;

    // Bloc commun, toujours synchro
    updateHeader();
    updateArrows();
    updateButtons();
    updategraph(state, nodes);
    soulScaling(state.tempLevel);

    // Progress is saved immediately; the first awakened archetype is revealed with the GIF.
    if (awakeningPresentationPending) return;

    // 🔹 NOM & DESCRIPTION D’ARCHETYPE → tout de suite
    updateArchetypeBadge(state, nodes);

    // 🔹 MILESTONES (petits jalons) → tout de suite aussi
    updateArchetypeMilestones(state, nodes);

    // Pas de changement d’archetype → on met à jour la jauge normalement
    if (!changed || mode === 'normal') {
      updateArchetypeGauge(state, nodes);
      return;
    }

    // Changement d’archetype : seule la GROSSE jauge est décalée
    archetypeUpdateTimeout = setTimeout(() => {
      updateArchetypeGauge(state, nodes);
      archetypeUpdateTimeout = null;
    }, GAUGE_ANIM_DELAY);
  }

  dom.levelUpSection._refreshStats = current => {
    if (String(current?.id) !== String(entite.id) || !current.baseStats || !current.stats) return;
    if (current !== entite) {
      // Rebase the open draft on committed gains while keeping its choices and investment history.
      for (const key of ['baseStats', 'baseStatSources', 'stats', 'stuff', 'resourceStocks',
        'armorLayers', 'extraLifeRegen', 'eternalLifeRegen']) {
        if (current[key] === undefined) delete entite[key];
        else entite[key] = structuredClone(current[key]);
      }
      entite.modifierStats ??= {};
      entite.modifierStats.durable = structuredClone(current.modifierStats?.durable || {});
      entite.battleBoosts = current.battleBoosts;
      if (entite.level && typeof entite.level === 'object') entite.level.max = current.level?.max ?? entite.level.max;
    }
    const root = dom.levelUpSection.closest('.codex-entity-scan') || dom.levelUpSection;
    refreshActiveStatPreview(entite, root);
    state.stats = getLevelUpAttributes(entite, true);
    for (const attribut of attributS) nodes.attributs[attribut.short].value.textContent = state.stats[attribut.key];
    renderAll();
  };

// Prepare l'etat eveille avant la confirmation synchrone des niveaux.
function applyAwakeningToEntity(entite, state, finalKey) {
  if (!entite || !finalKey) return;

  const awakeKey = String(finalKey).trim().toLowerCase();
  if (!awakeKey) return;

  // Sécurise la structure
  entite.Archetype ??= {
    current: null,
    inProgress: [],
    achieve: []
  };

  const arch = entite.Archetype;
  const prevCurrent = arch.current;

  // Le cycle complet, dernier attribut inclus, sera sauvegarde depuis state.

  // 2️⃣ Nouveau current = archetype éveillé, step 0 (cas exceptionnel)
  const newUid = getArchetypeUID();
  const newLevel = prevCurrent?.level || 1;

  const newCurrent = {
    key: awakeKey,
    level: newLevel,
    step: 0,        // 👈 tu voulais absolument step 0 juste après l’éveil
    uid: newUid
  };

  arch.current = newCurrent;

  // 3️⃣ inProgress vidé (comme dans ton exemple cible)
  arch.inProgress = [];

  // 4️⃣ Synchronise un minimum le state interne
  state.awakened = true;
  state.archetypeProgress ??= {};
  state.archetypeProgress[awakeKey] = {
    level: newLevel,
    stage: 0,
    uid: newUid
  };
  delete state.archetypeProgress.egare;

  // confirmLevelUp persiste ensemble niveaux, XP, statistiques et archetype.
}
  // 🔒 / 🔓 Blocage global des flèches et boutons de niveau
  function setArchetypeUIBlocked(block) {
    const arrows = dom.levelUpSection.querySelectorAll(".xp-arrow");
    const lvlButtons = dom.levelUpSection.querySelectorAll(".confirm-button");

    arrows.forEach(el => {
      el.style.pointerEvents = block ? "none" : "auto";
      el.style.opacity = block ? "0" : "1";
    });

    lvlButtons.forEach(btn => {
      btn.style.pointerEvents = block ? "none" : "auto";
      btn.style.opacity = block ? "0.2" : "1";
    });
  }
  // 🎯 Résolution complète d'un cycle terminé (normal vs éveil)
async function resolveArchetypeCycleCompletion(
  name,
  entite,
  cycleLen,
  prevLevel,
  prevStage,
  config = {}
) {
  const isAwakeningScenario =
    entite.archetypeFrozen !== true && (config.awakening ?? (name === "egare" && !state.awakened));
  if (entite.archetypeFrozen === true && name === 'egare') {
    state.awakened = false;
    state.archetypeProgress.egare = { level: prevLevel + 1, stage: 0, uid: getArchetypeUID(), milestones: [] };
    return;
  }

  const createMilestone =
    config.createMilestone ?? !isAwakeningScenario;

  const baseAnimMs = 2000;
  const extraBlockMs =
    config.extraBlockMs ?? (isAwakeningScenario ? 8000 : 0);

  if (!isAwakeningScenario) {
    if (typeof startArchup === "function") startArchup();
    await new Promise(res => setTimeout(res, baseAnimMs));
    if (!dom.levelUpSection.isConnected) return;
  }

  const keyLower = String(name || "").toLowerCase();
  const curProg = state.archetypeProgress[keyLower] || {
    level: prevLevel,
    stage: cycleLen,
    uid: getArchetypeUID(),
    milestones: []
  };
  if (!Array.isArray(curProg.milestones)) curProg.milestones = [];

  const fullMilestoneArr = curProg.milestones.slice(0, cycleLen);

  let finalName = name;

  state.achievedArchetypes ??= [];

  if (isAwakeningScenario) {
    // 🌌 SCÉNARIO ÉVEIL (Égaré → X)
    const egSnapshot = {
      key: "egare",
      level: prevLevel,
      step: cycleLen,
      uid: curProg.uid || getArchetypeUID(),
      milestone: fullMilestoneArr
    };

    state.egareCycleSnapshot = egSnapshot;
    state.achievedArchetypes.push(egSnapshot);

    finalName = getClassFromAttributs(
      state.stats.strength,
      state.stats.agility,
      state.stats.intelligence,
      state.tempLevel,
      true,
      entite
    );

    if (!finalName || typeof finalName !== "string") {
      console.warn("⚠️ [Égaré] Archetype invalide → fallback oracle");
      finalName = "oracle";
    }
    finalName = finalName.trim().toLowerCase();
    console.log(`🔄 Égaré s’est transformé automatiquement en : ${finalName}`);

    delete state.archetypeProgress["egare"];

    state.archetypeProgress[finalName] = {
      level: prevLevel,
      stage: 0,
      uid: getArchetypeUID(),
      milestones: []
    };

    awakeningPresentationPending = true;
    state.awakened = true;
    applyAwakeningToEntity(entite, state, finalName);

    const graphContainer = dom.levelUpSection.querySelector('.attribut-graph-container');
    // Hide the frame before confirmation can remove the stray styling.
    graphContainer?.classList.add('awakening-frame-pending');
    // Commit before any timer: closing, navigating or reloading cannot interrupt awakening.
    confirmLevelUp();
    graphContainer?.classList.add('stray');
    setArchetypeUIBlocked(true);
    if (typeof startArchup === "function") startArchup();
    await new Promise(res => setTimeout(res, baseAnimMs));
    if (!dom.levelUpSection.isConnected) return;

    playAwakeningExtasis(entite, { onReveal: () => {
      if (dom.levelUpSection.isConnected) graphContainer?.classList.remove('stray');
    } });

    // Reveal the archetype two seconds before controls return, independently of the frame.
    setTimeout(() => {
      if (!dom.levelUpSection.isConnected) return;
      awakeningPresentationPending = false;
      renderAll();
      setArchetypeUIBlocked(true);
    }, Math.max(0, extraBlockMs - 2000));

  } else {
    // 🟢 SCÉNARIO NORMAL : le cycle du niveau prevLevel est terminé
    const snapshot = {
      key: keyLower,
      level: prevLevel,
      step: cycleLen,
      uid: curProg.uid || getArchetypeUID(),
      milestone: fullMilestoneArr
    };
    state.achievedArchetypes.push(snapshot);

    // passage au niveau suivant pour cet archetype
    state.archetypeProgress[keyLower] = {
      level: prevLevel + 1,
      stage: 0,
      uid: curProg.uid || getArchetypeUID(),
      milestones: []
    };
  }

  // 🎯 icône de jalon (preview) sauf en cas d’éveil
  if (createMilestone) {
    const milestoneKey   = name;
    const milestoneLevel = prevLevel;

    if (milestoneKey !== "egare") {
      const uid = `preview-${entite.id}-${milestoneKey}-${milestoneLevel}`;
      createArchetypeIcon(entite, milestoneKey, milestoneLevel, uid);

      const icon = document.querySelector(
        `#archetype-icons-${entite.id} [data-archetype-uid="${uid}"]`
      );
      if (icon) icon.classList.add("preview");
    }
  }

  setTimeout(() => {
    state.lockArchetype = false;
    if (!dom.levelUpSection.isConnected) return;
    setArchetypeUIBlocked(false);
    if (typeof renderAll === "function") renderAll();
  }, extraBlockMs + 1);
}

function getSkippedArchetypeStageInfo(classKey, entite, reason = "skipped") {
  const name = String(classKey || "").toLowerCase();
  const current = state.archetypeProgress[name] || { level: 1, stage: 0 };
  const level = Number(current.level ?? 1) || 1;
  const stage = Number(current.stage ?? 0) || 0;

  return {
    classKey: name,
    level,
    stage,
    cycleName: null,
    appliedStage: 0,
    cycleLen: getCycleLenFor(name, entite) || 0,
    prevLevel: level,
    prevStage: stage,
    skipped: true,
    reason
  };
}

function advanceArchetypeStage(classKey, entite) {
  const name  = String(classKey || "").toLowerCase();
  const cycle = getCycleForKey(name, entite);

  if (state.lockArchetype) {
    return getSkippedArchetypeStageInfo(name, entite, "locked");
  }

  // 🛑 Aucun cycle : on ne fait rien
  if (!cycle) {
    return getSkippedArchetypeStageInfo(name, entite, "no-cycle");
  }

  const cycleLen = cycle.length;

  // Progression actuelle
  const cur = state.archetypeProgress[name] || {
    level: 1,
    stage: 0,
    uid: getArchetypeUID(),
    milestones: []
  };

  if (!Array.isArray(cur.milestones)) cur.milestones = [];
  if (!cur.uid) cur.uid = getArchetypeUID();

  const prevLevel = cur.level || 1;
  const prevStage = cur.stage || 0;

  const appliedStage = prevStage + 1;
  const isLastStep   = appliedStage === cycleLen;

  let cycleName = cycle[Math.min(appliedStage, cycleLen) - 1];

  if (!isLastStep) {
    // simple avancée
    cur.level = prevLevel;
    cur.stage = appliedStage;
    state.archetypeProgress[name] = cur;
    state.touchedArchetypes.add(name);

    return {
      classKey: name,
      level: prevLevel,
      stage: appliedStage,
      cycleName,
      appliedStage,
      cycleLen,
      prevLevel,
      prevStage,
      skipped: false
    };
  }

  // 🔚 Dernier step du cycle
  state.lockArchetype = true;
  cur.level = prevLevel;
  cur.stage = cycleLen;
  state.archetypeProgress[name] = cur;
  state.touchedArchetypes.add(name);

  // Blocage UI
  setArchetypeUIBlocked(true);

  return {
    completed: true,
    classKey: name,
    level: prevLevel,
    stage: cycleLen,
    cycleName,
    appliedStage,
    cycleLen,
    prevLevel,
    prevStage,
    skipped: false
  };
}


function previewStats(entite) {
  // 🧩 On récupère les stats fusionnées avec les fonctions existantes
  const merged = getPreviewStats(entite);
  const statsContainer = document.querySelector(".entity-stats-section.left");

  // 🔄 Boucle sur les stats connues
  for (const [key, val] of Object.entries(merged)) {
	   if (isAttributeKey(key)) continue;
    const def = STATS_DATA.find(s => s.key === key);
    if (!def) {
      console.warn(`⚠️ [previewStats] Stat "${key}" introuvable dans STATS_DATA`);
      continue;
    }

    const isAttribut = ["strength", "agility", "intelligence"].includes(key);
    const selector = isAttribut
      ? `.stat-container[data-stat="${key}"][data-entity-id="${entite.id}"] .entite-stat`
      : `.entite-stat[data-stat="${key}"][data-entity-id="${entite.id}"]`;

    const existing = document.querySelector(selector);
if (existing) {
let displayVal = isObjStat(val) ? `${val.current} / ${val.max}` : val;

if (key === "speed") {
  const ms = parseFloat(String(val ?? 0));
  displayVal = `${(ms / 1000).toFixed(2)} s`;
}

existing.textContent = displayVal;

} else {
  console.log(`⚠️ [previewStats] Bloc DOM manquant pour "${def.key}", non recréé.`);
}
  }


  // 🔍 Debug
  console.groupCollapsed(`🔍 [previewStats] Stats preview pour entité ${entite.id}`);
  for (const [key, val] of Object.entries(merged)) console.log(`   • ${key} =`, val);
  console.groupEnd();

  return merged;
}

  // ===============================
  // 📈 INVEST
  // ===============================
  function invest(short) {
    const entite = state.currentEntity;
    if (!entite) return;

    if (state.lockArchetype) {
      console.warn("[invest] Transition d'archétype en cours — investissement ignoré.");
      return;
    }

    const entityMaxLevel = getEntityLevelMax(entite);
    const baseLevel = getEntityLevelCurrent(entite);

    if (state.tempLevel >= entityMaxLevel || baseLevel >= entityMaxLevel) {
      console.warn(`[invest] Niveau maximum (${entityMaxLevel}) atteint — montée impossible.`);
      return;
    }

    // archetype AVANT l’investissement
    const prevKey = getActiveArchetypeKey();

    const nextLevel = state.tempLevel + 1;
    if (nextLevel > entityMaxLevel) {
      console.warn(`[invest] Tentative de dépasser le niveau max (${entityMaxLevel}).`);
      return;
    }

    const c = costAt(costMap, nextLevel);
    if (c == null || state.tempXP < c) return;


    const a = nodes.attributs[short];
    if (!a) return;
    const key = a.line.dataset.key;

    // 🧮 on regarde si on est sur le DERNIER step d’Égaré avant éveil
    const egareCycleLen = getCycleLenFor('egare', entite);
    const egareProg = state.archetypeProgress['egare'] || { level: 1, stage: 0 };
    const willFinishEgareCycle =
      entite.archetypeFrozen !== true &&
      !state.awakened &&
      egareCycleLen > 0 &&
      egareProg.stage + 1 === egareCycleLen;

    let autoConfirmAfter = false;

    if (willFinishEgareCycle) {
      const ok = window.confirm(
        "Votre entité va s'éveiller.\n" +
        "C'est une opération irréversible.\n\n" +
        "Voulez-vous continuer ?"
      );

      if (!ok) {
        // on n’investit pas ce point
        return;
      }

      // on investit ET on auto-confirmera ensuite
      autoConfirmAfter = true;
    }

    clearEntityStatDeltaClasses(entite.id);

    closeOpenHelpers();

    // 💰 économie + stat principale
    state.tempXP     -= c;
    state.investedXP += c;
    state.tempLevel   = nextLevel;
    addPreviewStat(entite, key, 1);
    state.stats = getLevelUpAttributes(entite, true);

    // archetype APRÈS investissement (avec stats + niveau à jour)
    const nextKey = getActiveArchetypeKey();

    // progression de cycle pour l’archetype actif après l’investissement
    const info =
      advanceArchetypeStage(nextKey, entite) ||
      getSkippedArchetypeStageInfo(nextKey, entite, "missing-info");
    let {
      level,
      stage,
      cycleName,
      appliedStage,
      cycleLen: cycleLenAfter,
      skipped,
      prevLevel,
      prevStage
    } = info;

    // 🧿 Mémorise l'attribut investi pour ce step dans la progression d'archetype
    if (!skipped && appliedStage > 0) {
      const attrName = attribut_SHORT_TO_NAME[short]; // "force" | "agilite" | "intelligence"
      if (attrName) {
        const prog = state.archetypeProgress[nextKey] || {
          level: level || 1,
          stage,
          uid: getArchetypeUID(),
          milestones: []
        };
        if (!Array.isArray(prog.milestones)) prog.milestones = [];
        // index = step - 1
        prog.milestones[appliedStage - 1] = attrName;
        state.archetypeProgress[nextKey] = prog;
      }
    }

    if (cycleName && cycleName.startsWith("mutation")) {
      cycleName = resolveMutation(
        cycleName,
        state.stats.strength,
        state.stats.agility,
        state.stats.intelligence
      ).finalName;
    }

    if (!skipped) {
      console.log(
        `→ ${nextKey}: étape ${appliedStage}/${cycleLenAfter}, type=${cycleName}, level=${level}, stageAfter=${stage}`
      );
    }

    // 🎯 Sous-stat selon archetype + stage
    let pickKey = null;

    if (!skipped) {
      const attributName = attribut_SHORT_TO_NAME[short];
      const archetypeCycle = getCycleForKey(nextKey, entite);
      let currentStageIndex;

      if (appliedStage <= cycleLenAfter) {
        currentStageIndex = appliedStage - 1;
      } else {
        currentStageIndex = cycleLenAfter - 1;
      }
      currentStageIndex = Math.max(0, Math.min(currentStageIndex, cycleLenAfter - 1));

      const stageName = archetypeCycle?.[currentStageIndex];

      pickKey =
        STAT_INDEX.typeToKey?.[nextKey]?.[stageName] ||
        STAT_INDEX.typeToKey?.[attributName]?.[stageName] ||
        null;

if (pickKey) {
  // 1) Preview de la sous-stat
  addPreviewStat(entite, pickKey, 1);
  (state.subHistory[attributName] ||= []).push(pickKey);

  // parent commun
let statParent =
  document.querySelector(`#codex-entity_${entite.id} .umbra-submenu.new.entity-stats-section`)
  || document.querySelector(`.umbra-submenu.new.entity-stats-section`)
   || nodes.statsRoot
  || document.body;
  if (!statParent) statParent = nodes.statsRoot || document.body;

  // addPreviewStat has already refreshed preview.total, including armor.

  // -------------------------
  // 2) Création du bloc pickKey si absent
  // -------------------------
  const existingStat = document.querySelector(
    `.stat-container[data-stat="${pickKey}"][data-entity-id="${entite.id}"]`
  );

  if (!existingStat) {
    const statDef   = STATS_DATA.find(s => s.key === pickKey);
    const statLabel = statDef ? statDef.name : pickKey;

    // ✅ init valeur base (number par défaut)
    if (entite.stats[pickKey] == null) entite.stats[pickKey] = 0;

    // ✅ IMPORTANT : on passe la valeur BRUTE (number ou objet), PAS fmt()
   createUmbraBlock(
  statParent,
  statLabel,
  () => entite.stats[pickKey],
  entite,
  pickKey,   // forcedStatKey
  false,    // inlineStatName
  null,     // attribut
  true,     // umbra (ou un objet umbra)
  { showMissingAsNew: true, newLineContext: "preview" }
);
    markStatUpgraded(entite, pickKey);
  }

  // -------------------------
  // 3) ✅ Cas spécial : armor n’existe pas MAIS armor.max existe en preview
  // -------------------------
 const previewArmor = entite?.modifierStats?.preview?.generated?.armor;

const hasArmorDelta =
  previewArmor &&
  typeof previewArmor === "object" &&
  (
    Number(previewArmor.current ?? 0) !== 0 ||
    Number(previewArmor.max ?? 0) !== 0
  );

const armorBlockMissing = !document.querySelector(
  `.stat-container[data-stat="armor"][data-entity-id="${entite.id}"]`
);

if (armorBlockMissing && hasArmorDelta) {
  const armorDef = STATS_DATA.find(s => s.key === "armor");
  const armorLabel = armorDef ? armorDef.name : "Armure";

  const permanentArmor =
    entite.stats?.armor && typeof entite.stats.armor === "object"
      ? entite.stats.armor
      : { current: 0, max: 0 };

  createUmbraBlock(
    statParent,
    armorLabel,
    () => permanentArmor,
    entite,
    "armor",
    false,
    null,
    false,
    { showMissingAsNew: true, newLineContext: "preview" }
  );

  renderStatPair(entite, "armor", statParent);
}
// -------------------------
// 3bis) ✅ Cas spécial : extraLife n’existe pas MAIS extraLife est présent en preview
// -------------------------
const previewExtraLife = entite?.modifierStats?.preview?.generated?.extraLife;

const hasExtraLifeDelta =
  previewExtraLife &&
  typeof previewExtraLife === "object" &&
  (
    Number(previewExtraLife.current ?? 0) !== 0 ||
    Number(previewExtraLife.max ?? 0) !== 0
  );

const extraLifeBlockMissing = !document.querySelector(
  `.stat-container[data-stat="extraLife"][data-entity-id="${entite.id}"]`
);

if (extraLifeBlockMissing && hasExtraLifeDelta) {
  const extraDef = STATS_DATA.find(s => s.key === "extraLife");
  const extraLabel = extraDef ? extraDef.name : "Vie supplémentaire";

  const permanentExtraLife =
    entite.stats?.extraLife && typeof entite.stats.extraLife === "object"
      ? entite.stats.extraLife
      : { current: 0, max: 0 };

  createUmbraBlock(
    statParent,
    extraLabel,
    () => permanentExtraLife,
    entite,
    "extraLife",
    false,
    null,
    false,
    { showMissingAsNew: true, newLineContext: "preview" }
  );

  renderStatPair(entite, "extraLife", statParent);
}

// -------------------------
// 3ter) ✅ Cas spécial : charge n’existe pas MAIS charge est présente en preview
// -------------------------
const previewCharge =
  entite?.modifierStats?.preview?.total?.charge;
const permanentCharge = Number(entite.stats?.charge ?? 0) || 0;

const hasChargeDelta = Number(previewCharge ?? permanentCharge) !== permanentCharge;

const chargeBlockMissing = !document.querySelector(
  `.stat-container[data-stat="charge"][data-entity-id="${entite.id}"]`
);

if (chargeBlockMissing && hasChargeDelta) {
  const chargeDef = STATS_DATA.find(s => s.key === "charge");
  const chargeLabel = chargeDef ? chargeDef.name : "Charge";

  createUmbraBlock(
    statParent,
    chargeLabel,
    () => permanentCharge,
    entite,
    "charge",
    false,
    null,
    false,
    { showMissingAsNew: true, newLineContext: "preview" }
  );

  renderStatPair(entite, "charge", statParent);
}
} else {
  console.warn(`[invest] Pas de sous-stat trouvée pour ${nextKey} (${stageName})`);
}


    }

    // 🧾 Historique
    state.history.push({
      short,
      archetypeKey: nextKey,
      level,
      stage,
      prevLevel,
      prevStage,
      subKey: pickKey
    });

    // 🎨 UI / stats / preview...
    a.value.textContent = state.stats[key];
   if (!isAttributeKey(key)) {
  renderStatPair(entite, key, nodes.statsRoot);
}
    if (pickKey) {
  const pickBlock = document.querySelector(`.stat-container[data-stat="${pickKey}"][data-entity-id="${entite.id}"]`);
  const pickRoot = pickBlock?.closest(".entity-stats-section") || nodes.statsRoot || document.body;
  renderStatPair(entite, pickKey, pickRoot);
}

refreshActiveStatPreview(entite, nodes.statsRoot, { recalculate: false });

/*
 * Si strength ou indestructibility ont changé,
 * hpBattleRegen doit être immédiatement recalculée et affichée.
 */
refreshPreviewHpBattleRegen(entite, nodes.statsRoot);

    // 👉 rendu avec gestion du délai :
    //    - si prevKey === nextKey → pas de délai
    //    - si arch change       → invest = jauge d'abord, label après
    renderAll('invest', prevKey, nextKey);

    // marquage visuel
    document.querySelectorAll('.stat-container.last-substat')
      .forEach(el => el.classList.remove('last-substat'));
    document.querySelectorAll('.stat-container.last-attribut')
      .forEach(el => el.classList.remove('last-attribut'));

    const subContainer = pickKey
      ? document.querySelector(`.stat-container[data-stat="${pickKey}"][data-entity-id="${entite.id}"]`)
      : null;
    const attrContainer = document.querySelector(
      `.stat-container[data-stat="${key}"][data-entity-id="${entite.id}"]`
    );

    if (subContainer)  subContainer.classList.add('last-substat');
    if (attrContainer) attrContainer.classList.add('last-attribut');

    if (entite.modifierStats?.preview?.statLeveled) {
      saveUpgradedEntity(entite);
      console.log(`💾 Preview sauvegardée pour ${entite.name} (${entite.id})`);
    }

    // Resolve only once the final point, its sub-stat and milestone are complete.
    if (info.completed) {
      void resolveArchetypeCycleCompletion(nextKey, entite, cycleLenAfter, prevLevel, prevStage, {
        awakening: autoConfirmAfter,
      });
    }
  }

  // ===============================
  // 📉 UNINVEST
  // ===============================
  function uninvest(short) {
    const entite = state.currentEntity;
    if (!entite) return;

    if (!state.history.length) return;

    const last = state.history[state.history.length - 1];
    if (!last || last.short !== short) return;

    const a = nodes.attributs[short];
    if (!a) return;

    const key = a.line.dataset.key;
    const backLevel = state.tempLevel;
    const c = costAt(costMap, backLevel);
    if (c == null) return;

    closeOpenHelpers();
    clearEntityStatDeltaClasses(entite.id);

    // archetype AVANT le désinvestissement
    const prevKey = getActiveArchetypeKey();

    // 🧹 suppression éventuelle d’icône de jalon
    const justFinishedCycle = last.stage > last.prevStage;
    if (justFinishedCycle) {
      const uidToRemove = `preview-${entite.id}-${last.archetypeKey}-${last.prevLevel}`;
      const icon = document.querySelector(
        `#archetype-icons-${entite.id} [data-archetype-uid="${uidToRemove}"]`
      );
      if (icon) icon.remove();
    }

    // ==========================
    // ROLLBACK NIVEAU
    // ==========================
    state.tempLevel  -= 1;
    state.tempXP     += c;
    state.investedXP -= c;
    removePreviewStat(entite, key);
    state.stats = getLevelUpAttributes(entite, true);

    // ==========================
    // ROLLBACK ARCHETYPE
    // ==========================
	if (state.milestoneAttributes &&
        state.milestoneAttributes[last.archetypeKey]) {
      delete state.milestoneAttributes[last.archetypeKey][last.stage];
    }
    if (last.archetypeKey) {
      const prog = state.archetypeProgress[last.archetypeKey] || {
        level: last.prevLevel,
        stage: last.stage,
        uid: getArchetypeUID(),
        milestones: []
      };
      if (!Array.isArray(prog.milestones)) prog.milestones = [];

      // On efface l'attribut du step annulé
      if (last.stage != null && last.stage > 0 && last.stage <= prog.milestones.length) {
        prog.milestones[last.stage - 1] = null;
      }

      // On peut optionnellement couper la longueur au nouveau stage
      prog.milestones = prog.milestones.slice(0, last.prevStage);

      prog.level = last.prevLevel;
      prog.stage = last.prevStage;
      state.archetypeProgress[last.archetypeKey] = prog;
      state.touchedArchetypes.add(last.archetypeKey);
    }



    // ==========================
    // ROLLBACK SOUS-STAT
    // ==========================
    const attributName = attribut_SHORT_TO_NAME[short];

    if (last.subKey) {
      removePreviewStat(entite, last.subKey);

      const arr = state.subHistory[attributName];
      if (Array.isArray(arr) && arr.length) arr.pop();

      const currentVal = entite.stats[last.subKey] ?? 0;
      const previewVal = entite.modifierStats?.preview?.statLeveled?.[last.subKey] ?? 0;

      if (currentVal <= 0 && previewVal <= 0) {
        const domStat = document.querySelector(
          `.stat-container[data-stat="${last.subKey}"][data-entity-id="${entite.id}"]`
        );
        if (domStat) domStat.remove();
      }
    }

    // ==========================
    // HISTORIQUE & UI
    // ==========================
    state.history.pop();
    a.value.textContent = state.stats[key];
if (!isAttributeKey(key)) {
  renderStatPair(entite, key, nodes.statsRoot);
}
   if (last.subKey) {
  const subBlock = document.querySelector(
    `.stat-container[data-stat="${last.subKey}"][data-entity-id="${entite.id}"]`
  );
  const subRoot = (subBlock && subBlock.closest(".entity-stats-section"))
    || nodes.statsRoot
    || document.body;

  renderStatPair(entite, last.subKey, subRoot);
}
refreshActiveStatPreview(entite, nodes.statsRoot, { recalculate: false });

refreshPreviewHpBattleRegen(
  entite,
  nodes.statsRoot
);

    // archetype APRÈS le désinvestissement
    const nextKey = getActiveArchetypeKey();

    // 👉 rendu avec gestion du délai :
    //    - uninvest = archétype tout de suite, jauge après si changement
    renderAll('uninvest', prevKey, nextKey);

    // 🌟 Mise à jour du marquage visuel
    document.querySelectorAll('.stat-container.last-substat')
      .forEach(el => el.classList.remove('last-substat'));

    document.querySelectorAll('.stat-container.last-attribut')
      .forEach(el => el.classList.remove('last-attribut'));

    const prev = state.history[state.history.length - 1];
    if (prev) {
      const prevAttr = nodes.attributs[prev.short];
      if (prevAttr) {
        const prevKeyAttr = prevAttr.line.dataset.key;
        const attrContainer = document.querySelector(
          `.stat-container[data-stat="${prevKeyAttr}"][data-entity-id="${entite.id}"]`
        );
        if (attrContainer) attrContainer.classList.add('last-attribut');
      }

      if (prev.subKey) {
        const subContainer = document.querySelector(
          `.stat-container[data-stat="${prev.subKey}"][data-entity-id="${entite.id}"]`
        );
        if (subContainer) subContainer.classList.add('last-substat');
      }
    }

    if (entite.modifierStats?.preview?.statLeveled) {
      saveUpgradedEntity(entite);
    }
  }

// UPGRADE ARROW LVL ECOUTEUR
dom.levelUpSection.addEventListener('click', (e) => {
  const arrow = e.target.closest('.xp-arrow');
  if (!arrow || !dom.levelUpSection.contains(arrow)) return;

  const line = arrow.closest('.axis-line');
  const short = line?.dataset.short;
  if (!short) return;

  // 🟢 Invest / Uninvest
  if (arrow.classList.contains('right-arrow')) {
    invest(short);
  } else if (arrow.classList.contains('left-arrow')) {
    uninvest(short);
  }

  // invest/uninvest already save the updated draft once.
});

// Clear all : rejoue tous les uninvest dans l'ordre inverse
dom.clearBtn.addEventListener('click', () => {
  closeOpenHelpers();
  // On annule TOUT l'historique courant en déroulant les steps à l'envers
  while (state.history.length > 0) {
    const last = state.history[state.history.length - 1];
    if (!last || !last.short) break;
    uninvest(last.short);
  }

  // ❌ NE PLUS TOUCHER state.awakened ICI
  // state.awakened = isEntityAwakened(entite);  // → à supprimer

  // Recalcule la preview et rafraîchit l'UI
  refreshActiveStatPreview(entite, nodes.statsRoot);
  renderAll();
});

// ✅ CONFIRMER LEVEL UP (valide les stats preview et les applique)
dom.confirmButton.addEventListener('click', () => {
  confirmLevelUp();
});

// Rafraîchit le marqueur visuel via comparaison permanent/preview.
function markStatUpgraded(entite, statKey) {
  const block = document.querySelector(
    `.stat-container[data-stat="${statKey}"][data-entity-id="${entite.id}"]`
  );
  if (!block) return;
  renderStatPair(
    entite,
    statKey,
    block.closest(".entity-stats-section") || nodes.statsRoot || document.body
  );
}

// Même logique au retrait : le rendu décide entre up/down/égal.
function unmarkStatUpgraded(entite, statKey) {
  const block = document.querySelector(
    `.stat-container[data-stat="${statKey}"][data-entity-id="${entite.id}"]`
  );
  if (!block) return;
  renderStatPair(
    entite,
    statKey,
    block.closest(".entity-stats-section") || nodes.statsRoot || document.body
  );
}
function refreshPreviewHpBattleRegen(entite, fallbackRoot = null) {
  if (!entite) return;
  const total = entite?.modifierStats?.preview?.total;
  const previewHpBattleRegen = Math.max(0, Number(total?.hpBattleRegen) || 0);
  const permanentHpBattleRegen = Math.max(0, getConfirmedStatValue(entite, "hpBattleRegen", 0));
  let block = document.querySelector(`.stat-container[data-stat="hpBattleRegen"][data-entity-id="${entite.id}"]`);
  const statParent = block?.closest(".entity-stats-section") || fallbackRoot || document.querySelector(`#codex-entity_${entite.id} .umbra-submenu.new.entity-stats-section`) || document.querySelector(`.umbra-submenu.new.entity-stats-section`) || nodes.statsRoot || document.body;

  /*
   * La stat peut apparaître pour la première fois parce que
   * la preview vient de donner de l'indestructibilité.
   */
  if (!block && previewHpBattleRegen > 0) {
    const statDef = STATS_DATA.find(stat => stat.key === "hpBattleRegen");
    const statLabel = statDef?.name || "Régénération de combat";
    createUmbraBlock(
      statParent,
      statLabel,
      () => permanentHpBattleRegen,
      entite,
      "hpBattleRegen",
      false,
      null,
      true,
      { showMissingAsNew: true, newLineContext: "preview" }
    );
    block = document.querySelector(`.stat-container[data-stat="hpBattleRegen"][data-entity-id="${entite.id}"]`);
  }

  if (!block) return;
  const root = block.closest(".entity-stats-section") || statParent;
  renderStatPair(entite, "hpBattleRegen", root);

  /*
   * Si la stat n'existe ni en permanent ni en preview,
   * on retire le bloc créé temporairement.
   */
  if (previewHpBattleRegen <= 0 && permanentHpBattleRegen <= 0) block.remove();
}
function refreshPreviewVitals(entite) {
  ComputeStatPreview(entite);

  let b;

  b = document.querySelector(`.stat-container[data-stat="HP"][data-entity-id="${entite.id}"]`);
  renderStatPair(entite, "HP", b?.closest(".entity-stats-section") || nodes.statsRoot || document.body);

  b = document.querySelector(`.stat-container[data-stat="armor"][data-entity-id="${entite.id}"]`);
  renderStatPair(entite, "armor", b?.closest(".entity-stats-section") || nodes.statsRoot || document.body);

  b = document.querySelector(`.stat-container[data-stat="extraLife"][data-entity-id="${entite.id}"]`);
  renderStatPair(entite, "extraLife", b?.closest(".entity-stats-section") || nodes.statsRoot || document.body);

  b = document.querySelector(`.stat-container[data-stat="charge"][data-entity-id="${entite.id}"]`);
  renderStatPair(entite, "charge", b?.closest(".entity-stats-section") || nodes.statsRoot || document.body);

  b = document.querySelector(`.stat-container[data-stat="dayHpRegen"][data-entity-id="${entite.id}"]`);
  renderStatPair(entite, "dayHpRegen", b?.closest(".entity-stats-section") || nodes.statsRoot || document.body);

  refreshPreviewHpBattleRegen(entite, nodes.statsRoot);
}

function addPreviewStat(entite, statKey, amount = 1) {
  statKey = normalizeStatKey(statKey);
  if (!entite || !statKey) return;

  entite.modifierStats ??= {};
  entite.modifierStats.preview ??= {
    statLeveled: {}
  };
  entite.modifierStats.preview.statLeveled ??= {};

  const currentValue =
    Number(
      entite.modifierStats.preview.statLeveled[statKey]
    ) || 0;

  const nextValue =
    currentValue +
    (Number(amount) || 0);

  if (nextValue !== 0) {
    entite.modifierStats.preview.statLeveled[statKey] =
      nextValue;
  } else {
    delete entite.modifierStats.preview.statLeveled[statKey];
  }

  if (
    statKey === "vitality" ||
    statKey === "robustness" ||
    statKey === "transcendence" ||
    statKey === "weaponMastery" ||
    statKey === "strength" ||
    statKey === "indestructibility" ||
    statKey === "hpBattleRegen"
  ) {
    refreshPreviewVitals(entite);
  } else if (statKey === "velocity") {
    refreshPreviewSpeed(entite);
  } else {
    ComputeStatPreview(entite);
  }

  markStatUpgraded(entite, statKey);
}

function removePreviewStat(entite, statKey, amount = 1) {
  statKey = normalizeStatKey(statKey);
  if (!entite || !statKey) return;

  const statLeveled =
    entite?.modifierStats?.preview?.statLeveled;

  if (!statLeveled) return;

  const currentValue =
    Number(statLeveled[statKey]) || 0;

  const nextValue =
    currentValue -
    Math.max(0, Number(amount) || 0);

  if (nextValue > 0) {
    statLeveled[statKey] = nextValue;
  } else {
    delete statLeveled[statKey];
  }

  if (
    statKey === "vitality" ||
    statKey === "robustness" ||
    statKey === "transcendence" ||
    statKey === "weaponMastery" ||
    statKey === "strength" ||
    statKey === "indestructibility" ||
    statKey === "hpBattleRegen"
  ) {
    refreshPreviewVitals(entite);
  } else if (statKey === "velocity") {
    refreshPreviewSpeed(entite);
  } else {
    ComputeStatPreview(entite);
  }

  unmarkStatUpgraded(entite, statKey);
}
function removeNewStatClasses(entite) {
  const entitySelector = entite?.id
    ? `.stat-container[data-entity-id="${entite.id}"].new`
    : ".stat-container.new";

  document.querySelectorAll(entitySelector).forEach(el => {
    if (isLevelUpNewStatsArea(el)) {
      el.classList.remove("new");
      delete el.dataset.statLineCreatedAsNew;
    }
  });

  document.querySelectorAll('.entite-stat.new-stat').forEach(el => {
    const statKey = el.dataset.stat;
    const entityId = el.dataset.entityId;

    // Supprime la classe "new-stat"
    el.classList.remove('new-stat');

    // Récupère l’entité correspondante si non passée en argument
    const targetEntite = entite || (window.entites?.find(e => e.id == entityId));

    // Vérifie la valeur réelle de la stat
    const statValue =
      targetEntite?.stats?.[statKey] ??
      targetEntite?.modifierStats?.durable?.statLeveled?.[statKey] ??
      targetEntite?.modifierStats?.preview?.statLeveled?.[statKey] ??
      0;

    // Si la stat n’a plus aucune valeur → supprime le conteneur complet
    if ((statValue == null || statValue <= 0) && !ZERO_VALUE_VISIBLE_STAT_KEYS.has(normalizeStatKey(statKey))
      && !getStatMalusSources(targetEntite, statKey).length) {
      const statContainer = el.closest(`.stat-container[data-stat="${statKey}"][data-entity-id="${entityId}"]`);
      if (statContainer) {
        console.log(`🗑️ Suppression stat vide '${statKey}' pour entité ${entityId}`);
        statContainer.remove();
      }
    }
  });
}

function cloneLevelUpArray(array) {
  return Array.isArray(array)
    ? array.map(entry => cloneLevelUpPlainData(entry, entry)).filter(Boolean)
    : [];
}

function snapshotLevelUpSaveState(state) {
  const touchedArchetypes = state?.touchedArchetypes instanceof Set
    ? new Set(Array.from(state.touchedArchetypes))
    : new Set();

  return {
    tempLevel: Number(state?.tempLevel ?? 1) || 1,
    xpBaseline: Number(state?.xpBaseline ?? playerExperience) || 0,
    tempXP: Number(state?.tempXP ?? playerExperience) || 0,
    investedXP: Number(state?.investedXP ?? 0) || 0,
    stats: cloneLevelUpPlainData(state?.stats, {}),
    archetypeProgress: cloneLevelUpPlainData(state?.archetypeProgress, {}),
    touchedArchetypes,
    awakened: !!state?.awakened,
    egareCycleSnapshot: cloneLevelUpPlainData(state?.egareCycleSnapshot, null),
    achievedArchetypes: cloneLevelUpArray(state?.achievedArchetypes),
    history: cloneLevelUpArray(state?.history),
    investmentCounters: cloneLevelUpPlainData(state?.investmentCounters, {
      force: 0,
      agilite: 0,
      intelligence: 0
    }),
    subHistory: cloneLevelUpPlainData(state?.subHistory, {
      force: [],
      agilite: [],
      intelligence: []
    })
  };
}

function refreshLevelUpStateAfterSave(state, entite) {
  if (!state || !entite) return;

  state.archetypeProgress = initArchetypeProgress(entite);
  state.achievedArchetypes = Array.isArray(entite.Archetype?.achieve)
    ? entite.Archetype.achieve.map(a => ({
        key: String(a.key || "").toLowerCase(),
        level: a.level ?? 1,
        step: a.step ?? a.stage ?? 0,
        uid: a.uid || getArchetypeUID(),
        milestone: Array.isArray(a.milestone) ? [...a.milestone] : []
      }))
    : [];

  state.history = [];
  state.investedXP = 0;
  state.tempXP = playerExperience;
  state.xpBaseline = playerExperience;
  state.tempLevel = getEntityLevelCurrent(entite);
  state.stats = getLevelUpAttributes(entite);
  state.investmentCounters = { force: 0, agilite: 0, intelligence: 0 };
  state.subHistory = { force: [], agilite: [], intelligence: [] };
  state.egareCycleSnapshot = null;
  state.awakened = entite.archetypeFrozen !== true && !!(
    entite.Archetype?.current &&
    entite.Archetype.current.key &&
    entite.Archetype.current.key !== "egare"
  );

  if (state.touchedArchetypes?.clear) state.touchedArchetypes.clear();
}


  // Init
  dom.initialXPDisplay.textContent = `${playerExperience}`;
  renderAll();
function confirmLevelUp() {
  closeOpenHelpers();
  if (!entite) return console.warn('⚠️ [confirmLevelUp] Entité manquante');

  const previewStats = entite.modifierStats?.preview?.statLeveled;
  normalizeStatModifierMapInPlace(previewStats);
  if (!previewStats || Object.keys(previewStats).length === 0) {
    console.log(`ℹ️ [confirmLevelUp] Aucune preview à confirmer pour ${entite.name}`);
    return;
  }

  const experienceSpent = Math.max(0, Number(state.xpBaseline) - Number(state.tempXP));
  const payment = spendPlayerExperience(experienceSpent);
  if (!payment) {
    window.alert('XP insuffisante. Annulez la prévisualisation ou réactivez le mode admin.');
    return;
  }

  entite.modifierStats ??= {};
  entite.modifierStats.durable ??= { statLeveled: {} };
  entite.modifierStats.durable.statLeveled ??= {};

  ComputeStatPreview(entite);
  const confirmedGenerated = structuredClone(
    entite.modifierStats?.preview?.generated || {}
  );
  const statsBeforeConfirm = structuredClone(entite.stats || {});
  removeGeneratedStatsFromPreviewLeveled(entite);

  for (const [key, val] of Object.entries(previewStats)) {
    if (PREVIEW_GENERATED_ONLY_KEYS.has(key) && !STAT_SYSTEM_ORIGINS[key]) continue;
    if (isZeroPreviewDelta(val)) continue;

    if (isObjStat(val)) {
      entite.modifierStats.durable.statLeveled[key] =
        addObj(entite.modifierStats.durable.statLeveled[key], val);
      continue;
    }

    entite.modifierStats.durable.statLeveled[key] =
      (Number(entite.modifierStats.durable.statLeveled[key] ?? 0) || 0) +
      Number(val ?? 0);
  }

  // 🧱 Incrément du niveau (respecte level.max propre à l’entité)
  const baseLevel = getEntityLevelCurrent(entite);
  const maxLevelForEntity = getEntityLevelMax(entite);
  const targetTempLevel = Math.min(state.tempLevel, maxLevelForEntity);
  const gainedLevels = targetTempLevel - baseLevel;

  if (gainedLevels > 0) {
    setEntityLevelCurrent(entite, baseLevel + gainedLevels);
    console.log(`⬆️ ${entite.name} gagne ${gainedLevels} niveau(x) → Niveau ${getEntityLevelCurrent(entite)}`);
  }

  markConfirmedLevelUpMeta(entite, getEntityLevelCurrent(entite));
  recomputeEntityStats(entite, { skipReverseArchetype: true });
  setEntityLevelCurrent(entite, targetTempLevel);
  markConfirmedLevelUpMeta(entite, getEntityLevelCurrent(entite));
  applyConfirmedGeneratedPoolDeltas(entite, confirmedGenerated);
  syncEntityLinkedEssenceInventory(entite);

  // ✅ Passe les icônes preview -> leveled
  document.querySelectorAll(`#archetype-icons-${entite.id} .archetype-icon.preview`)
    .forEach(icon => {
      const oldUid = icon.dataset.archetypeUid;
      icon.dataset.archetypeUid = oldUid.replace("preview-", "leveled-");
      icon.classList.remove("preview");
      icon.classList.add("leveled");
    });

  // ✅ Nettoyage preview
  delete entite.modifierStats.preview;

  // ✅ Retire upgraded partout
  document
    .querySelectorAll(`.stat-container[data-entity-id="${entite.id}"].upgraded`)
    .forEach(el => el.classList.remove('upgraded'));

  const saveState = snapshotLevelUpSaveState(state);
  saveState.tempLevel = getEntityLevelCurrent(entite);
  saveEntityLevelUP(entite, saveState, payment);
  refreshLevelUpStateAfterSave(state, entite);

  // ✅ Remet les valeurs d'attributs affichées
  for (const attribut of attributS) {
    const short = attribut.short;
    nodes.attributs[short].value.textContent = state.stats[attribut.key];
  }

  // ✅ Rerender stats
  if (typeof renderAllStats === 'function') {
    renderAllStats(entite, nodes.statsRoot);
  } else {
    Object.keys(entite.baseStats).forEach(k => renderStatPair(entite, k, nodes.statsRoot));
  }

  if (!awakeningPresentationPending) updateArchetypeBadge(state, nodes);
  updategraph(state, nodes);

  // ✅ HP counters + barres + compteur armure
  updateHPCounters(entite.id, entite.stats.HP.current, entite.stats.HP.max);
  updateHealthBar(
    entite.stats.HP.current,
    entite.stats.HP.max,
    entite.stats.armor?.current ?? 0,
    entite.stats.armor?.max ?? 0,
    entite.id
  );
  updateArmorCounter(entite);

  // (Optionnel mais logique si extraLife existe)
  updateBonusLifeCounters(entite);

  if (typeof window !== "undefined" && typeof window.refreshCodexUmbraPanel === "function") {
    window.refreshCodexUmbraPanel(entite, {
      oldStats: statsBeforeConfirm,
      newStats: entite.stats,
    });
  }

  removeNewStatClasses(entite);
  if (typeof updateExperienceDisplay === 'function') updateExperienceDisplay();
  renderAll();
  showStatGainsFromDiff(entite, statsBeforeConfirm);
}

}
 
function animateMilestone(jalonIndex, nodes) {
  const milestone = nodes.gauge.milestones.querySelector(
    `.milestone[data-index="${jalonIndex}"]`
  );
  if (!milestone) return;

  // Supprimons les anciens pulses éventuels
  milestone.querySelectorAll(".milestone-pulse").forEach(e => e.remove());

  // Ajoute le conteneur pulse
  const pulse = document.createElement("div");
  pulse.className = "milestone-pulse";
  milestone.appendChild(pulse);

  // Auto-suppression après animation
  setTimeout(() => {
    pulse.remove();
  }, 650); // légèrement > durée de l’animation
}

function updategraph(state, nodes) {
  const { strength, agility, intelligence } = state.stats;
  drawRealtimegraph(nodes.graphCtx, strength, agility, intelligence);

}
function updateArchetypeBadge(state, nodes) {
  if (!nodes.archetypeLabel) return;

  const entite = state.currentEntity;
  const { strength, agility, intelligence } = state.stats;
  const level = state.tempLevel ?? state.level ?? 1;

  // 👉 Seul vrai signal d’éveil : state.awakened
  const awakened = !!state.awakened;

  const keyLower = String(
    getClassFromAttributs(
      strength,
      agility,
      intelligence,
      level,
      awakened,   // tant que false → "egare"
      entite
    )
  ).trim().toLowerCase();

  const meta = CLASS_INDEX[keyLower];
  let name = meta?.name || "Égaré";

  // 🆕 Ajout / retrait de la classe .stray sur le graph container
  if (nodes.graphCtx?.canvas) {
    const graphContainer = nodes.graphCtx.canvas.closest('.attribut-graph-container');
    if (graphContainer) {
      if (keyLower === "egare") {
        graphContainer.classList.add("stray");
      } else {
        graphContainer.classList.remove("stray");
      }
    }
  }
  // --- fin du bloc ajouté ---

  const progress = state.archetypeProgress || {};
  const prog = progress[keyLower] || { level: 1, stage: 0 };
  const archLevel = Math.max(1, prog.level | 0);

  const prevValue = nodes.archetypeLabel.dataset.value || "";
  if (prevValue && prevValue !== name) {
    nodes.archetypeLabel.classList.add("changed");
    clearTimeout(nodes.archetypeLabel._changedTimeout);
    nodes.archetypeLabel._changedTimeout = setTimeout(() => {
      nodes.archetypeLabel.classList.remove("changed");
    }, 1500);
  }

  nodes.archetypeLabel.dataset.value = name;
  nodes.archetypeLabel.innerHTML = "";
  nodes.archetypeLabel.append(document.createTextNode(name));

  if (archLevel > 1) {
    const lvlSpan = document.createElement("span");
    lvlSpan.className = "arch-lvl-label";
    lvlSpan.textContent = " " + toRoman(archLevel);
    nodes.archetypeLabel.appendChild(lvlSpan);
  }

  if (nodes.archetypeDesc) {
    nodes.archetypeDesc.textContent = meta?.description || "";
  }
}

function updateArchetypeGauge(state, nodes) {
  if (!nodes.gauge) return;

  const entite = state.currentEntity;
  const level = state.tempLevel ?? state.level ?? 1;
  const awakened = !!state.awakened;

  const activeName = String(
    getClassFromAttributs(
      state.stats.strength,
      state.stats.agility,
      state.stats.intelligence,
      level,
      awakened,
      entite
    ) || ""
  ).trim().toLowerCase();

  const cycleLen = getCycleLenFor(activeName, entite);
  const prog = state.archetypeProgress[activeName] || { level: 1, stage: 0 };
  const nice = getClassLabel(activeName) || activeName;

  if (cycleLen === 0) {
    nodes.gauge.label.textContent = `${nice} — aucun cycle`;
    nodes.gauge.fill.style.width = '0%';
    return;
  }

  const clampedStage = Math.min(prog.stage, cycleLen);
  const pct = Math.round((clampedStage / cycleLen) * 100);

  nodes.gauge.label.textContent =
    `${nice} ${prog.level} — ${clampedStage}/${cycleLen} · ${pct}%`;

  nodes.gauge.fill.style.width = `${pct}%`;
}
function updateArchetypeMilestones(state, nodes) {
  if (!nodes.gauge?.milestones) return;

  const entite   = state.currentEntity;
  const level    = state.tempLevel ?? state.level ?? 1;
  const awakened = !!state.awakened;

  const activeName = String(
    getClassFromAttributs(
      state.stats.strength,
      state.stats.agility,
      state.stats.intelligence,
      level,
      awakened,
      entite
    ) || ""
  ).trim().toLowerCase();

  const cycle   = getCycleForKey(activeName, entite) || DEFAULT_CYCLE;
  const total   = cycle.length;
  const prog    = state.archetypeProgress[activeName] || { stage: 0, milestones: [] };
  const jalons  = getArchetypeMilestones(activeName, entite);

  const milestoneList = Array.isArray(prog.milestones) ? prog.milestones : [];

  // Keep mounted spheres and their animation timelines while levels are adjusted.
  const existingMilestones = new Map([...nodes.gauge.milestones.children]
    .map(el => [el.dataset.index, el]));

  jalons.forEach(j => {
    const el = existingMilestones.get(String(j.index)) || document.createElement("div");
    existingMilestones.delete(String(j.index));
    el.className = "milestone";
    el.dataset.index = j.index;
    el.querySelector('.gemme')?.remove();

    if (j.stageName) {
      const [nature, lvlStr] = j.stageName.split("-");
      if (nature) {
        el.classList.add(nature);
        if (lvlStr) el.classList.add(`${nature}-${lvlStr}`);
      }
	  // ✅ Shape selon la nature
if (nature === "utilitaire") el.classList.add("shape-round");
else if (nature === "defense") el.classList.add("shape-square");
else if (nature === "attaque") el.classList.add("shape-diamond");
    }

    if (j.level) el.classList.add(`lvl-${j.level}`);

    const stageNumber = j.index + 1;
    const pct = (stageNumber / total) * 100;
    el.style.left = `calc(${pct}% - 6px)`;
    let rewardAttribute = null;

    if (prog.stage >= stageNumber) {
      el.classList.add("filled");

      let attrClass = milestoneList[stageNumber - 1] || null;

      // fallback : on remonte dans l'historique courant si besoin
      if (!attrClass && state.history?.length) {
        const stepEvent = state.history
          .slice()
          .reverse()
          .find(h => h.archetypeKey === activeName && h.stage === stageNumber);

        if (stepEvent && stepEvent.short) {
          attrClass = attribut_SHORT_TO_NAME[stepEvent.short];
        }
      }

      if (attrClass) {
        rewardAttribute = attrClass;
        el.classList.add(attrClass);
        if (j.level !== 3) {
          const gem = document.createElement("div");
          gem.className = `gemme ${attrClass}`;
          el.appendChild(gem);
        }
      }

      if (prog.stage === stageNumber) {
        el.classList.add("last");
        setTimeout(() => el.classList.remove("last"), 1000);
      }
    }

    if (j.level === 3) {
      el.classList.add("has-essence-reward");
      const rewardColor = getMilestoneEssenceColor(rewardAttribute);
      updateMilestoneEssenceElement(el, rewardColor);
      el.dataset.essenceRewardColor = rewardColor || "neutral";
      el.title = buildMilestoneEssenceHelper(Boolean(rewardColor), { preview: true });
    } else {
      el.querySelector('.milestone-essence')?.remove();
      delete el.dataset.essenceRewardColor;
      el.removeAttribute('title');
    }
    if (el.parentElement !== nodes.gauge.milestones) nodes.gauge.milestones.appendChild(el);
  });
  existingMilestones.forEach(el => el.remove());
}

// ARCHETYPE LVLUP SAVE LOCALSTORAGE button CONFIRM 
function saveEntityLevelUP(entite, state, payment) {
  const completedBefore = countCompletedArchetypes(entite);
  const experienceSpent = Math.max(0, Number(state.xpBaseline ?? playerExperience) - (Number(state.tempXP) || 0));
  if (!payment) return false;
  entite.adminExperienceSpent = (Number(entite.adminExperienceSpent) || 0) + payment.admin;
  const hasManualArchetypeStep = (entry) => {
    if (!entry || !entry.key) return false;
    const step = Number(entry.step ?? entry.stage ?? 0) || 0;
    if (step > 0) return true;
    return Array.isArray(entry.milestone) && entry.milestone.some(Boolean);
  };

  const toStoredArchetypeEntry = (key, val) => {
    const step = Number(val.step ?? val.stage ?? 0) || 0;
    const milestonesArr = Array.isArray(val.milestone)
      ? val.milestone.slice(0, step)
      : Array.isArray(val.milestones)
        ? val.milestones.slice(0, step)
        : [];

    return {
      key: String(key ?? val.key ?? "").toLowerCase(),
      level: Number(val.level ?? 1) || 1,
      step,
      uid: val.uid || getArchetypeUID(),
      milestone: milestonesArr
    };
  };

  // 1️⃣ Appliquer les valeurs confirmées côté entité
  const maxLevelForEntity = getEntityLevelMax(entite);
  const targetLevel = Math.min(state.tempLevel, maxLevelForEntity);
  setEntityLevelCurrent(entite, targetLevel);
  entite.experience = Math.max(0, Number(entite.experience) || 0) +
    experienceSpent;
  playerExperience = getAvailablePlayerExperience();

  const confirmedStats = {
    strength: Number(state.stats?.strength ?? entite.stats?.strength ?? entite.baseStats?.strength ?? 0) || 0,
    agility: Number(state.stats?.agility ?? entite.stats?.agility ?? entite.baseStats?.agility ?? 0) || 0,
    intelligence: Number(state.stats?.intelligence ?? entite.stats?.intelligence ?? entite.baseStats?.intelligence ?? 0) || 0,
  };

  // 2️⃣ Classe réelle dérivée des attributs (en tenant compte de l'éveil)
  const currentLevel = getEntityLevelCurrent(entite);
  const realKey = String(
    getClassFromAttributs(
      confirmedStats.strength,
      confirmedStats.agility,
      confirmedStats.intelligence,
      currentLevel,
      !!state.awakened,
      entite
    )
  ).trim().toLowerCase();

  // 👉 Tant qu'on n’est PAS éveillé, l'archetype actif logique reste "egare"
  const activeName = state.awakened ? realKey : "egare";

  // Sécurité : s’assurer qu’il existe une entrée pour l’actif
  state.archetypeProgress ??= {};
  if (!state.archetypeProgress[activeName]) {
    state.archetypeProgress[activeName] = {
      level: 1,
      stage: 0,
      uid: getArchetypeUID(),
      milestones: []      // interne, pas stocké tel quel sur l’entité
    };
  }

  // 🔥 Ajout des uid / milestones manquants sur tous les archetypes en progression
  for (const [key, entry] of Object.entries(state.archetypeProgress)) {
    if (!entry.uid) entry.uid = getArchetypeUID();
    if (!Array.isArray(entry.milestones)) entry.milestones = [];
  }

  const ap = state.archetypeProgress[activeName];

  // 3️⃣ On part de ce qui existe éventuellement déjà sur l’entité
  const prevArch = entite.Archetype || {};
  let achieve = Array.isArray(prevArch.achieve) ? [...prevArch.achieve] : [];

  const mergeAchieve = (snap) => {
    if (!snap || !snap.key) return;

    const key   = String(snap.key).toLowerCase();
    const level = snap.level ?? 1;
    const step  = snap.step ?? snap.stage ?? 0;
    const uid   = snap.uid || getArchetypeUID();
    const milestoneArr = Array.isArray(snap.milestone) ? [...snap.milestone] : [];

    const storedSnap = { key, level, step, uid, milestone: milestoneArr };
    if (!hasManualArchetypeStep(storedSnap)) return;

    let existing = achieve.find(a => a.key === key && a.level === level);
    if (!existing) {
      achieve.push(storedSnap);
    } else {
      if (!existing.uid) existing.uid = uid;
      if ((step | 0) > (existing.step | 0)) {
        existing.step = step;
      }
      if (!Array.isArray(existing.milestone) || !existing.milestone.length) {
        existing.milestone = milestoneArr;
      }
    }
  };

  // 4️⃣ Hydrate depuis les snapshots de cycles terminés
  if (state.egareCycleSnapshot) {
    mergeAchieve(state.egareCycleSnapshot);
  }
  if (Array.isArray(state.achievedArchetypes)) {
    state.achievedArchetypes.forEach(mergeAchieve);
  }

  achieve = achieve
    .filter(hasManualArchetypeStep)
    .map(entry => toStoredArchetypeEntry(entry.key, entry));

  // 5️⃣ Construction d’inProgress : uniquement les archétypes ayant reçu
  // au moins un point manuel de level-up. Un basculement par stuff reste
  // visible en current, mais ne crée pas d'historique gratuit.
  let inProgress = Object.entries(state.archetypeProgress)
    .map(([key, val]) => toStoredArchetypeEntry(key, val))
    .filter(hasManualArchetypeStep);

  // current = archetype actif
  const current = toStoredArchetypeEntry(activeName, ap);

  // Si current a vraiment reçu un point, il appartient aussi à l'historique.
  // Sinon il reste un état effectif pur, typiquement obtenu par équipement.
  if (hasManualArchetypeStep(current)) {
    const idxCurrent = inProgress.findIndex(e =>
      e.key === current.key &&
      e.level === current.level
    );
    if (idxCurrent === -1) {
      inProgress.push({ ...current });
    } else {
      inProgress[idxCurrent] = { ...current };
    }
  }

  // 7️⃣ Affectation finale sur l’entité
  entite.Archetype = { current, inProgress, achieve };

  // 8️⃣ Nettoyage ancien format
  delete entite.archetype;
  delete entite.currentArchetype;
  delete entite.archetypeKey;

  // 9️⃣ Recalcul complet des stats définitives
  markConfirmedLevelUpMeta(entite, targetLevel);
  recomputeEntityStats(entite, { skipReverseArchetype: true });
  setEntityLevelCurrent(entite, targetLevel);
  markConfirmedLevelUpMeta(entite, getEntityLevelCurrent(entite));
  syncEntityLinkedEssenceInventory(entite);

  // 🔟 Sauvegarde locale + synchro des copies vivantes
  recordEntityProgression(entite, { experienceSpent, completedBefore });
  persistConfirmedLevelUpEntity(entite);

  // 1️⃣1️⃣ Réinitialisation de l’état temporaire
 if (state.touchedArchetypes?.clear) state.touchedArchetypes.clear();
  state.history    = [];
  state.investedXP = 0;
  state.tempLevel  = getEntityLevelCurrent(entite);

  state.awakened = entite.archetypeFrozen !== true && !!(
    entite.Archetype?.current &&
    entite.Archetype.current.key &&
    entite.Archetype.current.key !== "egare"
  );

  state.egareCycleSnapshot = null;

  if (entite.modifierStats?.preview) {
    entite.modifierStats.preview.statLeveled = {};
  }
}



// 🔁 Timeouts par entité
const extasisTimeoutsByEntity = new Map();

// Petit helper anti-cache
function noCacheSrc(path) {
  const salt = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${path}?v=${salt}`;
}

function clearExtasisForEntity(entite) {
  if (!entite || !entite.id) return;

  const soulSection = document.getElementById(`soul-section-${entite.id}`);
  if (soulSection) {
    soulSection.querySelectorAll('.awakening-frame-pending')
      .forEach(el => el.classList.remove('awakening-frame-pending'));
    // On ne retire que les containers d'animation
    soulSection
      .querySelectorAll('.awakening-animation-container')
      .forEach(el => el.remove());
  }

  const timeouts = extasisTimeoutsByEntity.get(entite.id) || [];
  timeouts.forEach(id => clearTimeout(id));
  extasisTimeoutsByEntity.delete(entite.id);
}

export function playAwakeningExtasis(entite, { onReveal } = {}) {
  if (!entite || !entite.id) return;

  const soulSection = document.getElementById(`soul-section-${entite.id}`);
  if (!soulSection) return;

  // Nettoie toute ancienne animation pour CETTE entité
  clearExtasisForEntity(entite);

  // Container dédié à l’animation (seul élément supprimé à la fin)
  const wrapper = document.createElement('div');
  wrapper.className = 'awakening-animation-container';
  soulSection.appendChild(wrapper);

  const timeouts = [];
  const graphContainer = soulSection.querySelector('.attribut-graph-container');
  if (graphContainer) {
    graphContainer.classList.add('awakening-frame-pending');
    timeouts.push(setTimeout(() => {
      if (!wrapper.isConnected) return;
      graphContainer.classList.remove('awakening-frame-pending');
      onReveal?.();
    }, 4000));
  }

  // 1) Premier GIF immédiatement (avec anti-cache)
  const gif1 = document.createElement('img');
  gif1.src = noCacheSrc('./media/assets/effects/extase-01.gif');
  gif1.className = 'extasis intro';
  wrapper.appendChild(gif1);

  // 2) Deuxième GIF très vite après (avec anti-cache)
  const timeoutSecondGif = setTimeout(() => {
    if (!wrapper.isConnected) return;

    const gif2 = document.createElement('img');
    gif2.src = noCacheSrc('./media/assets/effects/extase-02.gif');
    gif2.className = 'extasis end';
    wrapper.appendChild(gif2);
  }, 1);
  timeouts.push(timeoutSecondGif);

  // 3) Fin de l’animation : on enlève UNIQUEMENT le wrapper
  const timeoutRemoveAll = setTimeout(() => {
    clearExtasisForEntity(entite);
  }, 7000); // 7 s au total
  timeouts.push(timeoutRemoveAll);

  extasisTimeoutsByEntity.set(entite.id, timeouts);
}
