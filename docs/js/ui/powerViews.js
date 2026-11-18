// Shared power and rate displays with one refresh cache per pass.
import { buildEntityRateHelper } from '../data/helpers.js';
import { attackDetails } from '../data/attackList.js';
import { getPowerBreakdownLines, roundPower, readOwnedPowerAttacks } from '../procedural/proc-bareme.js';
import { isAdminMode, loadFromLocalStorage, loadEquippedItems } from '../GameStorage.js';
import { entites } from '../entites.js';
import { attackSelectionKey } from '../attackResolution.js';
import {
  calculateEntityPower,
  calculateEntityRates,
  calculateAttackPower,
  calculateArmyPower,
  getPowerConfigurationSignature,
} from '../damagesCalcul.js';

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
