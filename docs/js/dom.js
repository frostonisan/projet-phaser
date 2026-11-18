import { showDamagePopup } from './combatPopups.js';
import { setTimeout } from './combatClock.js';
import { entites } from "./entites.js";
import { attackDetails } from "./data/attackList.js";
import { gameStarted } from "./gameState.js";
import { EffectMessage } from "./attackEffectMecanics.js";
import { getSafe } from "./entite/entityRules.js";
import { resolveAttackDefinitionForEntity, resolveEntityAttackDisplayName } from "./attackResolution.js";
import { getEntityCombatDetails } from "./entityUpdatesStorage.js";

export { DRAG_HELPER_CLEANUP_EVENT, isDragDropActive, clearDragTransientHelpers, beginDragHelperCleanup, endDragHelperCleanup, bindDragHelperCleanupGuards } from './ui/dragHelpers.js';

// Combat HUD and entity counters.
// TIMERS ENTITES
const attackTimerViews = new WeakMap();
let timerNodes = new WeakMap();
function timerNode(entity, id) {
  let nodes = timerNodes.get(entity);
  if (!nodes) timerNodes.set(entity, nodes = new Map());
  const node = nodes.get(id);
  // Editor rebuilds, revival and F5 can replace the whole entity DOM.
  if (node?.isConnected && node.id === id && node.ownerDocument === document) return node;
  const current = document.getElementById(id);
  if (current) nodes.set(id, current);
  else nodes.delete(id);
  return current;
}
function setTimerStyle(node, key, value) {
  if (node && node.style[key] !== value) node.style[key] = value;
}
function toggleTimerClass(node, key, enabled) {
  if (node && node.classList.contains(key) !== enabled) node.classList.toggle(key, enabled);
}
function setTimerText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}
function setTimerClass(node, value) {
  if (node.className !== value) node.className = value;
}
export function updateTimerDisplay(entite) {
  if (entite.currentPhase === 'cooldown-wait') return;
  const hudNode = id => timerNode(entite, id);
  if (entite.currentPhase === 'target-search' || entite.currentPhase === 'target-search-recovery') {
    const recovering = entite.currentPhase === 'target-search-recovery';
    const percent = recovering
      ? Math.max(0, Math.min(100, (Number(entite.recoveryTime) || 0) / Math.max(1, entite.maxRecoveryTime || 1) * 100))
      : 100;
    for (const prefix of ['atbFill_', 'HUATBfill_', 'scanATBFill_']) {
      const bar = hudNode(prefix + entite.id);
      setTimerStyle(bar, 'width', `${percent}%`);
    }
    const speed = hudNode(`SpeedInterface_${entite.id}`);
    toggleTimerClass(speed, 'preparation', false);
    toggleTimerClass(speed, 'execution', false);
    toggleTimerClass(speed, 'recuperation', recovering);
    const bar = hudNode(`currentAttackBar_${entite.id}`);
    if (bar) {
      setTimerStyle(bar, "width", '0%');
      setTimerClass(bar, 'attack-bar-fill empty');
    }
    return;
  }
  const updateElementTextContent = (elementId, text) => {
    const element = hudNode(elementId);
    setTimerText(element, text);
};
// ✅ Classes d'état sur la SpeedInterface : preparation / execution / recuperation
const speedInterface = hudNode(`SpeedInterface_${entite.id}`);
if (speedInterface) {
  const isPreparation = (Number(entite.preparationTime) || 0) > 0;
  const isExecution = (Number(entite.executionTime) || 0) > 0;
  const isRecuperation = (Number(entite.recoveryTime) || 0) > 0 && !isExecution;

  toggleTimerClass(speedInterface, "preparation", isPreparation);
  toggleTimerClass(speedInterface, "execution", isExecution);
  toggleTimerClass(speedInterface, "recuperation", isRecuperation);
}
    const updateATBFill = (percent) => {
        const atbFillElement = hudNode(`atbFill_${entite.id}`);
        if (atbFillElement) {
            setTimerStyle(atbFillElement, "width", `${percent}%`);
        }
    };

    if (entite.speedTimer === undefined) {
        entite.speedTimer = 0;
    }

    const ATBfillIn = () => {
        if (entite.isATBFull) return;

        const maxSpeedTimer = Number(getSafe(entite, "speed", 1000)) || 1000;
        let currentPercent = ((maxSpeedTimer - entite.speedTimer) / maxSpeedTimer) * 100;

        entite.isATBFull = currentPercent >= 100;
        updateATBFill(Math.min(100, currentPercent));
    };

    const ATBfillOut = () => {
        if (entite.recoveryTime > 0) {
            if (typeof entite.maxRecoveryTime === 'undefined' || entite.maxRecoveryTime <= 0) {
                entite.maxRecoveryTime = entite.recoveryTime;
            }
            let currentPercent = (entite.recoveryTime / entite.maxRecoveryTime) * 100;
            updateATBFill(Math.max(0, currentPercent));
        }
    };

const ATBfillRunaway = () => {
    // orderDecision : descente fluide de ATB vers 0
    if (entite.orderPhase === 'orderDecision' && entite.recoveryTime > 0 && entite.maxRecoveryTime > 0) {
        const percent = (entite.recoveryTime / entite.maxRecoveryTime) * (entite.ATBfillBeforeOrder || 100);
        updateATBFill(Math.max(0, percent));
        return;
    }

    // orderExecution : remplissage fluide vers 100%
    if (entite.orderPhase === 'orderExecution' && entite.orderExecutionTime > 0 && entite.maxOrderExecutionTime > 0) {
        const percent = ((entite.maxOrderExecutionTime - entite.orderExecutionTime) / entite.maxOrderExecutionTime) * 100;
        updateATBFill(Math.min(100, percent));
        return;
    }
};

// Spécial ATB pour la phase runawayPreparation
// === PHASE SPÉCIALE : runawayRecovery → vidange
if (entite.orderPhase === 'runawayRecovery') {
    const max = entite.maxRecoveryTime || entite.runawayLoopRecuperation || Number(getSafe(entite, "speed", 1000)) || 1000;
    const percent = (entite.recoveryTime / max) * 100;
    updateATBFill(Math.max(0, percent));
    return;
}

// === PHASE SPÉCIALE : runawayPreparation → remplissage
if (entite.orderPhase === 'runawayPreparation') {
    const max = entite.maxPreparationTime || entite.runawayLoopPreparation || Number(getSafe(entite, "speed", 1000)) || 1000;
    const filled = max - entite.speedTimer;
    const percent = (filled / max) * 100;
    updateATBFill(Math.min(100, percent));
    return;
}

    // === 🟦 PHASES CLASSIQUES ===
    if (entite.orderPhase !== 'orderDecision' && entite.orderPhase !== 'orderExecution') {
 if (entite.speedTimer > 0) ATBfillIn();

    if (entite.preparationTime > 0 || entite.executionTime > 0) {
        const img = hudNode(`currentAttackImage_${entite.id}`);
        toggleTimerClass(img, 'attack-executed', false);
        updateATBFill(100);
    } else if (
        entite.speedTimer === 0 &&
        entite.preparationTime === 0 &&
        entite.executionTime === 0 &&
        entite.recoveryTime === 0
    ) {
        updateATBFill(100);
    }

if (entite.executionTime === 0 && entite.recoveryTime > 0) {
    ATBfillOut();

    if (entite.wasInExecution) {
        const img = hudNode(`currentAttackImage_${entite.id}`);
        toggleTimerClass(img, 'attack-executed', true);
        entite.wasInExecution = false;
    }

    // ✅ Suppression systématique pendant récupération
    const img = hudNode(`currentAttackImage_${entite.id}`);
  }
       if (
    entite.speedTimer === 0 &&
    entite.preparationTime === 0 &&
    entite.executionTime === 0 &&
    entite.recoveryTime === 0
) {
    entite.speedTimer = Number(getSafe(entite, "speed", 1000)) || 1000;
    entite.rangeExecutedFlag = false; // 🔁 reset du déclencheur
}
    }

    // === 🟥 PHASES DE FUITE ===
    if (entite.orderPhase === 'orderDecision' || entite.orderPhase === 'orderExecution') {
        ATBfillRunaway();
    }

// === 🟥 JAUGE ATTAQUE ===
const updateCurrentAttackBar = () => {
   const el = hudNode(`currentAttackBar_${entite.id}`);
    if (!el) return;

    if (!entite.currentAttack) return;

    const { preparationTime, executionTime, recoveryTime } = entite.currentAttack;

    // Préparation → remplissage jaune
if (entite.preparationTime > 0) {
  const percent = ((preparationTime - entite.preparationTime) / preparationTime) * 100;
  setTimerStyle(el, "width", `${Math.min(100, percent)}%`);
  setTimerClass(el, 'attack-bar-fill preparation');

  // Détection attaque à distance
  const isRange = entite.currentAttack?.attackRange?.includes('range');
  const isAboutToEnd = entite.preparationTime <= 50; // marge de sécurité si t’as un timer précis (en ms)

if (isRange && isAboutToEnd && !entite.rangeExecutedFlag) {
    const img = hudNode(`currentAttackImage_${entite.id}`);
    toggleTimerClass(img, 'attack-executed', false); // ✅ suppression pour les attaques à distance
    entite.rangeExecutedFlag = true;
}

  return;
}

// Exécution → full bar rouge
if (entite.executionTime > 0) {
    setTimerStyle(el, "width", '100%');
    setTimerClass(el, 'attack-bar-fill execution');

    const execTime = Number(entite.executionTime) || 0;
    const execMax = Number(entite.currentAttack?.executionTime) || 1;
    const ratio = Math.max(0, Math.min(1, execTime / execMax));
    const duration = 0.05 + (1.5 - 0.05) * ratio;
setTimerStyle(el, "animationDuration", `${duration}s`);

    // 👇 Ici ! On note que l'entité est actuellement en exécution
    entite.wasInExecution = true;

    return;
}
    //Récupération → vidange verte
    if (entite.recoveryTime > 0) {
		
        // const percent = (entite.recoveryTime / recoveryTime) * 100;
        // setTimerStyle(el, "width", `${Math.max(0, percent)}%`);
        setTimerClass(el, 'attack-bar-fill recovery');
        return;
    }

    // Par défaut (aucune phase en cours)
    setTimerStyle(el, "width", '0%');
    setTimerClass(el, 'attack-bar-fill empty');
};

    // === 🟨 AFFICHAGE DES TIMERS ===
  // Preserve the state updates above and in the attack bar. An isolated
  // simulation does not need text, HTML or attack-name resolution every tick.
  if (window.__combatSimulation === true) {
    updateCurrentAttackBar();
    return;
  }
  updateElementTextContent(`speedTimer_${entite.id}`, `ATB : ${isNaN(entite.speedTimer) ? "0.0" : (entite.speedTimer / 1000).toFixed(1)}s`);

const prepTime = isNaN(entite.preparationTime) ? 0 : (entite.preparationTime / 1000).toFixed(1);
const execTime = isNaN(entite.executionTime) ? 0 : (entite.executionTime / 1000).toFixed(1);
const attackDisplayName = resolveEntityAttackDisplayName(
  entite,
  entite.currentAttackId || entite.attacks?.[0],
  attackDetails
);

const battlePrepEl = hudNode(`battlePreparation_${entite.id}`);
if (battlePrepEl) {
  let view = attackTimerViews.get(battlePrepEl);
  if (!view || view.name.parentNode !== battlePrepEl || view.preparation.parentNode !== battlePrepEl || view.execution.parentNode !== battlePrepEl) {
    battlePrepEl.innerHTML = `
      <span class="timer-activeattack attackname"></span>
      <span class="timer-activeattack preparation" id="attackPrep_${entite.id}"></span>
      <span class="timer-activeattack execution" id="attackExec_${entite.id}" style="display: none;"></span>
    `;
    view = { name: battlePrepEl.querySelector('.attackname'), preparation: battlePrepEl.querySelector('.preparation'),
      execution: battlePrepEl.querySelector('.execution'), label: null };
    attackTimerViews.set(battlePrepEl, view);
  }
  if (view.label !== attackDisplayName) { view.name.innerHTML = attackDisplayName; view.label = attackDisplayName; }
  setTimerText(view.preparation, `${prepTime}s`);
  setTimerText(view.execution, `${execTime}s`);
}


const prepCurrent = isNaN(entite.preparationTime) ? 0 : (entite.preparationTime / 1000).toFixed(1);
const prepMax = entite.currentAttack?.preparationTime ? (entite.currentAttack.preparationTime / 1000).toFixed(1) : '0.0';
updateElementTextContent(`preparationTimer_${entite.id}`, `Preparation: ${prepCurrent} / ${prepMax}s`);

const execCurrent = isNaN(entite.executionTime) ? 0 : (entite.executionTime / 1000).toFixed(1);
const execMax = entite.currentAttack?.executionTime ? (entite.currentAttack.executionTime / 1000).toFixed(1) : '0.0';
updateElementTextContent(`executionTimer_${entite.id}`, `Execution: ${execCurrent} / ${execMax}s`);

const cooldownCurrent = isNaN(entite.cooldownTimer) ? 0 : (entite.cooldownTimer / 1000).toFixed(1);
const cooldownMax = entite.currentAttack?.cooldown ? (entite.currentAttack.cooldown / 1000).toFixed(1) : '0.0';
updateElementTextContent(`cooldownDisplay_${entite.id}`, `Cooldown: ${cooldownCurrent} / ${cooldownMax}s`);

const recoveryCurrent = isNaN(entite.recoveryTime) ? 0 : (entite.recoveryTime / 1000).toFixed(1);
const recoveryMax = entite.currentAttack?.recoveryTime ? (entite.currentAttack.recoveryTime / 1000).toFixed(1) : '0.0';
updateElementTextContent(`recoveryTimer_${entite.id}`, `Recovery: ${recoveryCurrent} / ${recoveryMax}s`);

	
updateCurrentAttackBar();


const prepSpan = hudNode(`attackPrep_${entite.id}`);
const execSpan = hudNode(`attackExec_${entite.id}`);

if (prepSpan && execSpan) {
  if (entite.preparationTime > 0) {
    setTimerStyle(prepSpan, "display", 'inline');
    setTimerStyle(execSpan, "display", 'none');
  } else if (entite.executionTime > 0) {
    setTimerStyle(prepSpan, "display", 'none');
    setTimerStyle(execSpan, "display", 'inline');
  } else {
    // si aucune des deux phases n'est active
    setTimerStyle(prepSpan, "display", 'none');
    setTimerStyle(execSpan, "display", 'none');
  }
}
}


const levelBattleStarts = new WeakMap();
const levelBattleDetailStarts = new WeakMap();
const battleTotalKeys = [
    "kills", "deaths", "resurrections", "overkills", "battlesFought",
    "extraLivesUsed", "totalDamage", "totalHeal"
];

export function resetLevelBattleStats(entities) {
    for (const entity of entities) {
        if (!entity) continue;
        levelBattleStarts.set(entity, Object.fromEntries(
            battleTotalKeys.map(key => [key, Math.max(0, Number(entity[key]) || 0)])));
        levelBattleDetailStarts.set(entity, structuredClone(getEntityCombatDetails(entity)));
    }
}

export function getLevelBattleStats(entity) {
    const start = levelBattleStarts.get(entity) || {};
    return Object.fromEntries(battleTotalKeys.map(key => [key,
        Math.max(0, (Number(entity?.[key]) || 0) - (start[key] || 0))]));
}

export function getLevelCombatDetails(entity) {
    const current = getEntityCombatDetails(entity);
    const start = levelBattleDetailStarts.get(entity) || {};
    const delta = (value, baseline) => typeof value === 'string' ? value : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, part]) => [key, delta(part, baseline?.[key])]))
        : Math.max(0, (Number(value) || 0) - (Number(baseline) || 0));
    return delta(current, start);
}

function levelBattleValue(counterId, prefix, key, fallback) {
    const id = String(counterId).slice(prefix.length);
    const entity = entites.find(candidate => String(candidate.id) === id);
    return entity ? getLevelBattleStats(entity)[key] : Math.max(0, Number(fallback) || 0);
}

if (typeof window !== "undefined") {
    // Armies can outlive the level DOM. Do not retain its detached HUD through
    // an entity that remains in the player's roster after leaving a stage.
    for (const type of ['stageInterfaceClosing', 'battleStopped', 'battleResolved']) {
        window.addEventListener(type, () => { timerNodes = new WeakMap(); });
    }
    window.addEventListener("entityCombatStatsChanged", ({ detail }) => {
        const entity = detail?.entity;
        if (!entity) return;
        const levelStats = getLevelBattleStats(entity);
        document.querySelectorAll(`[data-level-battle-stat][data-entity-id="${CSS.escape(String(entity.id))}"]`).forEach(value => {
            if (String(value.dataset.entityId) === String(entity.id)) {
                setTimerText(value, String(levelStats[value.dataset.levelBattleStat] ?? 0));
            }
        });
    });
}

// KILLS COUNTER
export function updateKillsCounter(killsCounterId, kills) {
    // Récupère l'élément du DOM basé sur l'ID fourni, qui devrait être de la forme "Kills_<sbireId>"
    const killsCounterElement = document.getElementById(killsCounterId);
    if (killsCounterElement) {
        // Vérifie si `kills` est `undefined` et utilise 0 comme valeur par défaut
        const killsDisplay = levelBattleValue(killsCounterId, "Kills_", "kills", kills);
        // Met à jour le contenu textuel de l'élément avec le nombre de kills ou 0 si `kills` est `undefined`.
        killsCounterElement.textContent = `Kills : ${killsDisplay}`;
    }
}

// TOTAL DAMAGES COUNTER
export function updateTotalDamageCounter(TotalDamageCounterId, totalDamage) {
    // Récupère l'élément du DOM basé sur l'ID fourni, qui devrait être de la forme "Kills_<sbireId>"
    const TotalDamageCounterElement = document.getElementById(TotalDamageCounterId);
    if (TotalDamageCounterElement) {
        // Vérifie si `kills` est `undefined` et utilise 0 comme valeur par défaut
        const TotalDamageCounterDisplay = levelBattleValue(TotalDamageCounterId, "TotalDamages_", "totalDamage", totalDamage);
        // Met à jour le contenu textuel de l'élément avec le nombre de kills ou 0 si `kills` est `undefined`.
        TotalDamageCounterElement.textContent = `Dégâts : ${TotalDamageCounterDisplay}`;
    }
}

// TOTAL HEAL COUNTER
export function updateTotalHealCounter(entityId, totalHeal) {
    // Construire l'ID basé sur l'ID de l'entité
    const totalHealCounterId = `TotalHeal_${entityId}`;

    // Récupérer l'élément du DOM
    const totalHealCounterElement = document.getElementById(totalHealCounterId);
    if (totalHealCounterElement) {
        // Mettre à jour le texte de l'élément avec le total des soins
        totalHealCounterElement.textContent = `Soins : ${levelBattleValue(totalHealCounterId, "TotalHeal_", "totalHeal", totalHeal)}`;
    } else {
        // console.error(`Élément avec l'ID ${totalHealCounterId} introuvable.`);
        return;
    }
}





// DOM TIMERS ATTAQUES
export function createAttackElementsForEntity(entites) {
    // Trouver l'élément conteneur où ajouter les attaques (par exemple, un élément avec l'ID de l'entité)
    const entityContainer = document.getElementById(`entiteDetailsContainer_${entites.id}`);
    if (!entityContainer) {
        console.error(`Conteneur pour l'entité ${entites.id} non trouvé.`);
        return;
    }
    entites.attacks.forEach(attackName => {
        const attackDetail = resolveAttackDefinitionForEntity(entites, attackName, attackDetails);
        if (!attackDetail) {
            console.error(`Détails non trouvés pour l'attaque ${attackName}.`);
            return;
        }

        // Vérifiez le contenu de attackDetail.attackTarget
        // console.log(`Cible de l'attaque ${attackDetail.functionName} : ${attackDetail.attackTarget}`);

        let attackDetailinfos;

        if (attackDetail.attackTarget.includes('ally')) {
            attackDetailinfos = 'Allié';
        } else if (attackDetail.attackTarget.includes('enemy')) {
            attackDetailinfos = 'Ennemi';
        } else if (attackDetail.attackTarget.includes('hexa')) {
            attackDetailinfos = 'Case';
        } else {
            attackDetailinfos = 'Inconnu';
        }

        // Vérifiez le contenu de deadTarget
        let deadTargetInfo = '';
        if (attackDetail.deadTarget && attackDetail.deadTarget.includes('yes')) {
            deadTargetInfo = ' mort';
        }

        // Créer un élément pour l'attaque
        const attackElement = document.createElement('div');
        attackElement.className = 'attack-details';
        attackElement.innerHTML = `
            <div class="attackElement-attaque" id='attackElement-attaque_${attackDetail.attackId}'>
                <div class="attackElement_partie-1">
                    <div class="attack-image-frame">
                        <img src='${attackDetail.attackAsset}' class="attackElement-asset-spell ${attackDetail.attackTarget} attack-image";>
                        <div class="picto-target-attack-detail ${attackDetail.attackTarget}"></div>
                    </div>
               </div> 
                <div class="attackElement_partie-2">
                    <p class="attackElement-timers">
                        <div class="attack-name-detail ${attackDetail.attackTarget.join(' ')}">${attackDetail.displayName}</div>
                        <i>Ciblage :<strong class="ciblage-attack-detail-infos"> ${attackDetailinfos}${deadTargetInfo}</strong></i><br/>
                        <i>Cooldown : ${attackDetail.cooldown / 1000}s</i><br/>
                        <i>Préparation : ${attackDetail.preparationTime / 1000}s</i><br/>
                        <i>Exécution : ${attackDetail.executionTime / 1000}s</i><br/>
                        <i>Récupération : ${attackDetail.recoveryTime / 1000}s</i>
                    </p>
                </div>
            </div>
            <p class="attack-description-detail">${attackDetail.attackDescription}</p>
        `;
        // Ajouter cet élément au conteneur de l'entité
        entityContainer.appendChild(attackElement);
    });
}



export let dotNameElement;

export function PopUpDamages(
  target,
  damage,
  effectName,
  popupContent,
  totalDamageSources = {},
  popupType = "normal",
  armorGate = 0,
  natureClass = ''
) {
  if (!totalDamageSources || typeof totalDamageSources !== "object") {
    console.error("totalDamageSources est manquant ou invalide dans PopUpDamages.");
    totalDamageSources = {};
  }

  const entityContainer = document.getElementById(`PopUp_${target.id}`);
  if (!entityContainer) return;

  const hpLoss = Math.max(0, Math.round(Number(damage) || 0));
  const armorLoss = Math.max(0, Math.round(Number(armorGate) || 0));

  const effectClass = effectName ? `${effectName}-pop-up` : "generic-pop-up";
  const isCritical = popupType === "critical" || popupType === "execution-critical";
  const isExecutionCritical = popupType === "execution-critical";
  const isBloodGlutony = popupType === "blood-glutony";
  const popupClass = isCritical ? "popup-critical" : "popup-normal";

  if (isBloodGlutony) {
    EffectMessage(target, `Voracité sanguinaire|+${hpLoss} HP`, "blood-glutony");
    return;
  }

  const sourceTypes = Object.entries(totalDamageSources)
    .filter(([, value]) => Number(value) > 0).map(([type]) => type);
  const physical = sourceTypes.some(type => ['physical', 'physicalDamage', 'hybridalDamage', 'physicalPiercingDamage', 'hybridalPiercingDamage'].includes(type));
  const magical = sourceTypes.some(type => ['magical', 'magicalDamage', 'hybridalDamage', 'magicalPiercingDamage', 'hybridalPiercingDamage'].includes(type));
  const piercing = sourceTypes.some(type => ['piercingDamage', 'transpiercingDamage', 'physicalPiercingDamage', 'magicalPiercingDamage', 'hybridalPiercingDamage'].includes(type));
  const inferredNature = piercing
    ? physical && magical ? 'hybridalPiercingDamage' : physical ? 'physicalPiercingDamage' : magical ? 'magicalPiercingDamage' : 'transpiercingDamage'
    : physical && magical ? 'hybridalDamage' : magical ? 'magicalDamage' : 'physicalDamage';
  const natureKeys = ['physicalDamage', 'magicalDamage', 'hybridalDamage', 'piercingDamage',
    'transpiercingDamage', 'physicalPiercingDamage', 'magicalPiercingDamage', 'hybridalPiercingDamage', 'inerte'];
  const nature = natureKeys.includes(natureClass) ? natureClass : inferredNature;
  const totalElement = document.createElement('div');
  totalElement.className = `damage-popup total-damage damage-popup--nature ${effectClass} ${popupClass}`;
  if (armorLoss > 0) totalElement.classList.add('damage-popup--armor-hit');
  if (isExecutionCritical) totalElement.classList.add('damage-popup--execution-critical');
  const damageIcon = document.createElement('span');
  damageIcon.className = isExecutionCritical
    ? 'picto-stat damage-popup-critical-icon execution-critical'
    : isCritical ? 'picto-stat damage-popup-critical-icon criticalPower'
    : `picto-stat damage-popup-nature-icon ${nature}`;
  damageIcon.setAttribute('aria-hidden', 'true');
  const totalValue = document.createElement('span');
  totalValue.className = `damage-popup-value ${nature}`;
  totalValue.textContent = `−${hpLoss + armorLoss}`;
  totalElement.append(damageIcon, totalValue);
  if (isCritical) {
    const suffix = document.createElement('span'); suffix.className = 'combat-popup-critical-suffix'; suffix.textContent = '!!!'; totalElement.append(suffix);
  }
  showDamagePopup(entityContainer, totalElement, isExecutionCritical ? 3 : isCritical ? 1 : popupType === 'execution' ? 2 : 0);

  if (armorLoss > 0 && (Number(target.stats?.armor?.current) || 0) <= 0) {
      const destroyed = document.createElement("div");
      destroyed.className = "damage-popup damage-popup--armor-destroyed";
      const destroyedIcon = document.createElement("span");
      destroyedIcon.className = "damage-popup-armor-destroyed-icon";
      destroyedIcon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "damage-popup-armor-destroyed-text";
      label.textContent = "armure détruite";
      destroyed.append(destroyedIcon, label);
      EffectMessage(target, destroyed, 'armor-destroyed');
  }
}

function CleardotName(element, delai) {
    setTimeout(() => {
        element.remove();
    }, delai);
}


// SCORING
let scoreSideA = 0;
let scoreSideB = 0;

// Function to update the score display for side A
function updateScoreDisplay() {
  document.getElementById('score').textContent = 'Score : ' + scoreSideA;
}

// Function to update the score
export function updateScore(attacker, points) {
  if (attacker.side === 'A') {
    scoreSideA += points;
  } else if (attacker.side === 'B') {
    scoreSideB += points;
  }
  updateScoreDisplay();
}

export function deductScore(target, points) {
  if (target.side === 'A') {
    scoreSideA -= points;
  } else if (target.side === 'B') {
    scoreSideB -= points;
  }
  updateScoreDisplay();
}
