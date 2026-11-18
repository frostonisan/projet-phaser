import { effectProvenance } from './effectRules.js';
import { evaluateAttackEffect } from './effectParameters.js';
import { getAttackEffect } from './data/attackEffects.js';
import { getActionElapsed, getMovementElapsed, getPhaseElapsed, isEntityActionPaused, isEntityMovementBlocked } from './entityControl.js';
import { removeCombatVisualAfter } from './combatClock.js';
import { setTimeout, requestAnimationFrame, clockNow } from './combatClock.js';
import { combatNow, combatDelay, deferCombatDeath } from './combatTimeline.js';
import { gameStorage as localStorage } from './sessionStorage.js';
import { cachedResourceUrl } from "./data/loaderList.js";
import { consumeFadedLife, consumeRechargeableLife } from './items/resourceStocks.js';
import {
  createAttackStatView,
  toNumber,
  attemptAttackerDamages,
  attemptIndestructibility,
  attemptEsoterism,
  attemptAstrality,
  attemptBloodFuryExec,
  calculateBloodFuryTargetThreshold,
  calculateBloodFuryExecutionPercent,
  attemptCriticalHit,
  attemptResilience,
  attemptAlterationResistance, isAlterationEffect, isHindranceEffect,
  attemptResilienceCritReduction, reduceCriticalSupplement, prepareResilienceEffect,
  calculateExtraLifeResurrect,
  attemptTranscendenceConsoProtection,
  calculateRangeRatio,
  caluclateIndestructibilityReductionTotal,
  calculateEsoterismtotalReduction,
  calculateMysticismTotalDamageBonus,
  calculateOccultismShadowFragilityPercent,
  calculateResilienceCritTotalBonus,
  calculateResilienceAlterationTotalBonus,
} from "./damagesCalcul.js";
import { checkGameOver, OrderEntity} from './gameState.js';
import {
  entites,
  calculateResistances,
  getBloodThirstyPercent,
  updateEternalLifeRegenOrders,
  updateExtraLifeRegenOrders,
  ensureExtraLifeRegen,
  ensureEternalLifeRegen,
} from "./entites.js";
import {
  updateTimerDisplay,
  updateKillsCounter,
  updateTotalDamageCounter,
  PopUpDamages,
  updateTotalHealCounter,
  updateScore,
  deductScore,
} from "./dom.js";
import { updateHealthBar, updateHPCounters } from './UpgradeEntity.js';
import {
  EffectMessage, blocksAstralSpell, startAstralReturn,
  toggleEffectClass,
  poison,
  brulure,
  heal,
  rez,
  lifesteal,
  LifestealBloodFury,
  showHealingFeedback,
  applyAttackNatureEffect,
  clearCombatEffects, grab, lourdeur, gigantisme, statModifier, immobilisation, stun, silence, interruption, bafouillage, lenteur, folie, confusion, charme, insolence, effroi, sommeil, wakeFromDamage,
  withSleepImpact, deferSleepImpactEffect as deferCombatEffect,
} from "./attackEffectMecanics.js";
import { summonJarret, summonProfanation } from './summonsMecanics.js';
import { attackEffects } from './data/attackEffects.js';
import { attackDetails } from './data/attackList.js';
import { updateCombatantRoleIndex, updateCombatantTargetZones } from './load-entity.js';
import { entiteCamp } from './fight.js'; 
import { saveToLocalStorage, loadFromLocalStorage, isAdminMode } from './GameStorage.js';
import {
  updateEntityStatusInStorage,
  saveEntityHPToStorage,
  saveEntityCombatTotals,
  recordEntityCombatStat,
  recordEntityDamageDetails,
  recordEntityDamageReceived,
  recordEntityHealingDone,
  recordEntityHealingReceived,
  recordEntityCombatProc,
  saveEntityextraLifeToStorage,
  saveEntityfadedLifeToStorage,
  saveEntityEternalLifeToStorage,
  saveEntityEternalLifeRegenToStorage,
  saveEntityExtraLifeRegenToStorage,
  saveEntityArmorState,
  recordEntityDefenseHp,
  recordEntityLifeUsed,
  recordEntityKill,
  recordInertResistance,
} from "./entityUpdatesStorage.js";
import {
  updateSpriteUI,
  damageImpact,
  damageArmorImpact,
  shakeImpact,
  brokenMagicImpact,
  applyEntityTint,
  releaseEntityTint,
  renderEntityTint,
  animateRecuperation,
} from "./entitesAnimation.js";
import { getSafe, getBattleEntityElement } from "./entite/entityRules.js";
import {
  createExtraLifeCounter,
  createArmorCounter,
  createFadedLifeCounter,
  stabilizeDeadEntityVisual,
} from "./createEntity.js";
import {
  getAttackResolutionFlags,
  getAttackNatureRules,
  resolveAttackDefinitionForEntity,
} from "./attackResolution.js";
import { balanceData } from './data/balanceData.js';
import { consumeEntityArmor } from "./items/armor.js";
import { battleLogs } from './battleLogs.js';
import { syncEntityAuras, cleanupEntityAuras } from "./entitesAura.js";
import { createCorpseLoot } from './loot.js';

const ADMIN_INVINCIBLE_MODE_STORAGE_KEY = 'DarkPitAdminInvincibleMode';

function isAdminInvincibleModeEnabled() {
  return isAdminMode() && window.levelRunning === 'admin'
    && (
      window.__adminInvincibleMode === true
      || localStorage.getItem(ADMIN_INVINCIBLE_MODE_STORAGE_KEY) === 'true'
    );
}

function restoreAdminInvincibleEntity(entite) {
  const maxHP = Math.max(1, Number(entite.stats.HP.max ?? 0) || 1);
  entite.stats.HP.current = maxHP;
  entite.isDEAD = false;
  entite.statut = ['alive'];
  entite.hasDeathBeenLogged = false;
  entite.hasAlreadyDeadBeenLogged = false;

  const armorCur = entite.stats?.armor?.current ?? 0;
  const armorMax = entite.stats?.armor?.max ?? 0;
  saveEntityHPToStorage(entite);
  updateEntityStatusInStorage(entite);
  updateHealthBar(maxHP, maxHP, armorCur, armorMax, entite.id, 0);
  updateHPCounters(entite.id, maxHP, maxHP);
  updateBonusLifeCounters(entite);
}

// LIFE AND DEATH
// Intégrez l'appel de cette fonction dans votre fonction LifeandDeath
export function LifeandDeath(entite, attacker = null, { summonOrigin } = {}) {
  if (deferCombatDeath(entite, () => LifeandDeath(entite, attacker, { summonOrigin }), Boolean(attacker))) return;
  if (!entite?.stats?.HP) return;

  const statutArr = Array.isArray(entite.statut) ? entite.statut : [];
  const wasDead  = statutArr.includes("dead");
  const wasAlive = statutArr.includes("alive");
  const hpCur = Number(entite.stats.HP.current ?? 0) || 0;

  // Si HP <= 0, les mécaniques de survie passent TOUJOURS avant la mort.
  // Ne jamais retourner sur la seule base de statut/isDEAD/ancien log : ces
  // marqueurs peuvent avoir été posés avant cet appel ou provenir du stockage.
  if (hpCur <= 0) {
    if (isAdminInvincibleModeEnabled()) {
      restoreAdminInvincibleEntity(entite);
      console.log(`🛡️ Mode invincible admin : ${entite.name} récupère tous ses HP.`);
      return;
    }

    const targetElement = getBattleEntityElement(entite);

    // 1.a) Cas resurrected (flag DOM)
    if (targetElement?.classList.contains("resurrected")) {
      rez(entite, attacker);
      entiteCamp(entites);
      targetElement.classList.remove("resurrected");

      // Une résurrection ouvre un nouveau cycle de vie/mort.
      entite.hasDeathBeenLogged = false;
      entite.hasAlreadyDeadBeenLogged = false;

      // UI (le rez peut déjà le faire, mais là tu garantis la synchro)
      updateBonusLifeCounters(entite);
      updateHPCounters(entite.id, entite.stats.HP.current ?? 0, entite.stats.HP.max ?? 0);

      return;
    }

    // 1.b) fadedLife (prioritaire, détruite définitivement)
if (attemptExtraLife(entite, { pool: "fadedLife", destroyOnUse: true })) {
  battleLogs("extra_life_used", {
    entity: entite,
    lifeType: "fadedLife",
    hpRestored: entite.stats.HP.current
  });

  updateBonusLifeCounters(entite);
  return;
}
    // 1.c) extraLife (réutilisable, max ne bouge pas)
if (attemptExtraLife(entite, { pool: "extraLife", destroyOnUse: false })) {
  battleLogs("extra_life_used", {
    entity: entite,
    lifeType: "extraLife",
    hpRestored: entite.stats.HP.current
  });

  updateBonusLifeCounters(entite);
  return;
}
// 1.d) eternalLife
if (attemptExtraLife(entite, { pool: "eternalLife", destroyOnUse: false })) {
  battleLogs("extra_life_used", {
    entity: entite,
    lifeType: "eternalLife",
    hpRestored: entite.stats.HP.current
  });

  updateBonusLifeCounters(entite);
  return;
}

// L'entité était déjà un cadavre finalisé et aucune nouvelle vie n'est prête.
// On garde l'appel idempotent, mais seulement APRÈS les tentatives de survie.
if (wasDead && entite.isDEAD === true && entite.hasDeathBeenLogged === true) {
  entite.stats.HP.current = 0;
  updateHPCounters(entite.id, 0, entite.stats.HP.max ?? 0);
  updateBonusLifeCounters(entite);
  const deadCanvas = document.getElementById(`spriteCanvas_${entite.id}`);
  if (!deadCanvas?.classList.contains("dead-sprite")) {
    CreateDeadSprite(entite, { playDeathBlood: false });
  }
  createCorpseLoot(entite);
  return;
}

// Mort définitive : aucune réserve de vie n'a pu être consommée.
if (entite.flags?.bloodCrazyNextExecution) {
  consumeBloodCrazy(entite);
}

entite.isDEAD = true;
clearCombatEffects(entite);
entite.statut = ["dead"];
entite.stats.HP.current = 0;
if (attacker && String(attacker.id) !== String(entite.id) && !entite.hasDeathBeenLogged) {
  recordEntityKill(attacker, summonOrigin);
  updateKillsCounter(`Kills_${attacker.id}`, attacker.kills);
}
if (!entite.hasDeathBeenLogged) {
  recordEntityCombatStat(entite, 'deaths');
  battleLogs("entity_death", { entity: entite });
  entite.hasDeathBeenLogged = true;
}
    console.log(`${entite.name} est mort pour de bon (plus de vies).`);
    updateEntityStatusInStorage(entite);

    // UI
    const armorCur = entite.stats?.armor?.current ?? 0;
    const armorMax = entite.stats?.armor?.max ?? 0;

    updateHealthBar(0, entite.stats.HP.max ?? 0, armorCur, armorMax, entite.id, 0);
    updateHPCounters(entite.id, 0, entite.stats.HP.max ?? 0);
    updateBonusLifeCounters(entite);

    cleanupEntityAuras(entite);
    CreateDeadSprite(entite);
    createCorpseLoot(entite);

    // Une mort individuelle ne stoppe pas le combat. La résolution centrale décide
    // immédiatement si cette mort termine réellement le combat.
    checkGameOver(entites);
    updateCombatantRoleIndex();
    updateCombatantTargetZones();
    return;
  }

  // 2) Encore vivant
  entite.isDEAD = false;

  if (!wasAlive) {
    entite.statut = ["alive"];
    console.log(`${entite.name} est toujours en vie.`);
    updateEntityStatusInStorage(entite);
  }

  // UI : resync compteur (optionnel, mais propre)
  updateBonusLifeCounters(entite);

  // Réinit visuelle
  const sprite = document.getElementById(`sprite_${entite.id}`);
  const battleEntityElement = getBattleEntityElement(entite);

  if (sprite) {
    sprite.classList.remove("dead", "hbox");
    sprite.classList.add("hb");
  }
  if (battleEntityElement) {
    battleEntityElement.classList.remove("dead", "hbox");
  }
}


function getLifePoolCurrent(raw) {
  const value = raw && typeof raw === "object" ? raw.current : raw;
  return Math.max(0, Number(value ?? 0) || 0);
}

function consumeLifePool(entite, key, { destroyOnUse = false } = {}) {
  if (!entite?.stats) return false;

  if (key === "fadedLife") {
    const raw = entite.stats.fadedLife;
    const cur = getLifePoolCurrent(raw);
    if (cur <= 0) return false;

    // ✅ Protection Transcendance : résurrection OK, pas de conso (avec FX)
    if (attemptTranscendenceConsoProtection(entite)) {
      return true;
    }

    if (!consumeFadedLife(entite)) return false;

    saveEntityfadedLifeToStorage(entite);

    return true;
  }

  if (key === "extraLife") {
    const cur = getLifePoolCurrent(entite.stats.extraLife);
    if (cur <= 0) return false;

    // ✅ Protection Transcendance : résurrection OK, pas de conso (avec FX)
    if (attemptTranscendenceConsoProtection(entite)) {
      return true;
    }

    const ok = extraLifeConsumption(entite);

    return ok;
  }

  if (key === "eternalLife") {
    const cur = getLifePoolCurrent(entite.stats.eternalLife);
    if (cur <= 0) return false;

    // ✅ Protection Transcendance : résurrection OK, pas de conso (avec FX)
    if (attemptTranscendenceConsoProtection(entite)) {
      return true;
    }

    const ok = eternalLifeConsumption(entite);

    return ok;
  }

  return false;
}

const DEFAULT_VFX_BY_POOL = {
  extraLife: "./media/assets/effects/life.gif",
  fadedLife: "./media/assets/effects/fadedlife.gif",
  eternalLife: "./media/assets/effects/eternallife.gif",
};

// ✅ Par défaut : extraLife est dynamique (20% + INT%) via calculateExtraLifeResurrect()
const DEFAULT_HEAL_RATIO_BY_POOL = {
  fadedLife: 0.50,   // 50%
  eternalLife: 1.00, // 100%
  extraLife: (entite) => {
    // totalPercent = 20 + (INT * 1)
    const { totalPercent } = calculateExtraLifeResurrect(entite, {
      basePercent: 20,
      perIntel: 1
    });
    return totalPercent / 100;
  }
};

function resolveHealRatio({ entite, pool, healRatio, healRatioByPool }) {
  // 1) override ponctuel
  if (typeof healRatio === "number") return healRatio;

  const entry = healRatioByPool?.[pool];

  // 2) entrée dynamique
  if (typeof entry === "function") return entry(entite);

  // 3) entrée statique
  if (typeof entry === "number") {
    // si quelqu’un force un number pour extraLife, on respecte,
    // mais tu peux supprimer ce "if" si tu veux extraLife toujours dynamique.
    return entry;
  }

  // 4) fallback solide : si extraLife et pas défini, on calcule quand même
  if (pool === "extraLife") {
    const { totalPercent } = calculateExtraLifeResurrect(entite, {
      basePercent: 20,
      perIntel: 1
    });
    return totalPercent / 100;
  }

  // 5) fallback final
  return DEFAULT_HEAL_RATIO_BY_POOL?.[pool] ?? 0;
}

export function attemptExtraLife(entite, {
  pool = "extraLife",
  destroyOnUse = false,

  healRatioByPool = DEFAULT_HEAL_RATIO_BY_POOL,
  healRatio,

  vfxByPool = DEFAULT_VFX_BY_POOL,
  vfxDuration = 1000
} = {}) {

  const lifeBefore = getLifePoolCurrent(entite?.stats?.[pool]);
  if (!consumeLifePool(entite, pool, { destroyOnUse })) return false;
  if (getLifePoolCurrent(entite?.stats?.[pool]) < lifeBefore) {
    recordEntityLifeUsed(entite, pool);
  }

  // ✅ ratio effectif (nombre ou fonction)
  const rawRatio = resolveHealRatio({ entite, pool, healRatio, healRatioByPool });

  // ✅ sécurités
  const maxHP = Number(entite?.stats?.HP?.max ?? 0) || 0;
  const ratio = Math.max(0, Math.min(1, Number(rawRatio) || 0));

  // Revive (au moins 1 HP si maxHP > 0)
  entite.stats.HP.current = maxHP > 0 ? Math.max(1, Math.ceil(maxHP * ratio)) : 0;
  saveEntityHPToStorage(entite);

  entite.isDEAD = false;
  entite.statut = ["alive"];
  // Si une vie a été obtenue après une mort finalisée, la prochaine mort doit
  // pouvoir être journalisée normalement.
  entite.hasDeathBeenLogged = false;
  entite.hasAlreadyDeadBeenLogged = false;
  updateEntityStatusInStorage(entite);

  // Synchroniser seulement APRÈS avoir restauré HP/isDEAD/statut.
  // Avant, syncEntityAuras voyait HP=0 et supprimait toutes les auras.
  syncEntityAuras(entite, "battle");
  syncEntityAuras(entite, "codex");

  // Log
  if (pool === "fadedLife") {
    const raw = entite.stats.fadedLife;
    const remain = Math.max(
      0,
      Number(typeof raw === "object" ? (raw?.current ?? 0) : (raw ?? 0)) || 0
    );
    console.log(`${entite.name} consomme une fadedLife (reste ${remain}) et revient avec ${entite.stats.HP.current} HP.`);
  } else if (pool === "eternalLife") {
    const cur = entite.stats?.eternalLife?.current ?? 0;
    const max = entite.stats?.eternalLife?.max ?? 0;
    console.log(`${entite.name} consomme une eternalLife (${cur}/${max}) et revient avec ${entite.stats.HP.current} HP.`);
  } else {
    const cur = entite.stats?.extraLife?.current ?? 0;
    const max = entite.stats?.extraLife?.max ?? 0;
    console.log(`${entite.name} consomme une extraLife (${cur}/${max}) et revient avec ${entite.stats.HP.current} HP.`);
  }

  // VFX auto selon pool + anti-cache (inline)
  const baseSrc =
    (vfxByPool && vfxByPool[pool]) ||
    (vfxByPool && vfxByPool.extraLife) ||
    DEFAULT_VFX_BY_POOL.extraLife;

  const cacheBuster = `nc=${clockNow()}_${Math.random().toString(16).slice(2)}`;
  const vfxSrcToUse = baseSrc + (baseSrc.includes("?") ? "&" : "?") + cacheBuster;

  let effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);
  if (!effectsContainer) {
    const parent = document.getElementById(`DragSprite_${entite.id}`);
    if (parent) {
      effectsContainer = document.createElement("div");
      effectsContainer.id = `effectsContainer_${entite.id}`;
      effectsContainer.className = "effects-container";
      parent.appendChild(effectsContainer);
    }
  }

  if (effectsContainer) {
    const lifeVFX = document.createElement("img");
    lifeVFX.src = cachedResourceUrl(vfxSrcToUse);
    lifeVFX.className = `effect-vfx life ${pool}`;
    lifeVFX.alt = `${entite.name} ressuscite !`;
    effectsContainer.appendChild(lifeVFX);
    removeCombatVisualAfter(lifeVFX, vfxDuration);
  }

  // UI
  const armorCur = entite.stats?.armor?.current ?? 0;
  const armorMax = entite.stats?.armor?.max ?? 0;

  updateHealthBar(entite.stats.HP.current, entite.stats.HP.max, armorCur, armorMax, entite.id, 0);
  updateHPCounters(entite.id, entite.stats.HP.current, entite.stats.HP.max);
  updateBonusLifeCounters(entite);

  return true;
}

export function updateBonusLifeCounters(entite) {
  if (!entite?.id) return;
  ensureExtraLifeCounter(entite);
  ensureFadedLifeCounter(entite);

  const id = entite.id;

  // ---- fadedLife (nombre, legacy objet toléré) ----
  const rawF = entite?.stats?.fadedLife;
  const faded = Math.max(
    0,
    Number(typeof rawF === "object" ? (rawF?.current ?? 0) : (rawF ?? 0)) || 0
  );

  const fadedContainers = document.querySelectorAll(`.fadedLife-counter[data-entity-id="${id}"]`);
  const fadedValues     = document.querySelectorAll(`.fadedLife-value[data-entity-id="${id}"]`);

  fadedContainers.forEach(node => {
    node.style.display = faded > 0 ? "" : "none";
  });
  fadedValues.forEach(node => {
    node.textContent = faded > 0 ? `: ${faded}` : "";
  });

// ---- eternalLife (objet {current,max}) ----
const et = entite?.stats?.eternalLife;
const etCurrent = et && typeof et === "object" ? (Number(et.current ?? 0) || 0) : 0;
const etMax     = et && typeof et === "object" ? (Number(et.max ?? 0) || 0) : 0;

const showEternal = etMax > 0;

const eternalContainers = document.querySelectorAll(`.eternalLife-counter[data-entity-id="${id}"]`);
const eternalValues     = document.querySelectorAll(`.eternalLife-value[data-entity-id="${id}"]`);

eternalContainers.forEach(node => {
  node.style.display = showEternal ? "" : "none";
});

eternalValues.forEach(node => {
  node.textContent = showEternal ? `: ${etCurrent}/${etMax}` : "";
});

  // ---- extraLife (objet {current,max} ; tolérance si nombre) ----
  const ex = entite?.stats?.extraLife;
  const exCurrent =
    ex && typeof ex === "object" ? (Number(ex.current ?? 0) || 0) :
    (typeof ex === "number" ? ex : 0);

  const exMax =
    ex && typeof ex === "object" ? (Number(ex.max ?? 0) || 0) : 0;

  const showExtra = exCurrent > 0 || exMax > 0;

  const extraContainers = document.querySelectorAll(`.extraLife-counter[data-entity-id="${id}"]`);
  const extraValues     = document.querySelectorAll(`.extraLife-value[data-entity-id="${id}"]`);

  extraContainers.forEach(node => {
    node.style.display = showExtra ? "" : "none";
  });

  extraValues.forEach(node => {
    if (!showExtra) {
      node.textContent = "";
      return;
    }
    if (exMax > 0) node.textContent = `: ${exCurrent}/${exMax}`;
    else node.textContent = `: ${exCurrent}`;
  });
  document.querySelectorAll('.codex-colomn-5[data-entity-id]').forEach(column => {
    if (column.dataset.entityId === String(id)) column._refreshLives?.(entite);
  });
  syncEntityAuras(entite, 'battle', { lifeOnly: true });
  syncEntityAuras(entite, 'codex', { lifeOnly: true });
}
function getLifeCounterContainer(entite) {
  return document.querySelector(`.life-bar-counter[data-entity-id="${entite.id}"]`);
}

// ---- ARMOR ----
function ensureArmorCounter(entite) {
  if (!entite?.id) return null;

  const id = entite.id;

  // Si le counter existe déjà, on le récupère.
  // Attention : il peut être au mauvais endroit, donc on ne return pas tout de suite.
  let node = document.querySelector(`.armor-counter[data-entity-id="${id}"]`);

  // ✅ Exception Codex :
  // Dans le codex, armor-counter doit être enfant direct de .codex-entite-infos,
  // placé avant .headsup-HP-container.
  const codexInfos = document
    .querySelector(
      `.codex-entite-infos #headsup-HP-container_${id},
       .codex-entite-infos .headsup-HP-container[data-entity-id="${id}"]`
    )
    ?.closest(".codex-entite-infos");

  if (codexInfos) {
    if (!node) {
      node = createArmorCounter(entite);
      if (!node) return null;
    }

    node.classList.add("hu");
    node.dataset.stat = "armor";
    node.dataset.entityId = id;

    const hpContainer = codexInfos.querySelector(
      `#headsup-HP-container_${id},
       .headsup-HP-container[data-entity-id="${id}"]`
    );

    if (node.parentElement !== codexInfos) {
      if (hpContainer) codexInfos.insertBefore(node, hpContainer);
      else codexInfos.appendChild(node);
    }

    return node;
  }

  // ✅ Cas normal : combat / HUD
  const wrap = getLifeCounterContainer(entite);
  if (!wrap) return node;

  // Si déjà dans le bon wrap, rien à faire
  if (wrap.querySelector(`.armor-counter[data-entity-id="${id}"]`)) {
    return wrap.querySelector(`.armor-counter[data-entity-id="${id}"]`);
  }

  if (!node) {
    node = createArmorCounter(entite);
    if (!node) return null;
  }

  node.classList.add("hu");
  node.dataset.stat = "armor";
  node.dataset.entityId = id;

  // insertion après HP si possible
  const hpNode = wrap.querySelector(`.HP-counter[data-entity-id="${id}"]`);

  if (hpNode) {
    hpNode.insertAdjacentElement("afterend", node);
  } else {
    wrap.prepend(node);
  }

  return node;
}

export function updateArmorCounter(entite) {
  if (!entite?.id) return;

  ensureArmorCounter(entite);

  const id = entite.id;
  const currentArmor = entite?.stats?.armor?.current ?? 0;
  const show         = currentArmor > 0;

  document.querySelectorAll(`.armor-counter[data-entity-id="${id}"]`).forEach(node => {
    node.style.display = show ? "" : "none";
    if (show) node.textContent = `🛡️ ${currentArmor}`;
  });
}
export function extraLifeConsumption(entite) {
  ensureExtraLifeRegen(entite, entite.stats?.extraLife);
  updateExtraLifeRegenOrders(entite);
  if (!consumeRechargeableLife(entite, 'extraLife')) return false;
  saveEntityextraLifeToStorage(entite);
  saveEntityExtraLifeRegenToStorage(entite);
  return true;
}

export function eternalLifeConsumption(entite) {
  ensureEternalLifeRegen(entite, entite.stats?.eternalLife);
  updateEternalLifeRegenOrders(entite);
  if (!consumeRechargeableLife(entite, 'eternalLife')) return false;
  saveEntityEternalLifeToStorage(entite);
  saveEntityEternalLifeRegenToStorage(entite);
  return true;
}


// ---- EXTRA LIFE ----
function ensureExtraLifeCounter(entite) {
  const wrap = getLifeCounterContainer(entite);
  if (!wrap) return;

  const id = entite.id;
  if (wrap.querySelector(`.extraLife-counter[data-entity-id="${id}"]`)) return;

  const node = createExtraLifeCounter(entite); // ✅ réutilise ta factory
  if (!node) return; // extraLife pas encore "showable"

  // Order : avant fadedLife si déjà présent
  const fadedNode = wrap.querySelector(`.fadedLife-counter[data-entity-id="${id}"]`);
  if (fadedNode) wrap.insertBefore(node, fadedNode);
  else wrap.appendChild(node);
}

// ---- FADED LIFE ----
function ensureFadedLifeCounter(entite) {
  const wrap = getLifeCounterContainer(entite);
  if (!wrap) return;

  const id = entite.id;
  if (wrap.querySelector(`.fadedLife-counter[data-entity-id="${id}"]`)) return;

  const node = createFadedLifeCounter(entite); // ✅ réutilise ta factory
  if (!node) return; // fadedLife pas encore "showable"

  wrap.appendChild(node);
}

export function loadEntitiesStatus() {
    const selectedArmy = loadFromLocalStorage('selectedArmyA', []);
    const enemyArmy = loadFromLocalStorage('ArmyB', []);

    const allEntities = [...selectedArmy, ...enemyArmy];

    allEntities.forEach(entite => {
		 entite.isInvincible = false; // Sécurité : toute entité redevient vulnérable au chargement
        let spriteElement = document.getElementById(`sprite_${entite.id}`);
        let targetElement = getBattleEntityElement(entite);

        if (entite.statut.includes("dead")) {
            console.log(`💀 ${entite.name} était mort, application du statut.`);
            spriteElement?.classList.add('dead', 'hbox');
            spriteElement?.classList.remove('hb');
            targetElement?.classList.add('dead', 'hbox');
        } else {
            console.log(`✨ ${entite.name} était vivant, mise à jour.`);
            spriteElement?.classList.remove('dead', 'hbox');
            spriteElement?.classList.add('hb');
            targetElement?.classList.remove('dead', 'hbox');
        }
    });

    console.log(`✅ Statut des entités rechargé.`);
}
export function CreateDeadSprite(entite, { playDeathBlood = true } = {}) {
    return stabilizeDeadEntityVisual(entite, { playDeathBlood });
}





//TIMER ATTAQUE ACTIVE ATTAQUANT
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}  // Fonction pour créer un délai.
function shouldUpdateAttackBar(phase) {
  // ✅ uniquement pendant la PREPARATION
  return phase === "preparationTime";
}

function resetAttackBar(attacker) {
  const bar = document.getElementById(`currentAttackBar_${attacker.id}`);
  if (!bar) return;

  bar.style.transition = "none";
  bar.style.width = "0%";
  void bar.offsetWidth; // paint 0%
  requestAnimationFrame(() => {
    bar.style.transition = "";
    bar.style.width = "0%";
  });
}

function updateAttackBarFromRemaining(attacker, phase, duration) {
  const bar = document.getElementById(`currentAttackBar_${attacker.id}`);
  if (!bar) return;

  const remaining = Math.max(0, Number(attacker[phase]) || 0);
  const dur = Math.max(1, Number(duration) || 1);
  const pct = Math.max(0, Math.min(1, 1 - remaining / dur));

  bar.style.width = `${(pct * 100).toFixed(2)}%`;
}

export async function runPhaseTimer(attacker, phase, duration, { canContinue = null } = {}) {
  const movementOrder = Boolean(attacker.orderPhase);
  const elapsed = movementOrder ? getMovementElapsed : (entity, from, to) => getPhaseElapsed(entity, from, to, phase);
  const blocked = movementOrder ? isEntityMovementBlocked : isEntityActionPaused;
  const saved = attacker._resumePhaseTimer?.phase === phase ? attacker._resumePhaseTimer : null;
  if (saved) delete attacker._resumePhaseTimer;
  const dur = saved?.duration ?? Math.max(1, Number(duration) || 1);
  let endTime = saved?.endTime ?? combatNow() + dur;
  let lastTick = saved?.lastTick ?? combatNow();
  const state = attacker._phaseTimer = { phase, duration: dur, endTime, lastTick, nextAt: saved?.nextAt };
  const interrupted = () => attacker._phaseTimer !== state || (canContinue && !canContinue()) || attacker.isDEAD
    || attacker.statut?.includes('dead') || Number(attacker.stats?.HP?.current) <= 0 || attacker.battleStopped;
  if (interrupted()) return false;

  // console.log(`Timer started for phase: ${phase}, duration: ${dur}ms`);

  // ✅ Initialisation propre du remaining dès le début
  attacker[phase] = Math.max(0, endTime - combatNow());
  updateTimerDisplay(attacker);

  // ✅ Barre: reset + premier affichage UNIQUEMENT si PREPARATION
  if (shouldUpdateAttackBar(phase)) {
    if (!saved) resetAttackBar(attacker);
    updateAttackBarFromRemaining(attacker, phase, dur);
  }

  while (true) {
    if (interrupted()) return false;
    const now = combatNow();
    endTime += now - lastTick - elapsed(attacker, lastTick, now);
    state.endTime = endTime; state.lastTick = lastTick = now;
    if (now >= endTime && !blocked(attacker, now)) break;

    // ✅ Update remaining AVANT le delay (évite le “préremplissage”)
    attacker[phase] = Math.max(0, endTime - combatNow());
    updateTimerDisplay(attacker);

    // ✅ Barre: UNIQUEMENT si PREPARATION
    if (shouldUpdateAttackBar(phase)) {
      updateAttackBarFromRemaining(attacker, phase, dur);
    }

    state.nextAt = state.nextAt > combatNow() ? state.nextAt : Math.max(combatNow() + 1, Math.min(endTime, combatNow() + 50));
    await combatDelay(Math.max(0, state.nextAt - combatNow()));
    state.nextAt = null;
  }

  // Fin
  if (interrupted()) return false;
  if (attacker._phaseTimer === state) delete attacker._phaseTimer;
  attacker[phase] = (phase === "speedTimer") ? attacker.baseSpeedTimer : 0;
  // console.log(`Timer for phase: ${phase} has finished.`);
  updateTimerDisplay(attacker);


  return;
}

export async function runEntityRecovery(attacker, duration, {
  canContinue = null,
  source = 'attack',
} = {}) {
  const recoveryDuration = Math.max(1, Number(duration) || 1);
  const attackBar = document.getElementById(`currentAttackBar_${attacker.id}`);
  const isTargetSearchRecovery = source === 'target-search';

  attacker.currentPhase = isTargetSearchRecovery
    ? 'target-search-recovery'
    : 'attack_5';
  attacker.maxRecoveryTime = recoveryDuration;
  attacker.recoveryTime = recoveryDuration;
  if (isTargetSearchRecovery) {
    attacker.speedTimer = 0;
    attacker.preparationTime = 0;
    attacker.executionTime = 0;
    attacker.isATBFull = false;
  }

  if (attackBar) {
    attackBar.style.width = isTargetSearchRecovery ? '0%' : '100%';
    attackBar.className = isTargetSearchRecovery ? 'attack-bar-fill empty' : 'attack-bar-fill recovery';
  }
  updateTimerDisplay(attacker);

  const stopRecoveryAnimation = animateRecuperation(attacker, isTargetSearchRecovery ? null : attacker.currentAttack || null);
  const recovery = runPhaseTimer(attacker, 'recoveryTime', recoveryDuration, { canContinue });
  const phaseState = attacker._phaseTimer;
  try {
    const completed = await recovery;
    return completed !== false;
  } finally {
    stopRecoveryAnimation?.();
    if ((!canContinue || canContinue()) && (!attacker._phaseTimer || attacker._phaseTimer === phaseState)) {
      attacker.recoveryTime = 0;
      if (attackBar) {
        attackBar.style.width = '0%';
        attackBar.className = 'attack-bar-fill empty';
      }
      updateTimerDisplay(attacker);
    }
  }
}



// detection armure
function hasActiveArmor(target) {
  return !!(target?.stats?.armor && target.stats.armor.current > 0);
}
const DEBUG_RESILIENCE = true;
function logResilienceReduction(target, percent, before, after, tickCtx) {
  if (!DEBUG_RESILIENCE) return;
  const safe = v => Math.max(0, Math.floor(v || 0));

  const B = {
    raw:  safe(before.piercingDamage),
    phys: safe(before.physical),
    magi: safe(before.magical),
    hybr: safe(before.hybridalDamage),
  };
  const A = {
    raw:  safe(after.piercingDamage),
    phys: safe(after.physical),
    magi: safe(after.magical),
    hybr: safe(after.hybridalDamage),
  };
  const d = {
    raw:  B.raw  - A.raw,
    phys: B.phys - A.phys,
    magi: B.magi - A.magi,
    hybr: B.hybr - A.hybr,
  };
  const totB = B.raw + B.phys + B.magi + B.hybr;
  const totA = A.raw + A.phys + A.magi + A.hybr;
  const totD = totB - totA;

  const tickLabel = tickCtx
    ? ` [tick ${tickCtx.index + 1}/${tickCtx.total}${
        typeof tickCtx.dealBefore === 'number' ? `, deal=${tickCtx.dealBefore}` : ''
      }]`
    : '';

  console.log(`⛨ [Résilience${tickLabel}] ${target.name} : -${percent}% (pré-résistances)`);
  console.log(
    `   • Raw: ${B.raw} → ${A.raw} (−${d.raw}) | ` +
    `Phys: ${B.phys} → ${A.phys} (−${d.phys}) | ` +
    `Magi: ${B.magi} → ${A.magi} (−${d.magi}) | ` +
    `Hybr: ${B.hybr} → ${A.hybr} (−${d.hybr})`
  );
  console.log(`   • Total: ${totB} → ${totA} (−${totD})`);
}

function applyMysticismBonusToSources(sources, attacker, currentAttack) {
    if (!currentAttack?.isLaunchedUnderMysticism) {
        return {
            sources,
            applied: false,
            bonusPercent: 0,
        };
    }

    const bonusPercent = calculateMysticismTotalDamageBonus(attacker);

    if (bonusPercent <= 0) {
        return {
            sources,
            applied: false,
            bonusPercent: 0,
        };
    }

    const bonusSources = {
        piercingDamage: Math.round((sources.piercingDamage || 0) * bonusPercent / 100),
        physical: Math.round((sources.physical || 0) * bonusPercent / 100),
        magical: Math.round((sources.magical || 0) * bonusPercent / 100),
        hybridalDamage: Math.round((sources.hybridalDamage || 0) * bonusPercent / 100),
    };

    return {
        sources: {
            piercingDamage: (sources.piercingDamage || 0) + bonusSources.piercingDamage,
            physical: (sources.physical || 0) + bonusSources.physical,
            magical: (sources.magical || 0) + bonusSources.magical,
            hybridalDamage: (sources.hybridalDamage || 0) + bonusSources.hybridalDamage,
        },
        applied: true,
        bonusPercent,
        bonusSources,
    };
}
// APPLYDAMAGES
//Éxécution → Armure → indestructibilité → Dégats Bruts + Résistances → Ésotérisme → Blood Fury → Dégâts appliqués sur HP → Astralité
export const normArr = v => Array.isArray(v) ? v : (v == null ? [] : [v]);

function combatDamageNature(attackDetail) {
  const derived = getAttackNatureRules(attackDetail).stat;
  if (derived !== 'neutral') return derived;
  return normArr(attackDetail?.attacknature).find(nature => [
    'physicalDamage', 'magicalDamage', 'transpiercingDamage', 'hybridalDamage',
    'physicalPiercingDamage', 'magicalPiercingDamage', 'hybridalPiercingDamage',
  ].includes(nature)) || derived;
}

function combatRangeFromFlags(flags) {
  return flags.isRange ? 'ranged' : 'melee';
}
// -------------------- FINAL LOG HELPERS --------------------
const snapSources = (s) => ({
  piercingDamage:      Math.round(s?.piercingDamage      || 0),
  physical:       Math.round(s?.physical       || 0),
  magical:        Math.round(s?.magical        || 0),
  hybridalDamage: Math.round(s?.hybridalDamage || 0),
});

const sumSources = (s) =>
  (s?.piercingDamage || 0) + (s?.physical || 0) + (s?.magical || 0) + (s?.hybridalDamage || 0);
function buildDamageResolutionBattleLog(ctx) {
  return {
    attacker: ctx.attackerFull || ctx.attacker,
    target: ctx.targetFull || ctx.target,
    attack: ctx.attack,

    damage: ctx.totals?.finalDamagePreAstrality ?? ctx.hp?.delta ?? 0,
    damageSources:
      ctx.sources?.afterOccultismFragility ||
      ctx.sources?.afterEsoterism ||
      ctx.sources?.afterResistances ||
      {},

    armorAbsorbed: ctx.armor?.absorbedByArmor || 0,

    armor: {
      absorbed: ctx.armor?.absorbedByArmor || 0,
    },

    modifiers: ctx.attackModifiers || {},

    effects: {
      applied: ctx.effectsApplied || [],
      self: ctx.selfEffects || [],
    },
  };
}
function logFinalDamageResolution(ctx) {
  const title =
    `📌 [FINAL] ${ctx.attacker?.name || "?"} → ${ctx.target?.name || "?"}` +
    ` | ${ctx.attack?.label || ctx.attack?.functionName || "attaque"}`;

  console.groupCollapsed(title);

  console.log("Attaque", ctx.attack);
  console.log("Entrée", ctx.input);

  if (ctx.execution?.attempted)      console.log("0) Exécution", ctx.execution);
  if (ctx.armor?.attempted)          console.log("1) Armure", ctx.armor);
  if (ctx.indestructible?.attempted) console.log("2) Indestructible", ctx.indestructible);

  console.log("3) Sources", ctx.sources);

  if (ctx.rangeRatio?.attempted) {
    console.log("3.5) RangeRatio", ctx.rangeRatio);
  }
  if (ctx.resilience?.attempted) {
    console.log("4) Résilience", ctx.resilience);
  }

  console.log("5) Résistances", ctx.resistances);

  if (ctx.esoterism?.attempted) console.log("6) Ésotérisme", ctx.esoterism);
  if (ctx.critical?.attempted) console.log("7) Critique", ctx.critical);

  console.log("8) Totaux", ctx.totals);
  console.log("9) PV", ctx.hp);

  console.log("PopUp", { popupType: ctx.popupType, popupContent: ctx.popupContent });
  console.log("Effets appliqués", ctx.effectsApplied || []);
  console.log("SelfEffects", ctx.selfEffects || []);
const hpDamage = ctx.hp?.delta || 0;
const armorAbsorbed = ctx.armor?.absorbedByArmor || 0;

const modifiers = ctx.attackModifiers || {};

const damageResolutionLog = buildDamageResolutionBattleLog(ctx);

if (
  damageResolutionLog.damage > 0 ||
  damageResolutionLog.armor.absorbed > 0 ||
  damageResolutionLog.modifiers.indestructible
) {
  battleLogs("damage_resolution", damageResolutionLog);
}
  console.groupEnd();
}
// ---------------APPLY DAMAGE----------------------

// Statistics-only replay: use resolved modifiers, never roll or apply an effect again.
export function calculateDefensiveHpOutcome(attacker, target, input, modifiers = {}) {
  let sources = Object.fromEntries(['physical', 'magical', 'piercingDamage', 'hybridalDamage']
    .map(key => [key, Math.max(0, Number(input?.[key]) || 0)]));
  if (modifiers.resilience > 0) {
    const factor = Math.max(0, 1 - modifiers.resilience / 100);
    sources = Object.fromEntries(Object.entries(sources).map(([key, value]) =>
      [key, value ? Math.round(Math.round(value) * factor + (modifiers.resilienceCarry?.[key] || 0)) : 0]));
  }
  const reduced = calculateResistances(target, sources, attacker, { inert: modifiers.inert });
  sources = {
    physical: reduced.reducedPhysicalDamage, magical: reduced.reducedMagicalDamage,
    piercingDamage: reduced.reducedpiercingDamage, hybridalDamage: reduced.reducedHybridalDamage,
  };
  if (modifiers.esoterism > 0) {
    const factor = (100 - modifiers.esoterism) / 100;
    sources.magical = Math.ceil(sources.magical * factor);
    const half = sources.hybridalDamage / 2;
    sources.hybridalDamage = Math.round(half + Math.ceil(half * factor));
  }
  if (modifiers.occultismFragility > 0) {
    sources = Object.fromEntries(Object.entries(sources).map(([key, value]) =>
      [key, Math.round(value * (1 + modifiers.occultismFragility / 100))]));
  }
  const normalDamage = sumSources(sources);
  let total = normalDamage;
  if (modifiers.critical) total = Math.round(total * (1 + (modifiers.criticalBonus || 0) / 100));
  if (modifiers.critical && modifiers.resilienceCrit > 0) total = reduceCriticalSupplement(total, normalDamage, modifiers.resilienceCrit);
  return Math.max(0, Math.round(total * Math.max(0, 1 - (modifiers.indestructibility || 0) / 100)));
}

export function estimateCancelledAttackHp(attacker, target, attack, input, {
  armorBefore = Number(target.stats?.armor?.current) || 0, executionDamage = 0,
} = {}) {
  const flags = getAttackResolutionFlags(attack);
  let sources = Object.fromEntries(['physical', 'magical', 'piercingDamage', 'hybridalDamage']
    .map(key => [key, Math.max(0, Math.floor(Number(input?.[key]) || 0))]));
  const baseTotal = sumSources(sources);
  const bypass = sources.piercingDamage > 0 && !sources.physical && !sources.magical && !sources.hybridalDamage
    && flags.canBypassArmorGate ? sources.piercingDamage * flags.armorBypassPercent / 100 : 0;
  const mysticism = applyMysticismBonusToSources(sources, attacker, attack);
  if (mysticism.applied) sources = mysticism.sources;
  const extra = Math.max(0, sumSources(sources) - baseTotal);
  const armorAfter = Math.max(0, armorBefore - (baseTotal - bypass));
  let remaining = Math.max(0, baseTotal - bypass - armorBefore)
    + (bypass > 0 ? extra : Math.max(0, extra - armorAfter)) + executionDamage;
  sources.physical += executionDamage;
  sources.piercingDamage = Math.max(0, sources.piercingDamage - bypass);
  const rawTotal = sumSources(sources);
  const ratio = rawTotal > 0 ? Math.max(0, Math.min(1, remaining / rawTotal)) : 0;
  if (ratio < 1) sources = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, Math.round(value * ratio)]));
  sources.piercingDamage += bypass;
  const rangeReduction = flags.applyRangeRatio ? Math.max(0, calculateRangeRatio(attacker, attack)) : 0;
  if (rangeReduction > 0) {
    const factor = 1 - rangeReduction / 100;
    if (flags.applyRangeRatioToPiercing) sources.piercingDamage = Math.round(sources.piercingDamage * factor);
    if (flags.applyRangeRatioToPhysical) sources.physical = Math.round(sources.physical * factor);
    if (flags.applyRangeRatioToHybridPhysicalHalf) {
      sources.physical += Math.round(sources.hybridalDamage / 2 * factor);
      sources.magical += sources.hybridalDamage / 2;
      sources.hybridalDamage = 0;
    }
  }
  const invisible = target.flags?.occultismInvisible || target.isInvisible || target.invisible;
  const damage = calculateDefensiveHpOutcome(attacker, target, sources, {
    inert: getAttackNatureRules(attack).isInert,
    resilience: normArr(attack.type).includes('alteration') ? calculateResilienceAlterationTotalBonus(target) : 0,
    occultismFragility: invisible ? calculateOccultismShadowFragilityPercent(target) : 0,
    indestructibility: (bypass > 0 ? armorAfter : armorAfter - extra) <= 0 ? caluclateIndestructibilityReductionTotal(target) : 0,
  });
  return Math.min(Math.max(0, Number(target.stats?.HP?.current) || 0), damage);
}

export function applyDamage(...args) {
  try {
    return withSleepImpact(args[0], () => resolveDamage(...args));
  } finally {
    if (args[0]?.stats?.HP) window.dispatchEvent(new CustomEvent('entityCombatInteraction', {
      detail: { entity: args[0], kind: 'received-action' },
    }));
  }
}

function resolveDamage(
  target,
  totalDamage,
  attacker,
  currentAttack,
  totalDamageSources = {},
  selfEffects = [],
  attackType = []
) {
  if (target.isInvincible) {
    console.log(`⛔ ${target.name} est invincible, aucun effet (dégât, soin, effet) appliqué.`);
    return;
  }

  const attackTypes = normArr(currentAttack?.type);

  if (attackTypes.includes("alteration")) {
    console.log(
      `☠️ [ALTÉRATION] ${attacker.name} inflige une altération (${currentAttack.dotname || currentAttack.attacknature || "inconnu"}) à ${target.name}`
    );
  }

  let attackDetail;
  let popupContent = currentAttack?.popup || "";
  let popupType = "";

  if (typeof currentAttack === "string") {
    attackDetail = resolveAttackDefinitionForEntity(attacker, currentAttack, attackDetails);
  } else {
    attackDetail = currentAttack?.launchContextId || attackTypes.includes('alteration') ? currentAttack
      : resolveAttackDefinitionForEntity(attacker, currentAttack, attackDetails) || currentAttack || {};
  }

  const flags = getAttackResolutionFlags(attackDetail);
  if (getAttackNatureRules(attackDetail).isInert) attacker = createAttackStatView(attacker, attackDetail);

  const isSupport = attackDetail?.combatFunction === 'Support';
  const isOffensive = attackDetail?.combatFunction === 'Attaquant';

  if (isSupport) {
    if (!target.isDEAD) {
      const critical = flags.canCrit && !attackTypes.includes('alteration')
        ? attemptCriticalHit(attacker, target, totalDamage) : { isCritical: false, finalDamage: totalDamage };
      const outcome = { hit: true, critical: critical.isCritical, healedHP: 0 };
      const applyHealing = () => {
      const hpBeforeHeal = Number(target.stats.HP.current) || 0;
      const hpAfterHeal = Math.min(hpBeforeHeal + Math.max(0, Number(critical.finalDamage) || 0), target.stats.HP.max);
      const healedHP = Math.max(0, hpAfterHeal - hpBeforeHeal);

      attacker.totalHeal = (Number(attacker.totalHeal) || 0) + healedHP;
      recordEntityHealingDone(attacker, healedHP, combatRangeFromFlags(flags), {
        summonOrigin: attackDetail.summonStatsOrigin,
        ambidextry: attackDetail.ambidextryHitIndex === 2,
      });
      recordEntityHealingReceived(target, healedHP);

      target.stats.HP.current = hpAfterHeal;
      saveEntityHPToStorage(target);
      updateTotalHealCounter(attacker.id, attacker.totalHeal);

      updateHealthBar(
        target.stats.HP.current,
        target.stats.HP.max,
        target.stats.armor?.current || 0,
        target.stats.armor?.max || 0,
        target.id
      );

      if (healedHP > 0) {
        showHealingFeedback(target, healedHP);
        updateScore(attacker, healedHP);
      }
      if (attackDetail.effets) attackDetail.effets.forEach((e) => applyEffect(target, e, attacker, attackDetail));
      applyAttackNatureEffect(target, attacker, attackDetail);
      outcome.healedHP = healedHP;
      };
      if (!deferCombatEffect(applyHealing)) applyHealing();
      return outcome;
    }
    return;
  }

  if (!isOffensive || target.isDEAD) {
    console.error("❌ Erreur : Cible invalide ou morte.");
    return;
  }

if (blocksAstralSpell(target, attackDetail)) {
  EffectMessage(target, 'Raté !');
  recordEntityCombatProc(target, 'astralBodyAvoidance');
  battleLogs('attack_missed', { attacker, target, attack: attackDetail, reason: 'Corps astral' });
  return { hit: false, astralBody: true };
}

const isBrokenMagicAttack =
  Boolean(attackDetail?.isBrokenSpell || currentAttack?.isBrokenSpell) &&
  (
    normArr(attackDetail?.attacknature).includes("magicalDamage") ||
    Number(totalDamageSources?.magical || 0) > 0
  );

if (isBrokenMagicAttack) {
  brokenMagicImpact(target.id);
} else if (hasActiveArmor(target)) {
  damageArmorImpact(target.id);
} else {
  damageImpact(target.id);
}

if (isBrokenMagicAttack) {
  brokenMagicImpact(target.id);
}

shakeImpact(target.id);

  attacker.totalDamage = Number(attacker.totalDamage) || 0;
if (!attacker.totalAggroDamage) attacker.totalAggroDamage = 0;

  const hpBefore = target.stats.HP.current;
  const armorBeforeGlobal = target.stats?.armor?.current || 0;

  let totalExecutionDamage = 0;

  const attackRangeArr = flags.ranges;
  const isMelee = flags.isMelee;
  const isRanged = flags.isRange;

  const finalLog = {
	  attackerFull: attacker,
		targetFull: target,
attackModifiers: {
  critical: false,
  execution: false,
  bloodCrazy: false,
  mysticism: false,
  esoterism: false,
  occultismFragility: false,
  armorAbsorbed: 0,
  armorBypass: false,
  indestructible: false,
  astrality: false,
  lifesteal: 0
},
    attacker: { id: attacker?.id, name: attacker?.name },
    target: { id: target?.id, name: target?.name },

attack: {
  functionName: attackDetail?.functionName || (typeof currentAttack === "string" ? currentAttack : undefined),
  nature: attackDetail?.attacknature,
  types: attackTypes,
  label: currentAttack?.dotname || currentAttack?.name || attackDetail?.dotname || attackDetail?.name || "",
  range: attackRangeArr,
  isMelee,
  isRanged,
  logVariant: currentAttack?.logVariant || "normal",
  ambidextryHitIndex: currentAttack?.ambidextryHitIndex || null,
},

    input: {
      totalDamageArg: totalDamage,
      hpBefore,
      hpMax: target?.stats?.HP?.max,
      armorBefore: armorBeforeGlobal,
      armorMax: target?.stats?.armor?.max || 0,
    },

    execution: { attempted: false },
    armor: { attempted: false },
    armorGate: { attempted: false },
    indestructible: { attempted: false },

sources: {
  base: null,
  afterMysticism: null,
  afterExecutionBonus: null,
  afterArmorGate: null,
  afterRangeRatio: null,
  afterResilience: null,
  afterResistances: null,
  afterEsoterism: null,
afterOccultismFragility: null,
},

    rangeRatio: { attempted: !!isRanged, applied: false },
    resilience: { attempted: attackTypes.includes("alteration"), applied: false },

    resistances: {},
    esoterism: { attempted: false, applied: false },
	occultismFragility: { attempted: false, applied: false },
	critical: { attempted: false },

    out: {
      pipelineOut: 0,
      indReducPercent: 0,
      afterInd: 0,
      finalDamage: 0,
      hpLoss: 0,
      astralityTriggered: false,
    },

    totals: {},
    hp: {},

    popupType: null,
    popupContent,
    effectsApplied: [],
    selfEffects: normArr(selfEffects),
  };
const hasBloodCrazy = Boolean(attacker.flags?.bloodCrazyNextExecution);

finalLog.execution.bloodCrazy = hasBloodCrazy;

if (hasBloodCrazy) {
  finalLog.attackModifiers.bloodCrazy = true;
  finalLog.attackModifiers.bloodCrazyConsumed = true;
}

if (flags.canBloodFuryExec) {
  finalLog.execution.attempted = true;

  const bloodFuryExecChanceBonus = calculateBloodFuryTargetThreshold(attacker);
  const hpPercent = (target.stats.HP.current / target.stats.HP.max) * 100;

  finalLog.execution.targetHpPercent = Number(hpPercent.toFixed(1));
  finalLog.execution.thresholdPercent = bloodFuryExecChanceBonus;

  const canTryByHp = hpPercent <= bloodFuryExecChanceBonus;
  const canTryByBloodCrazy = hasBloodCrazy;

  if (canTryByHp || canTryByBloodCrazy) {
    totalExecutionDamage = attemptBloodFuryExec(attacker, target, {
      ignoreHpThreshold: canTryByBloodCrazy
    });

    finalLog.execution.triggered = totalExecutionDamage > 0;
    finalLog.execution.damage = totalExecutionDamage || 0;

    if (hasBloodCrazy) {
      if (totalExecutionDamage > 0) {
        finalLog.attackModifiers.bloodCrazySuccess = true;
        recordEntityCombatProc(attacker, 'bloodCrazy');
      } else {
        finalLog.attackModifiers.bloodCrazyFail = true;
        finalLog.attackModifiers.bloodCrazyFailReason = "proc_failed";
      }
    }
  } else {
    finalLog.execution.triggered = false;
    finalLog.execution.damage = 0;
  }
} else {
  finalLog.execution.attempted = hasBloodCrazy;
  finalLog.execution.triggered = false;
  finalLog.execution.damage = 0;
  finalLog.execution.skippedByAttackRules = true;

  if (hasBloodCrazy) {
    finalLog.attackModifiers.bloodCrazyFail = true;
    finalLog.attackModifiers.bloodCrazyFailReason = "incompatible_attack";
  }
}

if (hasBloodCrazy) {
  consumeBloodCrazy(attacker);
}
  const readIncomingSourcesForArmorGate = () => {
    if (currentAttack?.forceDamageSources) {
      const f = currentAttack.forceDamageSources;
      return {
        piercingDamage: Math.max(0, Math.floor(f.piercingDamage || 0)),
        physical: Math.max(0, Math.floor(f.physical || 0)),
        magical: Math.max(0, Math.floor(f.magical || 0)),
        hybridalDamage: Math.max(0, Math.floor(f.hybridalDamage || 0)),
      };
    }

    if (
      totalDamageSources &&
      typeof totalDamageSources === "object" &&
      (
        Number(totalDamageSources.piercingDamage || 0) > 0 ||
        Number(totalDamageSources.physical || 0) > 0 ||
        Number(totalDamageSources.magical || 0) > 0 ||
        Number(totalDamageSources.hybridalDamage || 0) > 0
      )
    ) {
      return {
        piercingDamage: Math.max(0, Math.floor(totalDamageSources.piercingDamage || 0)),
        physical: Math.max(0, Math.floor(totalDamageSources.physical || 0)),
        magical: Math.max(0, Math.floor(totalDamageSources.magical || 0)),
        hybridalDamage: Math.max(0, Math.floor(totalDamageSources.hybridalDamage || 0)),
      };
    }

    if (
      !flags.hasPhysical &&
      !flags.hasMagical &&
      !flags.hasHybridal &&
      (flags.hasPiercing || Number(getSafe(attacker, "piercingDamage", 0)) > 0)
    ) {
      return {
        piercingDamage: Math.max(0, Math.floor(totalDamage || 0)),
        physical: 0,
        magical: 0,
        hybridalDamage: 0,
      };
    }

    return { piercingDamage: 0, physical: 0, magical: 0, hybridalDamage: 0 };
  };

  const incomingArmorSources = readIncomingSourcesForArmorGate();

  const isPurePiercingIncoming =
    incomingArmorSources.piercingDamage > 0 &&
    incomingArmorSources.physical <= 0 &&
    incomingArmorSources.magical <= 0 &&
    incomingArmorSources.hybridalDamage <= 0;

const purePiercingArmorBypass =
  isPurePiercingIncoming &&
  flags.canBypassArmorGate
    ? incomingArmorSources.piercingDamage * flags.armorBypassPercent / 100
    : 0;
  let remainingDamage = Math.max(0, totalDamage - purePiercingArmorBypass);

  if (purePiercingArmorBypass > 0) {
	  finalLog.attackModifiers.armorBypass = true;
    console.log(
      `🗡️ TRANSPERÇANTE : ${purePiercingArmorBypass} dégâts piercing traversent l'armor gate.`
    );

    finalLog.armorGate.bypass = {
      enabled: true,
      type: "purePiercing",
      amount: purePiercingArmorBypass,
    };
  }

  let absorbedByArmor = 0;

  if (target.stats?.armor && target.stats.armor.current > 0) {
    finalLog.armor.attempted = true;

    const armorBefore = Number(target.stats.armor.current) || 0;
    const armorConsumption = consumeEntityArmor(target, remainingDamage);
    absorbedByArmor = armorConsumption.absorbed;
    remainingDamage = armorConsumption.remainingDamage;
    saveEntityArmorState(target);

    finalLog.armor.armorBefore = armorBefore;
    finalLog.armor.armorAfter = target.stats.armor?.current || 0;
    finalLog.armor.absorbedByArmor = absorbedByArmor;
    finalLog.armor.remainingAfterArmorStep = remainingDamage;
    finalLog.armor.layers = armorConsumption.layers;
    finalLog.armor.stuffDamage = armorConsumption.stuffDamage;
    finalLog.attackModifiers.armorAbsorbed = absorbedByArmor;
    console.log(
      `🛡️ ${target.name} perd ${absorbedByArmor} points d'armure (${target.stats.armor?.current || 0}/${target.stats.armor?.max || 0}).`
    );

    updateHealthBar(
      target.stats.HP.current,
      target.stats.HP.max,
      target.stats.armor?.current || 0,
      target.stats.armor?.max || 0,
      target.id
    );
  } else {
    finalLog.armor.attempted = false;
    finalLog.armor.absorbedByArmor = 0;
    finalLog.armor.remainingAfterArmorStep = remainingDamage;
  }

  if ((target.stats.armor?.current || 0) <= 0) {
    const isIndestructible = attemptIndestructibility(attacker, target);
    if (isIndestructible) {
		finalLog.attackModifiers.indestructible = true;
      recordEntityCombatProc(target, 'indestructible');
      recordEntityDefenseHp(target, { indestructible: estimateCancelledAttackHp(attacker, target, attackDetail,
        incomingArmorSources, { armorBefore: armorBeforeGlobal, executionDamage: totalExecutionDamage }) });
      finalLog.indestructible.attempted = true;
      finalLog.indestructible.triggered = true;
      finalLog.indestructible.note = "Dégâts annulés (altérations/effets appliqués).";

      console.log(`🧱 ${target.name} ignore les dégâts restants (indestructible).`);

      if (attackDetail.effets) {
        attackDetail.effets.forEach((effectName) => applyEffect(target, effectName, attacker, attackDetail));
      }

      updateHealthBar(
        target.stats.HP.current,
        target.stats.HP.max,
        target.stats.armor?.current || 0,
        target.stats.armor?.max || 0,
        target.id
      );

      finalLog.effectsApplied = [...(attackDetail.effets || [])];
      finalLog.popupType = popupType || "";
      finalLog.totals = {
        totalDamageArg: totalDamage,
        remainingAfterArmorStep: remainingDamage,
        note: "Indestructible(proc): aucun dégât HP appliqué.",
      };
      finalLog.hp = {
        hpBefore,
        hpAfter: target.stats.HP.current,
        hpMax: target.stats.HP.max,
        delta: 0,
      };

      const armorDamageApplied = Math.max(0, Math.round(armorBeforeGlobal - (Number(target.stats?.armor?.current) || 0)));
      recordEntityDamageReceived(target, 0, armorDamageApplied);
      if (armorDamageApplied > 0 && String(attacker.id) !== String(target.id)) {
        attacker.totalDamage += armorDamageApplied;
        recordEntityDamageDetails(attacker, combatDamageNature(attackDetail), {
          summonOrigin: attackDetail.summonStatsOrigin,
          armorDamage: armorDamageApplied,
          armorSources: incomingArmorSources,
          range: combatRangeFromFlags(flags),
          ambidextry: attackDetail.ambidextryHitIndex === 2,
          hypercognition: attackDetail.essenceSlots?.some(slot => slot.active !== false && slot.color === 'blue' && slot.hyperco) === true,
        });
        updateTotalDamageCounter(`TotalDamages_${attacker.id}`, attacker.totalDamage);
      }
      if (armorDamageApplied > 0) {
        PopUpDamages(target, 0, attackDetail.effets, popupContent, {}, popupType, armorDamageApplied, getAttackNatureRules(attackDetail).stat);
      }

      const logImpact = () => logFinalDamageResolution(finalLog);
  if (!deferCombatEffect(logImpact)) logImpact();
      applyAttackNatureEffect(target, attacker, attackDetail);
      return { hit: true, critical: false };
    }
  }

  let sources;
  let rawTotal;

  const hasProvidedSources =
    totalDamageSources &&
    typeof totalDamageSources === "object" &&
    (
      Number(totalDamageSources.piercingDamage || 0) > 0 ||
      Number(totalDamageSources.physical || 0) > 0 ||
      Number(totalDamageSources.magical || 0) > 0 ||
      Number(totalDamageSources.hybridalDamage || 0) > 0
    );

  if (currentAttack?.isAmbidextry) {
    if (currentAttack?.forceDamageSources) {
      const f = currentAttack.forceDamageSources;
      sources = {
        piercingDamage: Math.max(0, Math.floor(f.piercingDamage || 0)),
        physical: Math.max(0, Math.floor(f.physical || 0)),
        magical: Math.max(0, Math.floor(f.magical || 0)),
        hybridalDamage: Math.max(0, Math.floor(f.hybridalDamage || 0)),
      };
    } else {
      sources = {
        piercingDamage: 0,
        physical: Math.max(0, Math.floor(totalDamage || 0)),
        magical: 0,
        hybridalDamage: 0,
      };
    }

    rawTotal =
      (sources.piercingDamage || 0) +
      (sources.physical || 0) +
      (sources.magical || 0) +
      (sources.hybridalDamage || 0);

    console.log(`🌀 Ambidextrie : sources forcées`, sources, `total=${rawTotal}`);
  } else if (currentAttack?.forceDamageSources) {
    const f = currentAttack.forceDamageSources;
    sources = {
      piercingDamage: Math.max(0, Math.floor(f.piercingDamage || 0)),
      physical: Math.max(0, Math.floor(f.physical || 0)),
      magical: Math.max(0, Math.floor(f.magical || 0)),
      hybridalDamage: Math.max(0, Math.floor(f.hybridalDamage || 0)),
    };

    rawTotal =
      (sources.piercingDamage || 0) +
      (sources.physical || 0) +
      (sources.magical || 0) +
      (sources.hybridalDamage || 0);

    console.log(`🧪 ForceDamageSources → total=${rawTotal}`, sources);
  } else if (hasProvidedSources) {
    sources = {
      piercingDamage: Math.max(0, Math.floor(totalDamageSources.piercingDamage || 0)),
      physical: Math.max(0, Math.floor(totalDamageSources.physical || 0)),
      magical: Math.max(0, Math.floor(totalDamageSources.magical || 0)),
      hybridalDamage: Math.max(0, Math.floor(totalDamageSources.hybridalDamage || 0)),
    };

    rawTotal =
      (sources.piercingDamage || 0) +
      (sources.physical || 0) +
      (sources.magical || 0) +
      (sources.hybridalDamage || 0);
  } else {
    ({ totalDamageSources: sources, totalDamage: rawTotal } = attemptAttackerDamages(attacker, attackDetail));
  }

finalLog.sources.base = snapSources(sources);
finalLog.totals.rawTotalBase = rawTotal;
finalLog.totals.sumSourcesBase = sumSources(sources);

const mysticismBonusResult = applyMysticismBonusToSources(
  sources,
  attacker,
  currentAttack
);

if (mysticismBonusResult.applied) {
	finalLog.attackModifiers.mysticism = true;
  sources = mysticismBonusResult.sources;

  rawTotal =
    (sources.piercingDamage || 0) +
    (sources.physical || 0) +
    (sources.magical || 0) +
    (sources.hybridalDamage || 0);

  const rawTotalBeforeMysticism = finalLog.totals.rawTotalBase || 0;
  const extraMysticismDamage = Math.max(0, rawTotal - rawTotalBeforeMysticism);

  if (
    extraMysticismDamage > 0 &&
    purePiercingArmorBypass <= 0 &&
    target.stats?.armor?.current > 0
  ) {
    const armorBeforeMysticismExtra = Number(target.stats.armor.current) || 0;
    const armorConsumption = consumeEntityArmor(target, extraMysticismDamage);
    const extraAbsorbedByArmor = armorConsumption.absorbed;

    saveEntityArmorState(target);
    absorbedByArmor += extraAbsorbedByArmor;
    remainingDamage += armorConsumption.remainingDamage;

    finalLog.armor.mysticismExtra = {
      extraMysticismDamage,
      ignoredArmor: false,
      armorBefore: armorBeforeMysticismExtra,
      absorbedByArmor: extraAbsorbedByArmor,
      armorAfter: target.stats.armor?.current || 0,
      remainingDamageAfterExtra: remainingDamage,
      layers: armorConsumption.layers,
      stuffDamage: armorConsumption.stuffDamage,
    };
  } else {
    remainingDamage += extraMysticismDamage;

    finalLog.armor.mysticismExtra = {
      extraMysticismDamage,
      ignoredArmor: purePiercingArmorBypass > 0,
      absorbedByArmor: 0,
      armorAfter: target.stats?.armor?.current || 0,
      remainingDamageAfterExtra: remainingDamage,
    };
  }
  finalLog.attackModifiers.armorAbsorbed = absorbedByArmor;

  finalLog.mysticism = {
    attempted: true,
    applied: true,
    bonusPercent: mysticismBonusResult.bonusPercent,
    bonusSources: mysticismBonusResult.bonusSources,
    after: snapSources(sources),
  };

  finalLog.sources.afterMysticism = snapSources(sources);
  finalLog.totals.rawTotalAfterMysticism = rawTotal;
  finalLog.totals.sumSourcesAfterMysticism = sumSources(sources);
  finalLog.totals.extraMysticismDamage = extraMysticismDamage;
  finalLog.totals.remainingDamageAfterMysticism = remainingDamage;

  console.log(
    `🔮 Mysticisme dégâts : +${mysticismBonusResult.bonusPercent}%`,
    {
      bonusSources: mysticismBonusResult.bonusSources,
      afterMysticism: finalLog.sources.afterMysticism,
      rawTotalAfterMysticism: rawTotal,
      extraMysticismDamage,
      armorMysticismExtra: finalLog.armor.mysticismExtra,
      remainingDamageAfterMysticism: remainingDamage,
    }
  );
} else {
  finalLog.mysticism = {
    attempted: !!currentAttack?.isLaunchedUnderMysticism,
    applied: false,
    bonusPercent: mysticismBonusResult.bonusPercent || 0,
  };

  finalLog.sources.afterMysticism = snapSources(sources);
  finalLog.totals.rawTotalAfterMysticism = rawTotal;
  finalLog.totals.sumSourcesAfterMysticism = sumSources(sources);
  finalLog.totals.extraMysticismDamage = 0;
  finalLog.totals.remainingDamageAfterMysticism = remainingDamage;
}

if (totalExecutionDamage > 0) {
  finalLog.attackModifiers.execution = true;

  sources.physical = (sources.physical || 0) + totalExecutionDamage;

  // IMPORTANT : sinon l'armorGate ratio écrase le bonus
  remainingDamage += totalExecutionDamage;

  rawTotal =
    (sources.piercingDamage || 0) +
    (sources.physical || 0) +
    (sources.magical || 0) +
    (sources.hybridalDamage || 0);

  finalLog.sources.afterExecutionBonus = snapSources(sources);
  finalLog.totals.remainingDamageAfterExecutionBonus = remainingDamage;
} else {
    finalLog.sources.afterExecutionBonus = snapSources(sources);
  }

  if (purePiercingArmorBypass > 0) {
    sources.piercingDamage = Math.max(
      0,
      (sources.piercingDamage || 0) - purePiercingArmorBypass
    );

    rawTotal =
      (sources.piercingDamage || 0) +
      (sources.physical || 0) +
      (sources.magical || 0) +
      (sources.hybridalDamage || 0);

    finalLog.armorGate.beforeBypassExtraction = snapSources(sources);

    console.log(
      `🗡️ TRANSPERÇANTE : extraction avant armor gate (${purePiercingArmorBypass})`
    );
  }

  finalLog.armorGate.attempted = true;

  if (rawTotal > 0) {
    const ratio = Math.max(0, Math.min(1, (remainingDamage || 0) / rawTotal));

    finalLog.armorGate.ratio = ratio;
    finalLog.armorGate.before = snapSources(sources);

    if (ratio <= 0) {
      sources = { piercingDamage: 0, physical: 0, magical: 0, hybridalDamage: 0 };
      rawTotal = 0;
    } else if (ratio < 1) {
      sources = {
        piercingDamage: Math.round((sources.piercingDamage || 0) * ratio),
        physical: Math.round((sources.physical || 0) * ratio),
        magical: Math.round((sources.magical || 0) * ratio),
        hybridalDamage: Math.round((sources.hybridalDamage || 0) * ratio),
      };

      rawTotal =
        (sources.piercingDamage || 0) +
        (sources.physical || 0) +
        (sources.magical || 0) +
        (sources.hybridalDamage || 0);
    }

    finalLog.armorGate.after = snapSources(sources);
    finalLog.sources.afterArmorGate = snapSources(sources);
    finalLog.totals.rawTotalAfterArmorGate = rawTotal;
  } else {
    sources = { piercingDamage: 0, physical: 0, magical: 0, hybridalDamage: 0 };
    rawTotal = 0;
    finalLog.sources.afterArmorGate = snapSources(sources);
    finalLog.totals.rawTotalAfterArmorGate = 0;
  }

  if (purePiercingArmorBypass > 0) {
    sources.piercingDamage = (sources.piercingDamage || 0) + purePiercingArmorBypass;

    rawTotal =
      (sources.piercingDamage || 0) +
      (sources.physical || 0) +
      (sources.magical || 0) +
      (sources.hybridalDamage || 0);

    finalLog.armorGate.afterBypassReinject = snapSources(sources);
    finalLog.sources.afterArmorGate = snapSources(sources);
    finalLog.totals.rawTotalAfterArmorGate = rawTotal;
  }

  if (flags.applyRangeRatio) {
    const rr = calculateRangeRatio(attacker, attackDetail);

    finalLog.rangeRatio.rrPercent = rr;

    if (rr > 0) {
      const factor = 1 - rr / 100;

      finalLog.rangeRatio.applied = true;
      finalLog.rangeRatio.factor = factor;
      finalLog.rangeRatio.before = snapSources(sources);

      if (flags.applyRangeRatioToPiercing) {
        sources.piercingDamage = Math.round((sources.piercingDamage || 0) * factor);
      }

      if (flags.applyRangeRatioToPhysical) {
        sources.physical = Math.round((sources.physical || 0) * factor);
      }

      if (flags.applyRangeRatioToHybridPhysicalHalf) {
        const beforeHybrid = sources.hybridalDamage || 0;

        if (beforeHybrid > 0) {
          const physHalf = beforeHybrid / 2;
          const magHalf = beforeHybrid - physHalf;
          const physHalfReduced = Math.round(physHalf * factor);
          // Keep the surviving parts separate: recombining them would make the
          // resistance stage split the reduced total 50/50 and also penalize magic.
          sources.physical = (sources.physical || 0) + physHalfReduced;
          sources.magical = (sources.magical || 0) + magHalf;
          sources.hybridalDamage = 0;
        }
      }

      rawTotal =
        (sources.piercingDamage || 0) +
        (sources.physical || 0) +
        (sources.magical || 0) +
        (sources.hybridalDamage || 0);

      finalLog.rangeRatio.after = snapSources(sources);
      finalLog.sources.afterRangeRatio = snapSources(sources);
      finalLog.totals.rawTotalAfterRangeRatio = rawTotal;
    } else {
      finalLog.sources.afterRangeRatio = snapSources(sources);
      finalLog.rangeRatio.applied = false;
    }
  } else {
    finalLog.sources.afterRangeRatio = snapSources(sources);
  }

  const defenseInput = { ...sources };
  if (attackTypes.includes("alteration")) {
    const resAttempt = attemptResilience(attacker, target, attackDetail) || {};
    const { enabled, percent } = resAttempt;

    finalLog.resilience.enabled = !!enabled;
    finalLog.resilience.percent = percent || 0;

    if (enabled && percent > 0) {
      recordEntityCombatProc(target, 'resilience');
      const factor = Math.max(0, 1 - percent / 100);
      // Keep fractions within this DoT so small ticks do not erase mitigation.
      const carry = attackDetail.alterationRounding;
      finalLog.resilience.carryBefore = carry ? { ...carry } : undefined;
      const scale = (v, key) => {
        if (!v) return 0;
        const exact = v * factor + (carry?.[key] || 0);
        const rounded = Math.round(exact);
        if (carry) carry[key] = exact - rounded;
        return rounded;
      };

      const beforeResilience = snapSources(sources);

      sources = {
        piercingDamage: scale(beforeResilience.piercingDamage, 'piercingDamage'),
        physical: scale(beforeResilience.physical, 'physical'),
        magical: scale(beforeResilience.magical, 'magical'),
        hybridalDamage: scale(beforeResilience.hybridalDamage, 'hybridalDamage'),
      };

      rawTotal =
        (sources.piercingDamage || 0) +
        (sources.physical || 0) +
        (sources.magical || 0) +
        (sources.hybridalDamage || 0);

      finalLog.resilience.applied = true;
      finalLog.resilience.factor = factor;
      finalLog.resilience.before = snapSources(beforeResilience);
      finalLog.resilience.after = snapSources(sources);
      finalLog.sources.afterResilience = snapSources(sources);
      finalLog.totals.rawTotalAfterResilience = rawTotal;
    } else {
      finalLog.resilience.applied = false;
      finalLog.sources.afterResilience = snapSources(sources);
    }
  } else {
    finalLog.sources.afterResilience = snapSources(sources);
  }

  const {
    reducedpiercingDamage,
    reducedPhysicalDamage,
    reducedMagicalDamage,
    reducedHybridalDamage,
    details: resistanceDetails,
  } = calculateResistances(target, sources, attacker, { inert: getAttackNatureRules(attackDetail).isInert });
  if (String(attacker.id) !== String(target.id)) recordInertResistance(attacker, resistanceDetails.inert);

  let hybridPhysicalShare = Math.max(0, Math.min(1,
    Number(balanceData.resistance.hybrid.splitRatio) || 0.5));
  if (Number(sources.hybridalDamage) > 0) {
    const hybridParts = calculateResistances(target, {
      physical: sources.hybridalDamage * hybridPhysicalShare,
      magical: sources.hybridalDamage * (1 - hybridPhysicalShare),
    }, attacker);
    const hybridTotal = hybridParts.reducedPhysicalDamage + hybridParts.reducedMagicalDamage;
    if (hybridTotal > 0) hybridPhysicalShare = hybridParts.reducedPhysicalDamage / hybridTotal;
  }

  let totalDamageSourcesReduced = {
    piercingDamage: reducedpiercingDamage,
    physical: reducedPhysicalDamage,
    magical: reducedMagicalDamage,
    hybridalDamage: reducedHybridalDamage,
  };

  let totalReducedDamage =
    (reducedpiercingDamage || 0) +
    (reducedPhysicalDamage || 0) +
    (reducedMagicalDamage || 0) +
    (reducedHybridalDamage || 0);

  finalLog.resistances.before = snapSources(sources);
  finalLog.resistances.after = {
    piercingDamage: reducedpiercingDamage || 0,
    physical: reducedPhysicalDamage || 0,
    magical: reducedMagicalDamage || 0,
    hybridalDamage: reducedHybridalDamage || 0,
  };
  finalLog.sources.afterResistances = { ...finalLog.resistances.after };
  finalLog.totals.totalAfterResistances = totalReducedDamage;

  const hasMagicalPart =
    (totalDamageSourcesReduced.magical || 0) > 0 ||
    (totalDamageSourcesReduced.hybridalDamage || 0) > 0;

  if (target.stats?.esoterism && hasMagicalPart) {
    const beforeEso = { ...totalDamageSourcesReduced };

    const success = attemptEsoterism(attacker, target);
    finalLog.esoterism.attempted = true;
    finalLog.esoterism.success = !!success;
    finalLog.esoterism.before = { ...beforeEso };

    if (success) {
	finalLog.attackModifiers.esoterism = true;	
      recordEntityCombatProc(target, 'esoterism');
      const reductionPercent = calculateEsoterismtotalReduction(target);
      const multiplier = (100 - reductionPercent) / 100;

      totalDamageSourcesReduced.magical = Math.ceil((totalDamageSourcesReduced.magical || 0) * multiplier);

      const beforeHybrid = totalDamageSourcesReduced.hybridalDamage || 0;
      if (beforeHybrid > 0) {
        const physHalf = beforeHybrid / 2;
        const magHalf = beforeHybrid - physHalf;

        const magHalfReduced = Math.ceil(magHalf * multiplier);
        totalDamageSourcesReduced.hybridalDamage = Math.round(physHalf + magHalfReduced);
      }

      totalReducedDamage =
        (totalDamageSourcesReduced.piercingDamage || 0) +
        (totalDamageSourcesReduced.physical || 0) +
        (totalDamageSourcesReduced.magical || 0) +
        (totalDamageSourcesReduced.hybridalDamage || 0);

      console.log(`🪄 Ésotérisme : réduction de ${reductionPercent}% sur la part magique.`);

      finalLog.esoterism.applied = true;
      finalLog.esoterism.reductionPercent = reductionPercent;
      finalLog.esoterism.after = { ...totalDamageSourcesReduced };
      finalLog.sources.afterEsoterism = { ...totalDamageSourcesReduced };
      finalLog.totals.totalAfterEsoterism = totalReducedDamage;
    } else {
      finalLog.esoterism.applied = false;
      finalLog.esoterism.after = { ...totalDamageSourcesReduced };
      finalLog.sources.afterEsoterism = { ...totalDamageSourcesReduced };
    }
  } else {
    finalLog.esoterism.attempted = false;
    finalLog.sources.afterEsoterism = { ...totalDamageSourcesReduced };
  }
  
  const targetIsOccultismInvisible =
    Boolean(target.flags?.occultismInvisible) ||
    Boolean(target.isInvisible) ||
    Boolean(target.invisible);

  const occultismFragilityPercent = targetIsOccultismInvisible
    ? Number(calculateOccultismShadowFragilityPercent(target)) || 0
    : 0;

  if (targetIsOccultismInvisible && occultismFragilityPercent > 0) {
	  finalLog.attackModifiers.occultismFragility = true;
    recordEntityCombatProc(target, 'occultismFragility');
    const multiplier = 1 + occultismFragilityPercent / 100;
    const beforeOccultismFragility = { ...totalDamageSourcesReduced };
    const beforeOccultismFragilityTotal = totalReducedDamage;

    totalDamageSourcesReduced = {
      piercingDamage: Math.round((totalDamageSourcesReduced.piercingDamage || 0) * multiplier),
      physical: Math.round((totalDamageSourcesReduced.physical || 0) * multiplier),
      magical: Math.round((totalDamageSourcesReduced.magical || 0) * multiplier),
      hybridalDamage: Math.round((totalDamageSourcesReduced.hybridalDamage || 0) * multiplier),
    };

    totalReducedDamage =
      (totalDamageSourcesReduced.piercingDamage || 0) +
      (totalDamageSourcesReduced.physical || 0) +
      (totalDamageSourcesReduced.magical || 0) +
      (totalDamageSourcesReduced.hybridalDamage || 0);

    finalLog.occultismFragility.attempted = true;
    finalLog.occultismFragility.applied = true;
    finalLog.occultismFragility.percent = occultismFragilityPercent;
    finalLog.occultismFragility.multiplier = multiplier;
    finalLog.occultismFragility.before = beforeOccultismFragility;
    finalLog.occultismFragility.after = { ...totalDamageSourcesReduced };
    finalLog.occultismFragility.beforeTotal = beforeOccultismFragilityTotal;
    finalLog.occultismFragility.afterTotal = totalReducedDamage;

    finalLog.sources.afterOccultismFragility = { ...totalDamageSourcesReduced };
    finalLog.totals.totalAfterOccultismFragility = totalReducedDamage;

    console.log(
      `🌑 Fragilité des ombres : ${target.name} est invisible → dégâts reçus +${occultismFragilityPercent}% (${beforeOccultismFragilityTotal} → ${totalReducedDamage}).`
    );
	EffectMessage(target, "Fragilité !");
  } else {
    finalLog.occultismFragility.attempted = targetIsOccultismInvisible;
    finalLog.occultismFragility.applied = false;
    finalLog.occultismFragility.percent = occultismFragilityPercent;
    finalLog.sources.afterOccultismFragility = { ...totalDamageSourcesReduced };
  }
  const damageBeforeCritical = totalReducedDamage;
  if (flags.canCrit) {
    finalLog.critical.attempted = true;

    const critResult = attemptCriticalHit(attacker, target, totalReducedDamage);
    finalLog.critical.isCritical = !!critResult.isCritical;
    finalLog.critical.chance = critResult.critTotalChance;
    finalLog.critical.bonusPercent = critResult.critDamageBonus;
    finalLog.critical.before = totalReducedDamage;

    if (critResult.isCritical) {
		 finalLog.attackModifiers.critical = true;
      popupType = "critical";
      attackDetail = { ...attackDetail, effets: [...new Set([...(attackDetail.effets || []), 'criticalHit'])] };

      totalReducedDamage = critResult.finalDamage;
      finalLog.critical.afterCrit = totalReducedDamage;

      const beforeResCrit = totalReducedDamage;
      totalReducedDamage = attemptResilienceCritReduction(attacker, target, totalReducedDamage, damageBeforeCritical);
      finalLog.critical.afterResilienceCritReduction = totalReducedDamage;
      finalLog.critical.resilienceCritReductionDelta = beforeResCrit - totalReducedDamage;
      if (beforeResCrit > totalReducedDamage) recordEntityCombatProc(target, 'resilienceCrit');
    } else {
      finalLog.critical.afterCrit = totalReducedDamage;
      finalLog.critical.afterResilienceCritReduction = totalReducedDamage;
      finalLog.critical.resilienceCritReductionDelta = 0;
    }
  } else {
    finalLog.critical.attempted = false;
    finalLog.critical.skippedByAttackRules = true;
  }

  const pipelineOut = Number(totalReducedDamage) || 0;

  const indReduc =
    (target.stats?.armor?.current || 0) <= 0
      ? (Number(caluclateIndestructibilityReductionTotal(target)) || 0)
      : 0;

  const afterInd = indReduc > 0 ? pipelineOut * Math.max(0, 1 - indReduc / 100) : pipelineOut;

  const finalDamagePreAstrality = Math.max(0, Math.round(afterInd));
  target.stats.HP.current = Math.max(0, hpBefore - finalDamagePreAstrality);

  let astralityTriggered = false;
  if (target.stats.HP.current <= 0 && attemptAstrality(attacker, target)) {
    target.stats.HP.current = 1;
    startAstralReturn(target);
    target.flags = target.flags || {};
    target.flags.astralityLastStand = true;
    astralityTriggered = true;
    recordEntityCombatProc(target, 'astrality');
    try {
      typeof EffectMessage === "function" && EffectMessage(target, "Survie fatale !");
    } catch {}
  }

  const hpAfter = target.stats.HP.current;
  wakeFromDamage(target, hpBefore, Math.max(0, hpBefore - hpAfter));
  const hpLoss = hpBefore - hpAfter;
  const damageApplied = hpLoss;
  const defenseModifiers = {
    inert: getAttackNatureRules(attackDetail).isInert,
    resilience: finalLog.resilience.applied ? finalLog.resilience.percent : 0,
    resilienceCarry: finalLog.resilience.carryBefore,
    esoterism: finalLog.esoterism.applied ? finalLog.esoterism.reductionPercent : 0,
    occultismFragility: finalLog.occultismFragility.applied ? finalLog.occultismFragility.percent : 0,
    critical: finalLog.critical.isCritical,
    criticalBonus: finalLog.critical.bonusPercent,
    resilienceCrit: finalLog.critical.isCritical
      ? calculateResilienceCritTotalBonus(target) : 0,
    indestructibility: indReduc,
  };
  const defenseContributions = {};
  const hpCap = astralityTriggered ? Math.max(0, hpBefore - 1) : hpBefore;
  for (const key of ['resilience', 'esoterism', 'resilienceCrit', 'indestructibility', 'occultismFragility']) {
    if (!(defenseModifiers[key] > 0)) continue;
    const without = Math.min(hpCap, calculateDefensiveHpOutcome(attacker, target,
      defenseInput, { ...defenseModifiers, [key]: 0 }));
    defenseContributions[key] = Math.max(0, key === 'occultismFragility' ? damageApplied - without : without - damageApplied);
  }
  if (astralityTriggered) defenseContributions.astrality = Math.max(0, finalDamagePreAstrality - 1);
  if (Object.keys(defenseContributions).length) recordEntityDefenseHp(target, defenseContributions);
  const baseHitWithoutCritical = Math.min(hpBefore, Math.max(0, Math.round(
    damageBeforeCritical * Math.max(0, 1 - indReduc / 100)
  )));
  const criticalBonusCredited = finalLog.critical.isCritical
    ? Math.max(0, damageApplied - Math.min(baseHitWithoutCritical, astralityTriggered ? hpBefore - 1 : hpBefore))
    : 0;
  const armorAfterGlobal = Number(target.stats?.armor?.current) || 0;
  const armorDamageApplied = Math.max(0, Math.round(armorBeforeGlobal - armorAfterGlobal));
  const damageCredited = damageApplied + armorDamageApplied;
  recordEntityDamageReceived(target, damageApplied, armorDamageApplied);

const overkillDamage = finalDamagePreAstrality - damageApplied;

if (
  target.stats.HP.current <= 0 &&
  overkillDamage > 0 &&
  overkillDamage >= hpBefore * 1.5
) {
  finalLog.attackModifiers.overkill = {
    excess: overkillDamage,
    hpBefore,
  };
   recordEntityCombatStat(attacker, 'overkills');
   EffectMessage(target, "OVERKILL !");
} if (
  finalLog.attackModifiers.execution &&
  target.stats.HP.current <= 0
) {
  attacker.flags = attacker.flags || {};
  attacker.flags.bloodCrazyNextExecution = true;
  finalLog.attackModifiers.bloodCrazyGain = true;

  syncEntityAuras(attacker, "battle");

  const attackerCanvas = document.getElementById(`spriteCanvas_${attacker.id}`);

  if (attackerCanvas) {
    applyEntityTint(attackerCanvas, "bloodCrazy", 0.65);
  }

  const auraContainer = document.querySelector(`#auraContainer_${attacker.id}`);

  if (auraContainer && !auraContainer.querySelector(".picto-stat.bloodCrazy")) {
    const bloodCrazyAura = document.createElement("div");
    bloodCrazyAura.className = "picto-stat bloodCrazy";
    auraContainer.appendChild(bloodCrazyAura);
  }
}
const applyExecutionHealing = () => {
// Voracité sanguinaire
if (
  finalLog.attackModifiers.execution &&
  finalLog.attackModifiers.overkill
) {
  const hp = attacker?.stats?.HP;

  if (hp && typeof hp === "object") {
    const hpBeforeGlutony = Number(hp.current) || 0;
    const hpMaxGlutony = Number(hp.max) || 0;

    hp.current = hpMaxGlutony;

    const healGlutony = Math.max(0, hpMaxGlutony - hpBeforeGlutony);

    finalLog.attackModifiers.bloodGlutony = true;
    finalLog.attackModifiers.bloodGlutonyHeal = healGlutony;
    recordEntityCombatProc(attacker, 'bloodGlutony');

    if (healGlutony > 0) {
      attacker.totalHeal = (Number(attacker.totalHeal) || 0) + healGlutony;
      updateTotalHealCounter(attacker.id, attacker.totalHeal);
      recordEntityHealingDone(attacker, healGlutony, combatRangeFromFlags(flags));
      recordEntityHealingReceived(attacker, healGlutony);
    }

    saveEntityHPToStorage(attacker);

    updateHealthBar(
      attacker.stats.HP.current,
      attacker.stats.HP.max,
      attacker.stats.armor?.current || 0,
      attacker.stats.armor?.max || 0,
      attacker.id
    );

    updateHPCounters(
      attacker.id,
      attacker.stats.HP.current,
      attacker.stats.HP.max
    );

    if (healGlutony > 0) {
      PopUpDamages(
        attacker,
        healGlutony,
        "blood-glutony",
        null,
        {},
        "blood-glutony"
      );
    }
  }
}
};
if (!deferCombatEffect(applyExecutionHealing)) applyExecutionHealing();
  finalLog.out.pipelineOut = pipelineOut;
  finalLog.out.indReducPercent = indReduc;
  finalLog.out.afterInd = afterInd;
  finalLog.out.finalDamage = finalDamagePreAstrality;
  finalLog.out.hpLoss = hpLoss;
  finalLog.out.armorDamageApplied = armorDamageApplied;
  finalLog.out.damageCredited = damageCredited;
  finalLog.out.astralityTriggered = astralityTriggered;
finalLog.attackModifiers.astrality = astralityTriggered;

const applyImpactLeech = () => {
if (flags.canBloodThirsty) {
  const bloodThirstyPoints = Number(attacker?.stats?.bloodThirsty || 0);

  if (bloodThirstyPoints > 0 && damageApplied > 0) {
    const bloodThirstyPercent = getBloodThirstyPercent(bloodThirstyPoints);

    if (bloodThirstyPercent > 0) {
      const hpBeforeBloodThirsty =
        attacker?.stats?.HP?.current ?? attacker?.stats?.HP ?? 0;

      LifestealBloodFury(
        attacker,
        target,
        damageApplied,
        bloodThirstyPercent,
        combatRangeFromFlags(flags)
      );

      const hpAfterBloodThirsty =
        attacker?.stats?.HP?.current ?? attacker?.stats?.HP ?? 0;

      const bloodThirstyHeal = Math.max(
        0,
        hpAfterBloodThirsty - hpBeforeBloodThirsty
      );

      if (bloodThirstyHeal > 0) {
        finalLog.attackModifiers.bloodThirstyHeal = bloodThirstyHeal;
      }
    }
  }
}
};
if (!deferCombatEffect(applyImpactLeech)) applyImpactLeech();
  if (String(attacker.id) !== String(target.id)) {
    attacker.totalDamage += damageCredited;
    if (damageCredited > 0) recordEntityDamageDetails(attacker, combatDamageNature(attackDetail), {
      summonOrigin: attackDetail.summonStatsOrigin,
      armorDamage: armorDamageApplied,
      hpDamage: damageApplied,
      armorSources: incomingArmorSources,
      hpSources: totalDamageSourcesReduced,
      hybridPhysicalShare,
      critical: finalLog.critical.isCritical === true,
      criticalBonusDamage: criticalBonusCredited,
      execution: finalLog.attackModifiers.execution === true,
      ambidextry: attackDetail.ambidextryHitIndex === 2,
      hypercognition: attackDetail.essenceSlots?.some(slot => slot.active !== false && slot.color === 'blue' && slot.hyperco) === true,
      range: combatRangeFromFlags(flags),
    });
  }

const balancedNoAggro =
  Boolean(attackDetail.isBalancedNoAggro);

const aggroDamageApplied = balancedNoAggro ? 0 : damageApplied;

attacker.totalAggroDamage += aggroDamageApplied;

if (balancedNoAggro && damageApplied > 0) {
  console.log(
    `⚖️ ${attacker.name} génère 0 aggro avec Attaque équilibrée (${damageApplied} dégâts ignorés pour l'aggro).`
  );
}

updateTotalDamageCounter(`TotalDamages_${attacker.id}`, attacker.totalDamage);

  console.log(`❤️ ${target.name} perd ${damageApplied} HP (${target.stats.HP.current}/${target.stats.HP.max}).`);

  saveEntityHPToStorage(target);

  const armorGate = armorDamageApplied;
const isExecutionCritical =
  finalLog.attackModifiers.execution &&
  finalLog.attackModifiers.critical;

const finalPopupType = isExecutionCritical
  ? "execution-critical"
  : finalLog.attackModifiers.execution ? "execution" : popupType;
  
PopUpDamages(
  target,
  damageApplied,
  attackDetail.effets,
  popupContent,
  totalDamageSourcesReduced,
  finalPopupType,
  armorGate,
  getAttackNatureRules(attackDetail).stat
);

  const applyImpactEffects = () => {
    if (attackDetail.effets) attackDetail.effets.forEach(effectName => applyEffect(target, effectName, attacker, attackDetail));
    applySelfEffects(attacker, damageApplied, selfEffects, combatRangeFromFlags(flags), attackDetail);
  };
  if (!deferCombatEffect(applyImpactEffects)) applyImpactEffects();

  updateScore(attacker, damageApplied);
  deductScore(target, damageApplied);

  updateHealthBar(
    target.stats.HP.current,
    target.stats.HP.max,
    target.stats.armor?.current || 0,
    target.stats.armor?.max || 0,
    target.id
  );

  LifeandDeath(target, attacker, { summonOrigin: attackDetail.summonStatsOrigin });

  finalLog.popupType = popupType;
  finalLog.effectsApplied = [...(attackDetail.effets || [])];

  finalLog.totals = {
    totalDamageArg: totalDamage,
    armorStepRemainingDamage: remainingDamage,

    rawTotalBase: finalLog.totals.rawTotalBase,
    rawTotalAfterArmorGate: finalLog.totals.rawTotalAfterArmorGate,
    rawTotalAfterRangeRatio: finalLog.totals.rawTotalAfterRangeRatio,
    rawTotalAfterResilience: finalLog.totals.rawTotalAfterResilience,

    totalAfterResistances: finalLog.totals.totalAfterResistances,
    totalAfterEsoterism: finalLog.totals.totalAfterEsoterism,

    pipelineOut,
    indReduc,
    afterInd,
    finalDamagePreAstrality,
    damageApplied,
  };

  finalLog.hp = {
    hpBefore,
    hpAfter: target.stats.HP.current,
    hpMax: target.stats.HP.max,
    delta: damageApplied,
    astralityTriggered,
  };

console.log(`
==============================
⚔️ RÉSUMÉ FINAL DÉGÂTS
==============================
👤 Attaquant : ${attacker.name}
🎯 Cible : ${target.name}
🗡️ Sources finales HP :→ Piercing : ${totalDamageSourcesReduced.piercingDamage || 0}
→ Physique : ${totalDamageSourcesReduced.physical || 0}
→ Magique : ${totalDamageSourcesReduced.magical || 0}
→ Hybride : ${totalDamageSourcesReduced.hybridalDamage || 0}

🛡️ Armor absorbée :
→ ${absorbedByArmor || 0}

📊 Dégâts crédités (armure + HP) :
→ ${damageCredited}

🗡️ Armor bypass :
→ ${purePiercingArmorBypass || 0}

❤️ HP perdus :
→ ${damageApplied || 0}

🧱 Armor restante :
→ ${target.stats?.armor?.current || 0}/${target.stats?.armor?.max || 0}

💀 HP restants :
→ ${target.stats?.HP?.current || 0}/${target.stats?.HP?.max || 0}
==============================
`);


  const logImpact = () => logFinalDamageResolution(finalLog);
  if (!deferCombatEffect(logImpact)) logImpact();

  if (target.isDEAD) {
    console.log(`${target.name} est mort suite aux dégâts infligés.`);
  }
  const applyNature = () => applyAttackNatureEffect(target, attacker, attackDetail);
  if (!deferCombatEffect(applyNature)) applyNature();
  return { hit: true, critical: finalLog.critical.isCritical === true };
}

function consumeBloodCrazy(attacker) {
  if (!attacker) {
    return;
  }

  attacker.flags = attacker.flags || {};

  if (!attacker.flags.bloodCrazyNextExecution) {
    return;
  }

  attacker.flags.bloodCrazyNextExecution = false;

  // Le module centralisé nettoie les FX, timers et glow de combat.
  syncEntityAuras(
    attacker,
    "battle"
  );

  // Mise à jour immédiate du Codex lorsqu’il est ouvert.
  const codexAuraContainer =
    document.getElementById(
      `auraContainer_codex_${attacker.id}`
    );

  if (codexAuraContainer) {
    syncEntityAuras(
      attacker,
      codexAuraContainer
    );
  }

  // Le pictogramme est encore créé manuellement :
  // il reste donc nettoyé ici.
  document
    .querySelectorAll(
      `#auraContainer_${attacker.id}
       .picto-stat.bloodCrazy,
       #auraContainer_codex_${attacker.id}
       .picto-stat.bloodCrazy`
    )
    .forEach((element) => {
      element.classList.add("consumed");

      setTimeout(() => {
        element.remove();
      }, 450);
    });

  const attackerCanvas =
    document.getElementById(
      `spriteCanvas_${attacker.id}`
    );

  if (attackerCanvas) {
    releaseEntityTint(
      attackerCanvas,
      "bloodCrazy"
    );
  }
}
export function applySelfEffects(attacker, totalReducedDamage, selfEffects = [], range = 'other', attack = null) {
  if (!selfEffects || selfEffects.length === 0) return;

  selfEffects.forEach(effectName => {
    const effectData = evaluateAttackEffect(getAttackEffect(attack, effectName, { self: true }), attacker); // 🔎 Recherche l'effet
    if (!effectData) {
      console.warn(`⚠️ Effet ${effectName} non trouvé dans attackEffects.`);
      return;
    }

    const handler = getAttackEffectHandler(effectName, { self: true });
    if (handler) handler(attacker, totalReducedDamage, effectData, range);
    else applyEffect(attacker, effectName, attacker, attack, { ...effectData, selfApplication: true });
  });
}


export async function applyDamageToDead(target, damage, attacker, currentAttack) {
    if (!target?.isDEAD || target.corpseConsumed) return 'miss';
    const attack = typeof currentAttack === 'string'
        ? resolveAttackDefinitionForEntity(attacker, currentAttack, attackDetails) : currentAttack;
    if (!attack) return 'miss';
    for (const effect of attack.effets || []) {
        const result = await applyEffect(target, effect, attacker, attack);
        if ((effect === 'rez' || effect === 'summonProfanation') && !result) return 'miss';
    }
    if (attack.combatFunction === 'Support') {
        attacker.totalResurrects = (attacker.totalResurrects || 0) + 1;
        applyAttackNatureEffect(target, attacker, attack);
    } else {
        attacker.totalProfanations = (attacker.totalProfanations || 0) + 1;
    }
    updateScore(attacker, 2);
    return 'hit';
}

export async function applyDamageToHex(target, attacker, attack) {
    if (!target?.isConnected || !target.classList.contains('hex')) return 'miss';
    for (const effectName of attack.effets || []) {
        const result = await applyEffect(target, effectName, attacker, attack);
        if (result === false || result?.ok === false) return 'miss';
        target.appliedEffects ||= [];
        target.appliedEffects.push({
            effectName,
            attacker: attacker.name,
            timestamp: clockNow(),
            result: result?.status || 'applied',
        });
    }
    return 'hit';
}
// Combat and scoring resolve the same handler; scoring only reads its metadata.
export function getAttackEffectHandler(effectName, { self = false } = {}) {
  if (self) return effectName === 'lifesteal' ? lifesteal : null;
  if (/^(bonus|malus)-/.test(effectName)) return statModifier;
  if (effectName === 'gigantisme') return gigantisme;
  const handlers = { poison, brulure, heal, rez, summonJarret, summonProfanation, grab, lourdeur, immobilisation, stun, silence, interruption, bafouillage, lenteur, folie, confusion, charme, insolence, effroi, sommeil };
  return Object.hasOwn(handlers, effectName) ? handlers[effectName] : null;
}

// APPLY EFFECT
export function applyEffect(target, effectName, attacker, attack = null, evaluatedEffect = null) {
  const effect = evaluatedEffect || evaluateAttackEffect(getAttackEffect(attack, effectName), attacker);
  if (!effect) {
    console.warn(`Effect ${effectName} not found.`);
    return;
  }

  // 👉 Vérifie si c'est une altération d'état
  const isAlteration = isAlterationEffect(effect) || isHindranceEffect(effect, attacker, target);

  // 🎯 Tentative d'annulation À L'IMPACT (une seule fois)
  if (isAlteration) {
    const resistance = attemptAlterationResistance(attacker, target, effect);
    if (resistance.canceled) {
      recordEntityCombatProc(target, resistance.kind);
      console.log(`⛔ Altération "${effectName}" annulée à l'impact sur ${target.name}.`);
      return 'alteration_canceled'; // on sort : rien n’est appliqué, aucun tick ne sera lancé
    }
  }

  // Ajoute automatiquement la classe CSS basée sur le nom de l'effet
  toggleEffectClass(target, effectName, 'add');

  const handler = getAttackEffectHandler(effectName);
  if (handler) {
    const appliedEffect = { ...prepareResilienceEffect(target, effect, handler), provenance: effectProvenance(attacker, attack, effect),
      sourceLabel: [attacker.name, attack?.displayName].filter(Boolean).join(' · '), sourcePortrait: attacker.portrait };
    const result = handler(target, appliedEffect, attacker, () => toggleEffectClass(target, effectName, 'remove'));
    if (effect.statKey || effectName === 'gigantisme') return result;
    return ['rez', 'summonJarret', 'summonProfanation', 'grab', 'lourdeur', 'immobilisation', 'stun', 'silence', 'interruption', 'bafouillage', 'lenteur', 'folie', 'confusion', 'charme', 'insolence', 'effroi', 'sommeil'].includes(effectName) ? result : undefined;
  }
  toggleEffectClass(target, effectName, 'remove');
}

export function updateCurrentAttackDisplay(entite) {
    const img = document.getElementById(`currentAttackImage_${entite.id}`);
    if (!img) return;

    const attack = resolveAttackDefinitionForEntity(
        entite,
        entite.currentAttackId || entite.attacks?.[0],
        attackDetails
    );

    if (attack) {
        if (entite.type === 'lord') {
            const root = getBattleEntityElement(entite);
            if (root) {
                root.dataset.attackFunction = attack.combatFunction;
                root.dataset.attackDomain = attack.attackTarget[0] === 'hexa' ? 'invocateur'
                    : attack.deadTarget?.includes('yes') ? 'necro' : 'combattant';
            }
        }
        const visual = img.closest('.active-attack-visual');
        if (visual) {
            visual.classList.remove('Attaquant', 'Support', 'Arbitre', 'Necro', 'Invocateur');
            visual.classList.add(attack.combatFunction);
            if (attack.deadTarget?.includes('yes')) visual.classList.add('Necro');
            if (attack.attackTarget?.includes('hexa')) visual.classList.add('Invocateur');
        }
        img.src = cachedResourceUrl(attack.attackAsset
            ? `${attack.attackAsset}-ld.jpg`
            : '');

        img.alt = attack.displayName || 'Attaque en cours';
    } else {
        img.src = cachedResourceUrl('');
        img.alt = 'Attaque inconnue';
    }
}
