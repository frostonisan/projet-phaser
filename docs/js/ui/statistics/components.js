import { renderMovementCounter } from "../../rendering/hud.js";
import { clockNow, setInterval, clearInterval, isCombatPaused } from "../../combat/clock.js";
import { getStatSystemResult } from "../../entities/statSystem.js";
import { STAT_EFFECT_HELPERS, buildStatCurseHelper, buildEntityRateHelper } from "../../data/helpers.js";
import { cachedResourceUrl } from "../../data/loaderList.js";
import { getSafe, getDisplayStatKey, normalizeStatKey } from "../../entities/rules.js";
import {
  calculatePhysicalPenPercent, calculateMagicalPenPercent, getBloodThirstyPercent,
  calculateEsoterismPercent, calculateTranscendenceExtraLife, getMovementWeightMalus,
  getStatMalusSources, entites,
} from "../../entities/runtime.js";
import {
  getStatContributions, calculateResistanceReductionPercent, calculateMagicalTotal,
  getFinalAttackPreparationReduc, getFinalAttackExecutionReduc, getFinalAttackCooldownReduc,
  getFinalAttackRecoveryReduc, getFinalAttackProjectileSpeed, calculateCritTotalChance,
  calculateCritDamageBonus, getFinalCriticalChanceFlat, getFinalCriticalDamageFlat,
  calculateAmbidextryTotalChance, calculateAmbidextryDamageBonus, calculateBloodFuryExecutionPercent,
  calculateBloodFuryTargetThreshold, calculateBloodFuryExecChanceBonus, calculateBloodThirstyPercent,
  calculateExecutionDamage, calculateHypercognitionEssences, calculateCognitiveExplosionTotal,
  calculateRangeRatio, calculateBullsEyePercent, calculateTotalDodgeBonus,
  calculateResilienceCritTotalBonus, calculateResilienceTotalCancelBonus,
  calculateResilienceAlterationTotalBonus, caluclateIndestructibilityReductionTotal,
  calculateIndestructibilityPercentFromEntity, calculateEsoterismtotalReduction,
  calculateHpBattleRegenPercent, calculateAstralityTotal, calculateTranscendenceConsoProtectionTotal,
  calculateTotalRegenAmount, calculateInvisibleTargetAvoidChance, calculateBrokenSpellDamage,
  calculateBrokenSpellChance, totalMeleeExecReduction, totalPiercingRecupReductionWithAgi,
  totalTranspiercingRecupReductionWithAgi, transpiercingAgiRatio, transpiercingTotal,
  brutalityPercantBonus, psionicPercantBonus, calculateMeleeExecBonus, calculateMysticismProcChance,
  calculateMysticismTranceDuration, calculateMysticismPreparationAcceleration,
  calculateMysticismTotalDamageBonus, calculateEquilibreAggroReduction,
  calculateEquilibreInvisibleDetection, calculateEquilibreAttackChance, calculateAgileRetreatChance,
  calculateOccultismInvisibilityChance, calculateOccultismTargetableChanceDisplay,
  calculateOccultismDodgeBonus, calculateOccultismCritChanceBonus,
  calculateOccultismShadowFragilityPercent, calculateMovementMaxCharges,
  calculateMovementStartingChargePercent, calculateMovementStartingCharges,
  calculateMovementMarathonChance, calculateWeaponOrfevreWeaponMastery, calculateWeaponOrfevreStrength,
  getFinalWeaponOrfevreBonus, getFinalWeaponCollectorBonus, calculateChargeEquipmentSlots,
  calculateWeaponMasteryTotalChargeBonus, calculateWeaponMasteryTrophyChance, getMarathonChance,
  getTrailerChance, calculateEntityPower, calculateEntityRates, calculateAttackPower,
  calculateArmyPower, getPowerConfigurationSignature,
} from "../../combat/statistics.js";
import { isDisplayableStatContribution, calculateStatsDisplay, getStatImprovement } from "./details.js";
import { stats } from "../../data/statsData.js";
import {
  clamp, LEVEL_UP_HELPER_SCOPE, STOCK_HELPER_STATS, bindHelperEntity, getBoundHelperEntity,
  findStatKeyFromLabel, umbraDetection, getStatValue, readStatLabel, contextualStatDefinition,
  refreshStatHelper, escape,
} from "./helpers.js";
import { attackDetails } from "../../data/attackList.js";
import { getPowerBreakdownLines, roundPower, readOwnedPowerAttacks } from "../../procedural/proc-bareme.js";
import { isAdminMode, loadFromLocalStorage, loadEquippedItems } from "../../storage/gameStorage.js";
import { attackSelectionKey } from "../../combat/attackResolution.js";
import { EFFECT_VISUALS } from "../../data/effectVisuals.js";

// Presentation des statistiques : composants, puissance, Umbra et effets actifs.

function umbraCreation({ attribut, category, level }, filled = true) {
  const milestone = document.createElement("div");
  milestone.className = `milestone ${category} lvl-${level} ${filled ? "filled" : ""} ${attribut}`.trim();

  const gemme = document.createElement("div");
  gemme.className = `gemme ${attribut}`;

  milestone.appendChild(gemme);
  return milestone;
}

function initUmbraOrnementBlink(root = document) {
  const ornaments = root.querySelectorAll(
    ".umbra-ornement.lvl-1:not(.umbra-ornement--blink)"
  );

  ornaments.forEach((el) => {
    const duration = 5200 + Math.random() * 2600;
    const delay = Math.random() * 2200;
    const opacityMin = 0.2 + Math.random() * 0.08;
    const opacityMax = 0.8 + Math.random() * 0.10;

    el.style.setProperty("--umbra-blink-duration", `${duration}ms`);
    el.style.setProperty("--umbra-blink-delay", `${delay}ms`);
    el.style.setProperty("--umbra-opacity-min", opacityMin);
    el.style.setProperty("--umbra-opacity-max", opacityMax);

    el.classList.add("umbra-ornement--blink");
  });
}

function syncStatCurseMarker(container, entity, statKey) {
  if (!container || container.closest('.item-description-card, .item-stats-block')) return;
  bindHelperEntity(container, entity);
  if (container.closest(LEVEL_UP_HELPER_SCOPE)) entity = getBoundHelperEntity(container) || entity;
  if (container.dataset.autonomousHelper === 'true') syncStatImprovement(container, entity, statKey);
  if (container.dataset.autonomousHelper !== 'true' && stats.some(stat => stat.key === normalizeStatKey(statKey) && stat.nature === 'umbra')) {
    for (const text of container.querySelectorAll('.stat-name, .entite-stat')) {
      text.classList.add(getDisplayStatKey(statKey));
      text.dataset.statState = 'umbra';
    }
  }
  const enhanced = getStatContributions(entity, statKey).some(source => source.value > 0 && isDisplayableStatContribution(source));
  container.dataset.statUpgraded = String(enhanced);
  container.classList.toggle('source-upgraded', enhanced);
  const sources = getStatMalusSources(entity, statKey);
  container.dataset.statCursed = sources.length ? 'true' : 'false';
  if (sources.length || ['strength', 'agility', 'intelligence'].includes(normalizeStatKey(statKey))) {
    container.classList.remove('zero');
  }
  let marker = container.querySelector('.stat-curse-marker');
  if (!sources.length) { marker?.remove(); return; }
  if (!marker) {
    marker = document.createElement('span');
    marker.className = 'stat-curse-marker';
    marker.tabIndex = 0;
  }
  // Keep the stat name's text unchanged for helper titles and live label updates.
  marker.textContent = '';
  marker.dataset.malusLabel = buildStatCurseHelper(sources, { compact: true });
  const label = container.querySelector('.stat-name') || container;
  if (marker.parentNode !== label) label.appendChild(marker);
  const description = `Malus appliqués. ${buildStatCurseHelper(sources)}`;
  marker.title = description;
  marker.setAttribute('aria-label', description);
}

function createUmbraBlock(
  parentDiv,
  statName,
  statValueCallback,
  entite,
  forcedStatKey = null,
  inlineStatName = false,
  attribut = null,
  umbra = null,
  options = {}
) {
  // ✅ Overload: si le 5e param est un bool => c'est le flag umbra, pas forcedStatKey
  const umbraEnabled =
    typeof forcedStatKey === "boolean" ? forcedStatKey : Boolean(umbra);
  if (typeof forcedStatKey === "boolean") forcedStatKey = null;

  let statKey = "stat";
  const fnString = statValueCallback.toString();

  // === Détection du bon statKey ===
  if (forcedStatKey) {
    statKey = forcedStatKey;
  } else if (
    fnString.includes("entite.stats.physicalDamage") &&
    fnString.includes("entite.stats.magicalDamage")
  ) {
    statKey = "hybridalDamage";
  } else if (
    fnString.includes("entite.stats.HP.current") &&
    fnString.includes("entite.stats.HP.max")
  ) {
    statKey = "HP";
  } else if (fnString.includes("entite.stats.speed")) {
    statKey = "speed";
  } else {
    const match = fnString.match(/\.stats\??\.([a-zA-Z0-9_]+)/);
    if (match) statKey = match[1];
  }

  // The level-up sidebar keeps one preview scope, with separate visual lists.
  if (parentDiv?.classList.contains('soul-stats-panels')) {
    parentDiv = parentDiv.querySelector(umbraDetection(statKey)
      ? '.soul-umbras' : '.soul-inherited-stats-list') || parentDiv;
  }

  let statValue;
  if (statKey === "hybridalDamage" && !forcedStatKey) {
    statValue =
      (Number(getSafe(entite, "physicalDamage", 0)) || 0) +
      (Number(getSafe(entite, "magicalDamage", 0)) || 0);
  } else if (statKey !== "stat") {
    statValue = getSafe(entite, statKey, 0);
  } else {
    statValue = statValueCallback();
  }

  // === Helpers ===
  const isObjStatValue = (v) =>
    v && typeof v === "object" && ("current" in v || "max" in v);

  const isZeroValue = (v) => {
    if (isObjStatValue(v)) {
      const c = Number(v.current ?? 0);
      const m = Number(v.max ?? 0);
      return c <= 0 && m <= 0;
    }
    const n = Number(v);
    return v == null || Number.isNaN(n) ? true : n <= 0;
  };

  // === Filtrage ===
  const isZeroStat = isZeroValue(statValue);
  const alwaysVisible = ['strength', 'agility', 'intelligence'].includes(normalizeStatKey(statKey))
    || getStatMalusSources(entite, statKey).length > 0;
  const showMissingAsNew = Boolean(options.showMissingAsNew);
  const forceNew = Boolean(options.forceNew || options.markAsNew);
  const createdAsNewLine = forceNew || (showMissingAsNew && isZeroStat && !alwaysVisible);

  if (isZeroStat && !alwaysVisible && statKey !== "HP" && statKey !== "extraLife" && !showMissingAsNew) {
    return;
  }

  // ✅ Calcul et helper text
  const computed = calculateStatsDisplay(statKey, entite, statValue, { includeHelper: false });

  // ✅ Règle : dans le codex/menus, HP & armor = affichage MAX-only
  const isMaxOnlyStat = statKey === "HP" || statKey === "armor";

  let displayValue = isMaxOnlyStat
    ? isObjStatValue(statValue)
      ? String(Number(statValue.max ?? 0))
      : String(statValue ?? 0)
    : computed.displayValue;

  // ✅ FORCAGE AFFICHAGE SPEED (ms -> s)
  if (statKey === "speed") {
    const ms = Number(statValue ?? 0);
    const safe = Number.isFinite(ms) ? ms : 0;
    displayValue = `${(safe / 1000).toFixed(2)} s`;
  }

  // ✅ Opt-in hover helper (absent => false)
  const enableHover = (el) => {
    if (el) el.dataset.hover = "true"; // ou el.setAttribute("data-hover","true")
  };

  // === DOM ===
  const statDiv = document.createElement("div");
  statDiv.className = `${statKey}-stat stat-container`;
  if (createdAsNewLine) {
    statDiv.classList.add("new");
    statDiv.dataset.statLineCreatedAsNew = options.newLineContext || "generic";
  }
  statDiv.dataset.stat = statKey;
  if (STOCK_HELPER_STATS.has(statKey)) statDiv.dataset.autonomousHelper = 'true';
  enableHover(statDiv); // ✅ IMPORTANT

  if (entite && entite.id) statDiv.dataset.entityId = entite.id;
  statDiv.dataset.helperText = computed.helpContent;

  const pictoContainer = document.createElement("div");
  pictoContainer.className = `stat-picto-valeur ${statKey}`;

  const picto = document.createElement("div");
  picto.className = `picto-stat ${statKey}`;
const umbraOrnement = document.createElement("div");
umbraOrnement.className = "umbra-ornement";

if (typeof umbraDetection === "function") {
  const umbraProfile = umbraDetection(statKey);

  if (umbraProfile) {
    statDiv.dataset.umbra = "1";
    statDiv.dataset.attribut = umbraProfile.attribut;
    statDiv.dataset.category = umbraProfile.category;
    statDiv.dataset.level = String(umbraProfile.level);

    const level = umbraProfile.level;
    const attributName = umbraProfile.attribut;

  if (level) {
  umbraOrnement.classList.add(`lvl-${level}`);
}

if (attributName) {
  umbraOrnement.classList.add(attributName);
}

if (Number(level) === 3) {
  const delay = Math.random() * 5500;

  setTimeout(() => {
    const img = document.createElement("img");
    img.className = "umbra-apng";

    // const flipX = Math.random() < 0.5 ? -1 : 1;
    // const flipY = Math.random() < 0.5 ? -1 : 1;
    // img.style.transform = `scale(${flipX}, ${flipY})`;

    umbraOrnement.style.setProperty(
      "--umbra-lvl3-blink-duration",
      `${3600 + Math.random() * 2400}ms`
    );

    umbraOrnement.style.setProperty(
      "--umbra-lvl3-blink-delay",
      `${Math.random() * 1800}ms`
    );

    img.src = cachedResourceUrl(`./media/assets/misc/umbra-ornement-lvl-3.apng?seed=${clockNow()}-${Math.random()}`);

    umbraOrnement.appendChild(img);
    umbraOrnement.classList.add("umbra-visible");
  }, delay);
}
  }
}
  if (["strength", "agility", "intelligence"].includes(statKey)) {
    picto.classList.add("attribut");
  }

  // (optionnel) si tu veux que le hover marche DIRECTEMENT sur l’icône :
  // picto.dataset.stat = statKey;
  // enableHover(picto);
  // if (entite && entite.id) picto.dataset.entityId = entite.id;

  const valueDiv = document.createElement("div");
  valueDiv.dataset.stat = statKey;
  enableHover(valueDiv); // ✅ IMPORTANT
  if (entite && entite.id) valueDiv.dataset.entityId = entite.id;

  // 🔒 Flag crucial : permet à updateHealthBar() de NE PAS écraser ce bloc
  if (isMaxOnlyStat) valueDiv.dataset.display = "max";

  if (showMissingAsNew && isZeroStat && !forceNew && !alwaysVisible) {
    valueDiv.className = "entite-stat stat-new new-stat";
    valueDiv.textContent = "";
  } else {
    valueDiv.className = forceNew ? "entite-stat new-stat" : "entite-stat";
    valueDiv.textContent = displayValue;
    if (statKey === 'shift' && isObjStatValue(statValue)) {
      valueDiv.dataset.movementEntityId = entite.id;
      renderMovementCounter(valueDiv, { ...entite, stats: { ...entite.stats, shift: statValue } });
    }
  }

  // === Preview (toujours créée)
  const valueDivPreview = document.createElement("div");
  valueDivPreview.className = "entite-stat preview is-hidden";
  valueDivPreview.textContent = displayValue;
  valueDivPreview.dataset.stat = statKey;
  enableHover(valueDivPreview); // ✅ IMPORTANT
  if (entite && entite.id) valueDivPreview.dataset.entityId = entite.id;

  if (statKey === "speed") {
    const ms = Number(statValue ?? 0);
    const rawMs = String(Number.isFinite(ms) ? ms : 0);
    valueDiv.dataset.rawMs = rawMs;
    valueDivPreview.dataset.rawMs = rawMs;
  }
  if (isMaxOnlyStat) valueDivPreview.dataset.display = "max";

  const separatorDivPreview = document.createElement("div");
  separatorDivPreview.className = "separator-stats-preview";
  separatorDivPreview.textContent = ">";

  // ✅ Helper milestone wrapper
  const appendUmbraMilestone = (targetEl) => {
    if (!umbraEnabled) return;
    if (typeof umbraDetection !== "function") return;
    if (typeof umbraCreation !== "function") return;

    const profile = umbraDetection(statKey);
    if (!profile) return;

    const wrap = document.createElement("div");
    wrap.className = "umbra-milestone";
    wrap.appendChild(umbraCreation(profile));

    targetEl.appendChild(wrap);
  };

  // === Gestion spéciale des attributs ===
  if (attribut) {
    const attributPicto = document.createElement("div");
    attributPicto.className = "attribut-picto";

    // ✅ milestone (wrappé) AVANT le picto
    appendUmbraMilestone(attributPicto);

    attributPicto.appendChild(picto);

    const nameDiv = document.createElement("div");
    nameDiv.className = "stat-name";
    nameDiv.textContent = statName;

    const valueGroup = document.createElement("div");
    valueGroup.className = "attribut-value-group";
    valueGroup.appendChild(valueDiv);
    valueGroup.appendChild(separatorDivPreview);
    valueGroup.appendChild(valueDivPreview);

    pictoContainer.appendChild(nameDiv);
    pictoContainer.appendChild(valueGroup);
    statDiv.appendChild(attributPicto);
    statDiv.appendChild(pictoContainer);

    parentDiv.appendChild(statDiv);
    syncStatCurseMarker(statDiv, entite, statKey);

    return;
  }

  // === Présentation standard ===
  // ✅ milestone (wrappé) AVANT le picto
  appendUmbraMilestone(pictoContainer);
  if (parentDiv.closest('.soul-inherited-stats') && !umbraDetection(statKey)) {
    const statMilestone = document.createElement('div');
    statMilestone.className = 'stat-milestone';
    statMilestone.textContent = 'stat';
    pictoContainer.appendChild(statMilestone);
  }

  pictoContainer.appendChild(picto);
pictoContainer.appendChild(umbraOrnement);

  if (!inlineStatName && statName && statName.trim()) {
    const nameDiv = document.createElement("div");
    nameDiv.className = "stat-name";
    nameDiv.textContent = statName;
    pictoContainer.appendChild(nameDiv);
  }

  pictoContainer.appendChild(valueDiv);
  pictoContainer.appendChild(separatorDivPreview);
  pictoContainer.appendChild(valueDivPreview);

  statDiv.appendChild(pictoContainer);
  parentDiv.appendChild(statDiv);
  syncStatCurseMarker(statDiv, entite, statKey);
  initUmbraOrnementBlink(parentDiv);
}

function setupLinesClassByChildren(containerEl, { onlyVisible = true } = {}) {
  if (!containerEl) return () => {};

  const LINE_CLASSES = ["oneline", "twoline", "threeline", "fourline", "fiveline", "sixline", "sevenline"];
  const SPECIAL_CONTAINER_CLASS = "four-exact";
  const SPECIAL_CHILD_CLASS = "slot-5";
  let rafId = 0;

  const isVisible = (el) => {
    if (!onlyVisible) return true;
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  };

  const getLineClass = (count) => {
    if (count >= 1 && count <= 3) return "oneline";
    if (count >= 4 && count <= 6) return "twoline";
    if (count >= 7 && count <= 9) return "threeline";
    if (count >= 10 && count <= 12) return "fourline";
    if (count >= 13 && count <= 15) return "fiveline";
	if (count >= 16 && count <= 18) return "sixline";
	if (count >= 16) return "sevenline";
    return "";
  };

  const update = () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const allChildren = Array.from(containerEl.children);
      const visibleChildren = allChildren.filter(isVisible);
      const count = visibleChildren.length;

      // Reset classes container
      containerEl.classList.remove(...LINE_CLASSES, SPECIAL_CONTAINER_CLASS);

      // Reset children special
      allChildren.forEach((ch) => ch.classList.remove(SPECIAL_CHILD_CLASS));

      // Apply line class
      const cls = getLineClass(count);
      if (cls) containerEl.classList.add(cls);

      // ✅ Exception: 4 visibles -> 3 en ligne 1, le 4e centré en ligne 2 (position 5)
      if (count === 4) {
        containerEl.classList.add(SPECIAL_CONTAINER_CLASS);
        visibleChildren[3].classList.add(SPECIAL_CHILD_CLASS);
      }
    });
  };

  const mo = new MutationObserver(update);
  mo.observe(containerEl, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });

  update();

  return () => {
    cancelAnimationFrame(rafId);
    mo.disconnect();
  };
}

function createStatSection({ sectionClass, titleText, titleClass = "" }) {
  // Bloc section (ex: "stat-section-codex attack")
  const section = document.createElement("div");
  section.className = `stat-section-codex ${sectionClass}`.trim();

  // Titre (ex: "stat-title-type attack")
  const titleWrap = document.createElement("div");
  titleWrap.className = `stat-title-type ${titleClass}`.trim();

  const titlePicto = document.createElement("div");
  titlePicto.className = "picto";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = titleText;

  titleWrap.append(titlePicto, title);
  section.appendChild(titleWrap);

  return section;
}

function finalizeCodexStatSection(section, emptyText) {
  if (!section.querySelector('.stat-container')) {
    const empty = document.createElement('p');
    empty.className = 'codex-stat-section-empty no-stats';
    empty.textContent = emptyText;
    section.appendChild(empty);
  }
}

function removeEmptyCodexStatGroup(section, statClass) {
  const title = section.querySelector(`.titre.${statClass}`);
  if (!title) return;
  let next = title.nextElementSibling;
  while (next && !next.classList.contains('titre')) {
    if (next.classList.contains('stat-container')) return;
    next = next.nextElementSibling;
  }
  title.remove();
}

function statTitle({
  statClass,
  title,
  wrapperClass = "titre",
  pictoBaseClass = "picto-stat",
  nameClass = "stat-type",
}) {
  const wrapper = document.createElement("div");
  wrapper.classList.add(wrapperClass);
  if (statClass) wrapper.classList.add(statClass);

  const name = document.createElement("div");
  name.classList.add(nameClass);
  name.textContent = title;

 wrapper.append(name);
  // wrapper.append(picto);
  return wrapper;
}

function createCodexStatLine({ statClass, entite, calculatorName, content }) {
  const valeur = getStatValue(entite, calculatorName);

  const line = document.createElement("div");
  line.classList.add("codex-stat-line", statClass);

  // content = string libre contenant "${valeur}" (littéral), on remplace
  line.textContent = String(content).replaceAll("${valeur}", String(valeur));

  return line;
}

function calculateMeleeExecutionPercent(entite) {
  const reduc = getFinalAttackExecutionReduc(entite); // 0..25 (points de %)
  const execPercent = 100 - reduc;               // ex: reduc=1 => 99
  return clamp(execPercent, 0, 100);
}

const STAT_CALCULATORS = {
  calculateEsoterismtotalReduction,
 calculateMagicalTotal,
 calculateMeleeExecutionPercent,
 calculateCritTotalChance: entite => calculateCritTotalChance(entite),
 calculateCritDamageBonus: entite => calculateCritDamageBonus(entite), getFinalCriticalChanceFlat, getFinalCriticalDamageFlat,
 calculateAmbidextryTotalChance, calculateAmbidextryDamageBonus,
 calculateBloodFuryExecutionPercent, calculateBloodFuryTargetThreshold, calculateBloodFuryExecChanceBonus, calculateExecutionDamage, calculateBloodThirstyPercent,
 getBloodThirstyPercent,
 calculatePhysicalPenPercent,
 calculateMagicalPenPercent,
 calculateHypercognitionEssences, calculateCognitiveExplosionTotal,
 calculateRangeRatio: entite => Number(calculateRangeRatio(entite).toFixed(2)), calculateBullsEyePercent,
 calculateTotalDodgeBonus,
 calculateResilienceCritTotalBonus, calculateResilienceTotalCancelBonus, calculateResilienceAlterationTotalBonus,
 caluclateIndestructibilityReductionTotal, calculateIndestructibilityPercentFromEntity,
 calculateHpBattleRegenPercent,
 calculateAstralityTotal,
 calculateTranscendenceConsoProtectionTotal, calculateTranscendenceExtraLife,
 calculateEsoterismPercent,
 calculateTotalRegenAmount,
getFinalAttackPreparationReduc, getFinalAttackExecutionReduc, getFinalAttackCooldownReduc, getFinalAttackRecoveryReduc, getFinalAttackProjectileSpeed,
calculateInvisibleTargetAvoidChance,
calculateBrokenSpellChance,
totalMeleeExecReduction,
totalPiercingRecupReductionWithAgi, totalTranspiercingRecupReductionWithAgi,
transpiercingAgiRatio, 
transpiercingTotal,
brutalityPercantBonus,
psionicPercantBonus, 
calculateBrokenSpellDamage,
calculateMeleeExecBonus,
calculateMysticismProcChance, calculateMysticismTranceDuration, calculateMysticismPreparationAcceleration, calculateMysticismTotalDamageBonus,
calculateLvlMaxEntiteWithWill: (e) => { const willValue = readEntityKey(e, "will"); return calculateStatsDisplay("will", e, willValue)?.lvlMaxEntite ?? 0;},
calculateEquilibreAggroReduction, calculateEquilibreInvisibleDetection, calculateEquilibreAttackChance,
calculateAgileRetreatChance,
calculateOccultismInvisibilityChance, calculateOccultismTargetableChanceDisplay, calculateOccultismDodgeBonus, calculateOccultismCritChanceBonus, calculateOccultismShadowFragilityPercent,
calculateMovementMaxCharges, calculateMovementStartingChargePercent, calculateMovementStartingCharges, calculateMovementMarathonChance, getMarathonChance, getTrailerChance,
calculateWeaponOrfevreWeaponMastery, calculateWeaponOrfevreStrength, getFinalWeaponOrfevreBonus, getFinalWeaponCollectorBonus, calculateChargeEquipmentSlots, calculateWeaponMasteryTotalChargeBonus, calculateWeaponMasteryTrophyChance,
};

function syncStatImprovement(container, entite, statKey) {
  const name = container.querySelector('.stat-name');
  if (!name) return;
  const weight = container.dataset.stat === 'weight' ? getMovementWeightMalus(entite) : null;
  const improvement = weight ? null : getStatImprovement(entite, statKey, container.dataset.statEffect);
  const baseLabel = normalizeStatKey(statKey) === 'criticalDamage'
    ? contextualStatDefinition(stats.find(stat => stat.key === 'criticalDamage'), entite).name
    : readStatLabel(container, { base: true });
  const hasColon = (name.dataset.baseLabel || name.textContent).includes(':');
  name.dataset.baseLabel = baseLabel + (hasColon ? ' :' : '');
  container.querySelector('.stat-picto-valeur > .picto-stat')?.classList.toggle('picto-stat--bonus', Boolean(improvement));
  name.textContent = improvement ? `${baseLabel} ${improvement.state || '+'} :`
    : name.dataset.baseLabel;
  name.classList.remove('stat-improved-strength', 'stat-improved-intelligence', 'stat-improved-agility');
  const label = document.createElement('span');
  label.className = weight?.weightClass || getDisplayStatKey(improvement?.stat || statKey);
  const state = improvement?.state || (improvement ? '+' : 'normal');
  if (!improvement && !weight) label.dataset.statState = state;
  for (const value of container.querySelectorAll('.entite-stat')) {
    if (weight) delete value.dataset.statState;
    else {
      value.classList.add(getDisplayStatKey(improvement?.stat || statKey));
      value.dataset.statState = state;
    }
  }
  label.textContent = name.textContent;
  if (weight) {
    for (const node of container.querySelectorAll('.stat-picto-valeur, .stat-picto-valeur > .picto-stat, .entite-stat')) {
      node.classList.remove('weight', 'feather-weight', 'light-weight', 'middle-weight', 'heavy-weight', 'super-heavy-weight');
      node.classList.add(weight.weightClass);
    }
    const value = container.querySelector('.entite-stat');
    if (value) value.textContent = weight.label.replace(/^Poids\s+/i, '').replace(/^./, c => c.toUpperCase());
  }
  for (const key of ['statImprovement', 'stat', 'hover', 'helperText']) delete name.dataset[key];
  if (improvement) {
    const text = document.createElement('span');
    text.className = 'stat-improved-label';
    text.dataset.statState = state;
    text.textContent = label.textContent;
    label.replaceChildren(text);
    const origin = document.createElement('span');
    origin.className = getDisplayStatKey(improvement.source);
    origin.appendChild(label);
    name.replaceChildren(origin);
  } else {
    name.replaceChildren(label);
  }
}

function createFullStatDom({
  stat,
  label,
  value: valueTemplate,
  entite = null,
  calculatorName = null,
  calculatorKey = null,
  originKey = null,
  showZero = false,
  dataStat = null, // override data-stat
  helperEffect = null,
}) {
  const entityId = entite?.id != null ? String(entite.id) : "";

  // ✅ Opt-in hover helper (absence => false)
  const enableHover = (node) => {
    if (node instanceof HTMLElement) node.dataset.hover = "true";
  };

  // clé réellement utilisée dans data-stat
  const dataStatKey =
    (typeof dataStat === "string" && dataStat.trim().length > 0)
      ? dataStat.trim()
      : stat;
  const visualStatKey = getDisplayStatKey(dataStatKey);
  showZero ||= getStatMalusSources(entite, stat).length > 0
    || ['strength', 'agility', 'intelligence'].includes(normalizeStatKey(stat));

  // --- value "simple" : si value est fourni ET ne contient pas ${value}, on affiche value tel quel
const hasValue =
  valueTemplate !== null &&
  valueTemplate !== undefined;

  const isTemplate =
    hasValue &&
    typeof valueTemplate === "string" &&
    valueTemplate.includes("${value}");

  const isManualValue = hasValue && !isTemplate;

  const readStatValue = () => getSafe(entite, stat, 0);

  let rawValue;

  if (calculatorName) {
    if (typeof calculatorName === "function") {
      rawValue = entite ? calculatorName(entite) : 0;
    } else {
      const fn = STAT_CALCULATORS[calculatorName];
      if (typeof fn !== "function") {
        throw new Error(`Calculator introuvable: "${calculatorName}"`);
      }
      rawValue = entite ? fn(entite, readEntityKey(entite, dataStatKey)) : 0;
    }
  } else {
    rawValue = readStatValue();
  }

  if (stat === "physicalResistance" || stat === "magicalResistance") {
    const resistance = getStatSystemResult(entite, normalizeStatKey(stat));
    rawValue = resistance?.resistancePoints && valueTemplate?.includes('%')
      ? Number((resistance.reductionRatio * 100).toFixed(2))
      : resistance?.value ?? calculateResistanceReductionPercent(rawValue);
  }
  if (['dodge', 'precision', 'bullsEye', 'criticalChance', 'criticalDamage', 'criticalResistance', 'alterationResistance', 'hindranceResistance', 'resilienceTotal', 'equilibreAggroReduction', 'equilibreInvisibleDetection', 'equilibreBalancedAttackChance', 'velocity', 'controlledSpeed', 'agileRetreat'].includes(normalizeStatKey(stat)) && valueTemplate?.includes('%')) rawValue = Number(Number(rawValue).toFixed(2));

  // ✅ Filtre "zéro" uniquement si on dépend de rawValue (pas de value manuel)
  if (!showZero && !isManualValue) {
    const n =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue.replace(",", ".").replace(/[^0-9.\-]/g, ""))
          : NaN;

    if (!Number.isNaN(n) && n === 0) return document.createDocumentFragment();
  }

  // ✅ Rendu : value manuel = affichage direct ; template = remplace ${value} ; sinon rawValue
  const renderedValue = hasValue
    ? (isTemplate
        ? valueTemplate.replaceAll("${value}", String(rawValue))
        : String(valueTemplate))
    : String(rawValue);

  const root = document.createElement("div");
  root.className = `${visualStatKey}-stat stat-container`;
  root.setAttribute("data-stat", dataStatKey);
  root.dataset.sourceStat = normalizeStatKey(stat);
  root.dataset.autonomousHelper = 'true';
  if (originKey) root.dataset.originStat = normalizeStatKey(originKey);
  if (isTemplate) root.dataset.valueTemplate = valueTemplate;
  const syncCalculatorName =
    typeof calculatorKey === "string" && calculatorKey.trim()
      ? calculatorKey.trim()
      : typeof calculatorName === "string" && calculatorName.trim()
        ? calculatorName.trim()
        : "";
  if (syncCalculatorName) root.dataset.calculatorName = syncCalculatorName;
  const statEffect = helperEffect || STAT_EFFECT_HELPERS[syncCalculatorName];
  if (statEffect) {
    root.dataset.statEffect = statEffect;
    root.dataset.helperKey = `${entityId}-stat-${dataStatKey}-${statEffect}`;
  }
  enableHover(root); // ✅ IMPORTANT
  if (entityId) root.setAttribute("data-entity-id", entityId);

  const wrap = document.createElement("div");
  wrap.className = `stat-picto-valeur ${visualStatKey}`;

  const picto = document.createElement("div");
  picto.className = `picto-stat ${visualStatKey}`;

  const name = document.createElement("div");
  name.className = "stat-name";
  name.textContent = label;

  const mainVal = document.createElement("div");
  mainVal.className = "entite-stat";
  mainVal.setAttribute("data-stat", dataStatKey);
  enableHover(mainVal); // ✅ IMPORTANT
  if (entityId) mainVal.setAttribute("data-entity-id", entityId);
  mainVal.innerHTML = renderedValue;
  if (dataStatKey === 'shift') {
    mainVal.dataset.movementEntityId = entityId;
    renderMovementCounter(mainVal, { ...entite, stats: { ...entite.stats, shift: getSafe(entite, 'shift', {}) } });
  }

  wrap.append(picto, name, mainVal);
  root.appendChild(wrap);
  syncStatCurseMarker(root, entite, stat);

  return root;
}

const hasOwn = (obj, key) =>
  obj != null && Object.prototype.hasOwnProperty.call(obj, key);

function entityHasKey(entite, key) {
  const statKey = normalizeStatKey(key);
  if (!entite || !statKey) return false;
  if (Array.isArray(entite?.battleBoosts?.[statKey]) && entite.battleBoosts[statKey].length > 0) {
    return true;
  }

  const sources = [
    entite?.modifierStats?.preview?.total,
    entite?.stats,
    entite?.baseStats,
    entite,
  ];

  return sources.some(src => hasOwn(src, statKey));
}

function readEntityKey(entite, key) {
  return getSafe(entite, normalizeStatKey(key), 0);
}

function createValideStatDom(opts = {}) {
  const { entite, stat, originKey = null, calculatorName } = opts;

  // 1) clé à vérifier (gating)
  const keyToCheck =
    (typeof originKey === "string" && originKey.trim().length > 0)
      ? normalizeStatKey(originKey.trim())
      : normalizeStatKey(stat);

  if (!entityHasKey(entite, keyToCheck) && !entityHasKey(entite, stat) && !getStatImprovement(entite, stat) && !getStatMalusSources(entite, stat).length) {
    return document.createDocumentFragment();
  }

  // 2) si c'est une stat "virtuelle" (stat n'existe pas), on injecte la valeur de originKey au calculator
  const statExists = entityHasKey(entite, stat);

  if (!statExists && originKey && typeof calculatorName === "string") {
    const fn = STAT_CALCULATORS[calculatorName];
    if (typeof fn !== "function") {
      throw new Error(`Calculator introuvable: "${calculatorName}"`);
    }

    return createFullStatDom({
      ...opts,
      calculatorName: (e) => fn(e, readEntityKey(e, originKey)),
      calculatorKey: calculatorName,
    });
  }

  // 3) sinon comportement normal
  return createFullStatDom(opts);
}

function tagUmbraStatContainer(statContainer, statKey) {
  if (!statContainer) return;
  if (typeof statKey !== "string" || !statKey) return;

  const meta = umbraDetection(statKey);
  if (!meta) return;

  statContainer.dataset.stat = statKey;
  statContainer.dataset.umbra = "1";
  statContainer.dataset.attribut = meta.attribut;
  statContainer.dataset.category = meta.category;
  statContainer.dataset.level = String(meta.level);
}

function createUmbraBlockTagged(parent, label, getterFn, entity, statKeyOrUmbra, umbraOverride = false) {
  const before = parent.querySelectorAll(".stat-container").length;

  const enableHover = (node) => {
    if (node instanceof HTMLElement) node.dataset.hover = "true";
  };

  const umbraEnabled =
    typeof statKeyOrUmbra === "boolean"
      ? statKeyOrUmbra
      : Boolean(umbraOverride);

  let resolvedKey = null;
  if (typeof statKeyOrUmbra === "string" && statKeyOrUmbra.trim()) {
    resolvedKey = statKeyOrUmbra.trim();
  } else if (typeof findStatKeyFromLabel === "function") {
    resolvedKey = findStatKeyFromLabel(label) || null;
  }

  // 1) Appel createUmbraBlock avec une lecture finale quand la stat est connue.
  const maybeEl = createUmbraBlock(
    parent,
    label,
    resolvedKey ? () => getSafe(entity, resolvedKey, 0) : getterFn,
    entity,
    resolvedKey,
    false,
    null,
    umbraEnabled
  );

  // 3) Récupère l’élément créé
  let el = null;
  if (maybeEl instanceof HTMLElement) {
    el = maybeEl;
  } else {
    const afterEls = parent.querySelectorAll(".stat-container");
    if (afterEls.length > before) el = afterEls[afterEls.length - 1] || null;
  }

  // 4) ✅ Ajoute data-hover="true" sur tout ce qui porte data-stat dans ce bloc
  if (el) {
    // Si le root porte data-stat
    if (el.hasAttribute("data-stat")) enableHover(el);

    // Tous les descendants data-stat (valueDiv, preview, etc.)
    el.querySelectorAll("[data-stat]").forEach(enableHover);
  }

  // 5) Tag umbra
  if (el && resolvedKey) tagUmbraStatContainer(el, resolvedKey);

  return el;
}

function createEntityStatsTitleNode(text) {
  const title = document.createElement("div");
  title.className = "entity-stats-title attribut";
  title.innerHTML = `
    <div class="separation-line golden"></div>
    <p class="title">${text}</p>
    <div class="separation-line golden"></div>
  `;
  return title;
}

function createBlockTitle(text, cls = "") {
  const h3 = document.createElement("h3");
  h3.className = `resu-subtitle ${cls}`.trim();
  h3.textContent = text;
  return h3;
}

function withBlockSubtitle(block, subtitleText) {
  if (!subtitleText) return block;

  const sub = document.createElement("h4");
  sub.className = "resu-block-subtitle";
  sub.textContent = subtitleText;

  // ✅ si un titre existe déjà, on place le sous-titre juste après
  const title = block.querySelector(":scope > .resu-subtitle");
  if (title) {
    title.insertAdjacentElement("afterend", sub);
  } else {
    block.prepend(sub);
  }

  return block;
}

function createBlockMarker(text) {
  const p = document.createElement("div");
  p.className = "resu-block-marker"; // style léger
  p.textContent = text;
  return p;
}

export {
  syncStatCurseMarker,
  createUmbraBlock,
  calculateMeleeExecutionPercent,
  createUmbraBlockTagged,
  createStatSection,
  finalizeCodexStatSection,
  removeEmptyCodexStatGroup,
  statTitle,
  createFullStatDom,
  entityHasKey,
  readEntityKey,
  createValideStatDom,
  tagUmbraStatContainer,
  createEntityStatsTitleNode,
  createBlockTitle,
  withBlockSubtitle,
  createBlockMarker,
};

// Shared power and rate displays with one refresh cache per pass.

let powerRefreshTimer = null;

let powerRefreshFrame = null;

let powerPassCache = null;

let powerPassEquipment = null;

let powerPassArmy = null;

let powerPassConfiguration = null;

function powerEntityInputs(entity) {
  return [entity.id, entity.type, entity.level, entity.stats, entity.baseStats,
    entity.modifierStats, entity.battleBoosts, entity.stuff, entity.armorLayers,
    entity.Archetype, entity.archetypeFrozen, entity.summonOrigin, entity.attackDetails, entity.attacks,
    !entity.attackDetails && !entity.attacks ? entity.currentAttack : null];
}

function resolvePowerOwner(owner, update) {
  if (update && String(update.id) === String(owner.id)) return { ...owner, ...update };
  const match = candidate => String(candidate.id) === String(owner.id);
  return entites.find(match) || window.selectedArmyA?.find(match) || window.selectedArmyB?.find(match)
    || (powerPassArmy || loadFromLocalStorage('selectedArmyA', [])).find(match) || owner;
}

function cachedDisplayPower(node, kind, inputs, calculate) {
  const signature = JSON.stringify([kind, powerPassConfiguration || getPowerConfigurationSignature(), inputs]);
  if (node._powerSignature === signature) return node._powerResult;
  const result = powerPassCache?.get(signature) || calculate();
  powerPassCache?.set(signature, result);
  node._powerSignature = signature;
  node._powerResult = result;
  return result;
}

function schedulePowerRefresh() {
  if (powerRefreshTimer !== null || !isAdminMode()) return;
  powerRefreshTimer = setTimeout(() => {
    powerRefreshTimer = null;
    if (document.hidden || !isAdminMode()) return;
    if (!document.querySelector('[data-refresh-power]')) return;
    refreshDisplayedPowers();
    schedulePowerRefresh();
  }, 250);
}

function refreshDisplayedPowers(entity = null) {
  const enabled = isAdminMode();
  powerPassCache = new Map();
  powerPassEquipment = enabled ? loadEquippedItems() : null;
  powerPassArmy = enabled ? loadFromLocalStorage('selectedArmyA', []) : null;
  powerPassConfiguration = enabled ? getPowerConfigurationSignature() : null;
  try {
    document.querySelectorAll('[data-refresh-power]').forEach(node => {
      node._refreshPower?.(entity && node.dataset.entityId === String(entity.id) ? entity : undefined);
    });
  } finally {
    powerPassCache = powerPassEquipment = powerPassArmy = powerPassConfiguration = null;
  }
}

function queuePowerRefresh(event) {
  const entity = event?.detail?.entite || event?.detail?.entity;
  if (entity) refreshDisplayedPowers(entity);
  if (powerRefreshFrame !== null) return;
  powerRefreshFrame = requestAnimationFrame(() => {
    powerRefreshFrame = null;
    refreshDisplayedPowers();
    schedulePowerRefresh();
  });
}

function createAttackPowerValue(attack, owner) {
  const line = document.createElement('span');
  line.className = 'attack-power-value';
  line.dataset.adminPower = 'attack';
  line.dataset.entityId = String(owner.id);
  line.dataset.refreshPower = 'true';
  line.dataset.attackKey = attackSelectionKey(attack);
  const refresh = currentOwner => {
    line.hidden = !isAdminMode();
    if (line.hidden) return true;
    owner = resolvePowerOwner(owner, currentOwner);
    const attacks = readOwnedPowerAttacks(owner, attackDetails);
    attack = attacks.find(candidate => attack.entityAttackId && candidate.entityAttackId === attack.entityAttackId)
      || attacks.find(candidate => attackSelectionKey(candidate) === line.dataset.attackKey) || attack;
    const result = cachedDisplayPower(line, 'attack', [powerEntityInputs(owner), attack], () => calculateAttackPower(attack, owner));
    const value = roundPower(result.score).toLocaleString('fr-FR');
    if (line.textContent !== value) line.textContent = value;
    line.setAttribute('aria-label', `Power : ${value}`);
    line.title = getPowerBreakdownLines(result).join('\n');
    return true;
  };
  line._refreshPower = refresh;
  refresh(owner);
  schedulePowerRefresh();
  return line;
}

function createEntityPowerValue(entity) {
  const panel = document.createElement('span');
  panel.className = 'entity-power-value';
  panel.dataset.adminPower = 'entity';
  panel.dataset.entityId = String(entity.id);
  panel.dataset.refreshPower = 'true';
  const refresh = currentEntity => {
    panel.hidden = !isAdminMode();
    if (panel.hidden) return;
    entity = resolvePowerOwner(entity, currentEntity);
    const ids = new Set(Object.values(entity.stuff || {}).flat());
    const equipment = (powerPassEquipment || loadEquippedItems()).filter(item => ids.has(item.equippedId));
    const power = cachedDisplayPower(panel, 'entity', [powerEntityInputs(entity), equipment], () => calculateEntityPower(entity, { equipment }));
    const value = roundPower(power.score).toLocaleString('fr-FR');
    if (panel.textContent !== value) panel.textContent = value;
    panel.setAttribute('aria-label', `Power : ${panel.textContent}`);
  };
  panel._refreshPower = refresh;
  refresh();
  schedulePowerRefresh();
  return panel;
}

function createArmyPowerReport(army, side) {
  const power = calculateArmyPower(army);
  const counted = new Map(power.details.map(row => [row.path[0], row.breakdown]));
  return {
    side,
    generatedAt: new Date().toISOString(),
    power,
    entities: army.map(entity => {
      const includedInTotal = counted.has(String(entity.id));
      const result = counted.get(String(entity.id)) || calculateEntityPower(entity);
      return {
        id: entity.id,
        name: entity.nickname || entity.name,
        level: entity.level?.current ?? entity.level,
        includedInTotal,
        ...(!includedInTotal ? { countedThroughSummoner: entity.summonOrigin?.casterId } : {}),
        power: result,
        calculation: getPowerBreakdownLines(result),
      };
    }),
  };
}

function createEntityRateSummary(entity) {
  const line = document.createElement('div');
  line.className = 'entity-rate-summary';
  line.dataset.entityId = String(entity.id);
  line._refreshRate = current => {
    if (current) entity = current;
    const rates = calculateEntityRates(entity);
    line.textContent = `DPS : ${roundPower(rates.dps)} · HPS : ${roundPower(rates.hps)}${rates.incomplete ? ' (partiels)' : ''}`;
    line.title = buildEntityRateHelper(rates);
  };
  line._refreshRate();
  return line;
}

function createArmyPowerSummary(readArmy, label = 'Power de l’armée') {
  const panel = document.createElement('details');
  panel.className = 'entity-power-summary';
  panel.dataset.adminPower = 'army';
  panel.dataset.refreshPower = 'true';
  const heading = document.createElement('summary');
  heading.textContent = label;
  const content = document.createElement('pre');
  panel.append(heading, content);
  panel._refreshPower = () => {
    panel.hidden = !isAdminMode();
    if (panel.hidden || !panel.open) return;
    const army = readArmy();
    if (!Array.isArray(army) || !army.length) {
      content.textContent = 'Aucune armée générée.';
      return;
    }
    const result = cachedDisplayPower(panel, 'army', [army.map(powerEntityInputs), powerPassEquipment || loadEquippedItems()], () => calculateArmyPower(army));
    const text = getPowerBreakdownLines(result).join('\n');
    if (content.textContent !== text) content.textContent = text;
  };
  panel.addEventListener('toggle', panel._refreshPower);
  panel._refreshPower();
  schedulePowerRefresh();
  return panel;
}

export {
  cachedDisplayPower,
  schedulePowerRefresh,
  createEntityPowerValue,
  createArmyPowerReport,
  createEntityRateSummary,
  createArmyPowerSummary,
  resolvePowerOwner,
  refreshDisplayedPowers,
  createAttackPowerValue,
};

// Register shared handlers once, after the complete module graph is initialized.
let initialized = false;
export function initializePowerViews() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('adminModeChanged', () => {
    if (powerRefreshTimer !== null) clearTimeout(powerRefreshTimer);
    powerRefreshTimer = null;
    refreshDisplayedPowers();
    document.querySelectorAll('.attack-dps-preview').forEach(row => row._refreshRate?.());
    document.querySelectorAll('.admin-attack-card-controls').forEach(row => { row.hidden = !isAdminMode(); });
    document.querySelectorAll('.stat-hover[data-stat="attackDps"]').forEach(helper => {
      const body = helper.querySelector('.stat-hover-body');
      if (body && helper._helperHost?.isConnected) body.innerHTML = helper._helperHost.dataset.helperText;
      else helper.remove();
    });
    schedulePowerRefresh();
  });

  ['selectedArmyAUpdated', 'inventoryItemsUpdated', 'equippedItemsUpdated', 'attackEssenceSocketUpdated',
    'linkedEssenceInventoryUpdated', 'attackMasteryChanged', 'entityProgressionReset']
    .forEach(name => window.addEventListener(name, queuePowerRefresh));

  document.addEventListener('visibilitychange', () => { if (!document.hidden) queuePowerRefresh(); });
}

const entries = new Map(), columns = new Map();
let pulse = null;
const fmt = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
const seconds = deadline => Math.max(0, deadline - clockNow()) / 1000;
const duration = value => `${value.toFixed(1).replace('.', ',')} s`;
const actualTick = tick => tick ? `${fmt(tick.hp)} HP · ${fmt(tick.armor)} armure` : '—';
const helperFor = node => document.querySelector(`.stat-hover[data-helper-key="${CSS.escape(node.dataset.helperKey)}"]`);

function sourceMarkup(source) {
  const portrait = source.portrait ? `<img class="effect-source-portrait" src="${escape(cachedResourceUrl(source.portrait))}" alt="">` : '';
  return `${portrait}<span>${escape(source.sourceLabel || 'Source inconnue')}</span>`;
}

function helperHtml(group, now) {
  const sorted = group.entries.slice().sort((a,b) => a.endAt() - b.endAt() || a.key.localeCompare(b.key));
  const read = sorted.map(entry => ({ ...entry.read(), remaining: Math.max(0, entry.endAt() - now) / 1000 }));
  const remaining = Math.max(...read.map(source => source.remaining));
  if (group.kind === 'poison') {
    return `<div class="effect-source-heading">${read.length} source${read.length > 1 ? 's' : ''} active${read.length > 1 ? 's' : ''} · Dernière fin : <strong>${duration(remaining)}</strong></div>`
      + `<table class="effect-source-table"><thead><tr><th>Source</th><th>Reste</th><th>Dernier tick subi</th></tr></thead><tbody>`
      + read.map(source => `<tr><td><div class="effect-source-name">${sourceMarkup(source)}</div><small>${fmt(source.dps)} dégâts/s après Résistance aux altérations · tick de ${fmt(source.interval)} s</small></td><td>${duration(source.remaining)}</td><td>${actualTick(source.lastTick)}</td></tr>`).join('')
      + `</tbody></table><div class="effect-helper-note">Chaque source conserve sa durée et sa cadence. Les dégâts subis distinguent HP et armure.</div>`;
  }
  if (group.kind === 'brulure') {
    const fire = read[0], sources = fire.sources || [];
    return `<div class="effect-source-heading">Feu commun · ${fire.count} apports · ${new Set(sources.map(source => source.attacker)).size} lanceur(s)</div>`
      + `<div class="effect-last-tick">Dernier tick subi : <strong>${actualTick(fire.lastTick)}</strong></div>`
      + `<div>${fmt(fire.dps)} dégâts/s après Résistance aux altérations · tick de ${fmt(fire.interval)} s</div>`
      + `<div class="effect-maintenance">Prochaine baisse : <strong>${duration(seconds(fire.maintenanceAt))}</strong><progress max="1" value="${Math.max(0, Math.min(1, seconds(fire.maintenanceAt) / fire.maintenanceSeconds))}"></progress></div>`
      + `<div>Sans nouvel apport : −${fmt(fire.lossPercent)} % par cycle.<br>Extinction estimée : <strong>${duration(remaining)}</strong></div>`
      + `<table class="effect-source-table"><thead><tr><th>Contributeur</th><th>Apports</th></tr></thead><tbody>`
      + sources.map(source => `<tr><td><div class="effect-source-name">${sourceMarkup(source)}</div></td><td>${source.count}</td></tr>`).join('')
      + `</tbody></table><div class="effect-helper-note">Un apport réussi entretient le feu, sans décaler le prochain tick.</div>`;
  }
  return `<div>Durée restante : <strong>${duration(remaining)}</strong></div>`
    + read.map(source => `<div class="effect-control-source">${read.length > 1 ? `<div class="effect-source-name">${sourceMarkup(source)}<span>${duration(source.remaining)}</span></div>` : ''}${source.html || ''}</div>`).join('');
}

function removeRow(row) { helperFor(row)?.remove(); row.remove(); }

function makeRow(column, group) {
  const row = document.createElement('div');
  row.className = 'attack-nature-effect entity-effect-row';
  row.dataset.stat = 'active-effect'; row.dataset.hover = 'true'; row.dataset.entityEffect = group.kind;
  row.dataset.helperKey = `${column.target.id}-effect-${group.kind}`;
  row.dataset.entityId = String(column.target.id);
  row.dataset.activeEffect = group.label;
  row.dataset.helperClass = 'active-effect-hover entity-effect-hover';
  row.tabIndex = 0; row.setAttribute('role', 'button');
  const visual = EFFECT_VISUALS[group.kind];
  const icon = visual
    ? `<img class="entity-effect-icon" src="${escape(cachedResourceUrl(visual.src))}" alt="" draggable="false">`
    : '<span class="entity-effect-icon" aria-hidden="true"></span>';
  row.innerHTML = `${icon}<span class="entity-effect-count" aria-hidden="true"></span><small class="entity-effect-time"></small>`;
  if (!EFFECT_VISUALS[group.kind]) row.querySelector('.entity-effect-icon').classList.add('picto-stat', group.entries[0].stat || 'neutral');
  row._refreshActiveEffect = () => {
    const current = column.groups.get(group.kind);
    if (!current) return;
    row.dataset.helperText = helperHtml(current, clockNow());
    const helper = helperFor(row);
    if (helper) refreshStatHelper(helper, row, column.target);
  };
  for (const event of ['mouseover', 'focusin']) row.addEventListener(event, row._refreshActiveEffect);
  for (const event of ['click', 'dblclick', 'pointerdown', 'dragstart']) row.addEventListener(event, eventObject => {
    eventObject.stopPropagation();
    if (event === 'dragstart') eventObject.preventDefault();
  });
  bindHelperEntity(row, column.target);
  return row;
}

function renderColumn(column) {
  const { target } = column;
  const host = document.getElementById(`effectsContainer_${target.id}`);
  if (!host) return;
  if (!column.node?.isConnected) {
    column.node = host.querySelector(':scope > .entity-effect-column') || document.createElement('div');
    // Restored scene markup is rebound from effect snapshots, never from saved listeners.
    column.node.replaceChildren(); column.rows = new Map(); column.signature = '';
    column.node.className = 'entity-effect-column';
    column.node.dataset.entityId = String(target.id);
    column.node.setAttribute('aria-label', 'Effets actifs');
    host.append(column.node);
  }
  column.node.dataset.side = target.side === 'B' ? 'B' : 'A';
  const groups = new Map();
  for (const [key, entry] of entries) {
    if (String(entry.target.id) !== String(target.id) || entry.endAt() <= clockNow() || target.isDEAD || target.stats?.HP?.current <= 0) continue;
    const group = groups.get(entry.kind) || { kind: entry.kind, label: entry.label, entries: [], expiresAt: 0, count: 0 };
    group.entries.push({ ...entry, key }); group.expiresAt = Math.max(group.expiresAt, entry.endAt());
    group.count += entry.count?.() ?? 1; groups.set(entry.kind, group);
  }
  column.groups = groups;
  for (const [kind, row] of column.rows) if (!groups.has(kind)) { removeRow(row); column.rows.delete(kind); }
  const ordered = [...groups.values()].sort((a,b) => a.expiresAt - b.expiresAt || a.kind.localeCompare(b.kind));
  const signature = ordered.map(group => group.kind).join('|');
  const positions = signature !== column.signature ? new Map([...column.rows].map(([key,row]) => [key,row.getBoundingClientRect().top])) : null;
  for (const group of ordered) {
    let row = column.rows.get(group.kind);
    if (!row) { row = makeRow(column, group); column.rows.set(group.kind, row); }
    const type = group.entries[0].type;
    if (type === 'dot') row.dataset.dotEffect = group.kind;
    if (type === 'control') row.dataset.controlEffect = group.kind;
    if (type === 'nature') row.dataset.natureEffect = group.kind;
    row.style.setProperty('--effect-color', EFFECT_VISUALS[group.kind]?.color || '#e4d2a6');
    row.dataset.expiresAt = String(group.expiresAt);
    row.dataset.effectCount = String(group.count);
    const count = row.querySelector('.entity-effect-count'); count.hidden = group.count <= 1; count.textContent = group.count;
    const countLabel = group.kind === 'brulure' ? 'apports' : type === 'nature' ? 'cumuls' : 'sources';
    const label = `${group.label}${group.count > 1 ? ` · ${group.count} ${countLabel}` : ''} · ${duration(seconds(group.expiresAt))}${group.kind === 'brulure' ? ' sans nouvel apport' : ''}`;
    row.setAttribute('aria-label', label);
    row.querySelector('small').textContent = duration(seconds(group.expiresAt));
    row.classList.toggle('is-decaying', group.entries.some(entry => entry.decaying?.()));
    if (signature !== column.signature || row.parentElement !== column.node) column.node.append(row);
    if (helperFor(row)) row._refreshActiveEffect();
  }
  if (positions && column.signature && !isCombatPaused() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const [key,row] of column.rows) {
      const offset = positions.get(key) - row.getBoundingClientRect().top;
      if (Number.isFinite(offset) && Math.abs(offset) > 1) row.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 140 });
    }
  }
  column.signature = signature;
  if (!ordered.length) { column.node.remove(); columns.delete(String(target.id)); }
}

export function refreshEntityEffectViews(target = null) {
  for (const column of columns.values()) if (!target || String(column.target.id) === String(target.id)) renderColumn(column);
}

export function setEntityEffectView(target, key, entry) {
  entries.set(key, { ...entry, target });
  let column = columns.get(String(target.id));
  if (!column) { column = { target, rows: new Map(), groups: new Map() }; columns.set(String(target.id), column); }
  column.target = target; renderColumn(column);
  if (pulse === null) pulse = setInterval(() => refreshEntityEffectViews(), 250);
}

export function removeEntityEffectView(key) {
  const entry = entries.get(key); entries.delete(key);
  if (entry) refreshEntityEffectViews(entry.target);
  if (!entries.size && pulse !== null) { clearInterval(pulse); pulse = null; }
}

export function clearEntityEffectViews() {
  for (const column of columns.values()) { for (const row of column.rows.values()) removeRow(row); column.node?.remove(); }
  entries.clear(); columns.clear(); clearInterval(pulse); pulse = null;
}
window.addEventListener('entityCombatSideChanged', ({ detail }) => refreshEntityEffectViews(detail.entity));
for (const event of ['battleEnding', 'battleStopped', 'battleResolved', 'stageInterfaceClosing']) window.addEventListener(event, clearEntityEffectViews);
