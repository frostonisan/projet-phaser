// Equipment panels, slots and inventory selection inside entity views.
import { cachedResourceUrl } from '../data/loaderList.js';
import { getScoredItemQuality } from '../procedural/proc-bareme.js';
import { loadFromLocalStorage, getEquippedItemById } from '../GameStorage.js';
import { normalizeStatKey } from '../entite/entityRules.js';
import { getEquipmentSlotKeys } from '../entites.js';
import {
  DropFromCodexToInventory,
  setupDragAndDropItem,
  DropEquipementtoInventory,
  DclicSlottoInventory,
  getIngameItemById,
  equippedHoverDescription,
  bindPersistentDescription,
  createItemPowerValue,
} from '../items/itemManager.js';
import { glitterStuff } from '../biome/meteo.js';
import { stats } from '../data/statsData.js';
import { createEntityStatsTitleNode } from './statElements.js';

function getInventoryEntryItemId(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") return entry.itemId || null;
  return null;
}

function isStuffInventoryItem(item) {
  const types = Array.isArray(item?.itemType)
    ? item.itemType
    : [item?.itemType].filter(Boolean);

  return types.includes("stuff");
}

function getCodexStuffInventoryItems() {
  const playerSave = loadFromLocalStorage("PlayerSave", { Playerinventory: [] });
  const inventory = Array.isArray(playerSave.Playerinventory)
    ? playerSave.Playerinventory
    : [];
  const byId = new Map();

  inventory.forEach(entry => {
    const itemId = getInventoryEntryItemId(entry);
    if (!itemId || byId.has(itemId)) return;

    const item = typeof entry === "object" && entry?.itemId
      ? entry
      : getIngameItemById(itemId);

    if (!item || !isStuffInventoryItem(item)) return;
    byId.set(itemId, item);
  });

  return Array.from(byId.values());
}

function getStatNameFromKey(statKey) {
  const canonicalKey = normalizeStatKey(statKey);
  const found = stats.find(stat => normalizeStatKey(stat.key) === canonicalKey);
  return found?.name || statKey;
}

function getCodexEquipmentItemShortName(item) {
  const deltas = buildCodexEquipmentItemDeltas(item);
  const entries = Object.entries(deltas);

  if (entries.length === 1) {
    const [stat, value] = entries[0];
    const sign = Number(value) > 0 ? "+" : "";
    return `${sign}${value} ${getStatNameFromKey(stat)}`;
  }

  return item.displayName || item.name || "Équipement";
}

function buildCodexEquipmentItemDeltas(item) {
  const deltas = {};

  if (!Array.isArray(item?.Stuffeffets)) return deltas;

  item.Stuffeffets.forEach(effect => {
    const stat = normalizeStatKey(effect?.stat);
    const value = Number(effect?.value);
    if (!stat || !Number.isFinite(value)) return;
    deltas[stat] = (Number(deltas[stat]) || 0) + value;
  });

  return deltas;
}

function createCodexEquipmentInventoryItem(item, entite) {
  if (!item?.itemId) return null;

  const itemNode = document.createElement("div");
  itemNode.classList.add("inventory-item", "codex-equipment-inventory-item");
  itemNode.dataset.itemId = item.itemId;
  itemNode.dataset.entityId = entite.id;
  itemNode.setAttribute("draggable", "false");

  const types = Array.isArray(item.itemType)
    ? item.itemType
    : [item.itemType].filter(Boolean);
  types.forEach(type => itemNode.classList.add(type));
  itemNode.classList.add(`quality-${getScoredItemQuality(item)}`);

  const img = document.createElement("img");
  img.src = cachedResourceUrl(item.itemAsset);
  img.alt = item.displayName || item.name || "Équipement";
  img.id = item.itemId;
  img.classList.add("inventory-item-icon");
  if (item.functionName) img.classList.add(item.functionName);
  img.setAttribute("draggable", "true");

  setupDragAndDropItem(img, item.itemId);

  const label = document.createElement("span");
  label.className = "codex-equipment-inventory-item-name";
  label.textContent = getCodexEquipmentItemShortName(item);

  itemNode.append(img, label, createItemPowerValue(item));
  bindPersistentDescription(itemNode, item, item.itemId, "item");

  return itemNode;
}

function renderCodexEquipmentInventoryGrid(grid, entite) {
  if (!grid || !entite) return;

  grid.innerHTML = "";
  const stuffItems = getCodexStuffInventoryItems();

  if (!stuffItems.length) {
    const empty = document.createElement("p");
    empty.className = "codex-equipment-inventory-empty";
    empty.textContent = "Aucun équipement disponible.";
    grid.appendChild(empty);
  } else {
    stuffItems.forEach(item => {
      const itemNode = createCodexEquipmentInventoryItem(item, entite);
      if (itemNode) grid.appendChild(itemNode);
    });
  }

  requestAnimationFrame(() => {
    DropFromCodexToInventory();
    DclicSlottoInventory();
    glitterStuff(".codex-equipment-inventory-item.stuff", 3);
  });
}

function refreshCodexEquipmentInventory(entiteOrId = null) {
  if (typeof document === "undefined") return;

  const targetId = typeof entiteOrId === "object"
    ? entiteOrId?.id
    : entiteOrId;
  const selectedArmy = loadFromLocalStorage("selectedArmyA", []);

  document
    .querySelectorAll(".codex-equipment-inventory-grid[data-entity-id]")
    .forEach(grid => {
      if (targetId && String(grid.dataset.entityId) !== String(targetId)) return;

      const entite =
        (typeof entiteOrId === "object" && String(entiteOrId?.id) === String(grid.dataset.entityId))
          ? entiteOrId
          : selectedArmy.find(entity => String(entity?.id) === String(grid.dataset.entityId));

      renderCodexEquipmentInventoryGrid(grid, entite);
    });
}

function getCodexStableEquipmentCharge(entite) {
  // Les emplacements proteges restent accessibles meme avec une dette de Charge.
  return getEquipmentSlotKeys(entite).length;
}

function createEquipmentSubmenu(entite) {
  if (getCodexStableEquipmentCharge(entite) <= 0) return null;

  const wrapper = document.createElement("div");
  wrapper.classList.add("sub-menu-stat", "equipment-stat");

  const header = document.createElement("div");
  header.className = "sub-menu-stat__header";
  header.appendChild(createEntityStatsTitleNode("Équipement"));
  wrapper.appendChild(header);

  const body = document.createElement("div");
  body.className = "sub-menu-stat__body codex-equipment-body";

  const slotsPanel = document.createElement("div");
  slotsPanel.className = "codex-equipment-slots-panel";
  createStuffDom(entite, slotsPanel);

  const inventoryPanel = document.createElement("div");
  inventoryPanel.className = "codex-equipment-inventory-panel";

  const inventoryHead = document.createElement("div");
  inventoryHead.className = "codex-equipment-inventory-head";

  const bagIcon = document.createElement("div");
  bagIcon.className = "codex-equipment-inventory-icon";

  const inventoryTitle = document.createElement("p");
  inventoryTitle.className = "codex-equipment-inventory-title";
  inventoryTitle.textContent = "Équipement dans l'inventaire";

  inventoryHead.append(bagIcon, inventoryTitle);

  const inventoryGrid = document.createElement("div");
  inventoryGrid.className = "inventory-content codex-equipment-inventory-grid";
  inventoryGrid.dataset.entityId = entite.id;

  inventoryPanel.append(inventoryHead, inventoryGrid);
  body.append(slotsPanel, inventoryPanel);
  wrapper.appendChild(body);

  renderCodexEquipmentInventoryGrid(inventoryGrid, entite);

  return wrapper;
}

function createStuffDom(entite, codexEntityView) {
    console.group(`🧱 createStuffDom : ${entite.name} (ID: ${entite.id})`);

    const slotKeys = getEquipmentSlotKeys(entite);
    const chargeCount = slotKeys.length;
    console.log(`→ Nombre de slots prévus (charge) : ${chargeCount}`);
    const stuffData = entite.stuff || {};

    const entityEquipement = document.createElement('div');
    entityEquipement.className = 'entity-equipement';
    entityEquipement.id = `equipment-${entite.id}`;

for (const slotKey of slotKeys) {
    const i = Number(slotKey.slice(4));
    const slotId = `${slotKey}-${entite.id}`;
    const slot = document.createElement('div');
    slot.className = `stuff-slot container-${i}`;
    slot.id = slotId;

    const itemArray = stuffData[slotKey];
    const hasEquip = Array.isArray(itemArray) && itemArray.length > 0;

if (hasEquip) {
    const rawItemId = itemArray[0];
    const itemData = getItemDataById(rawItemId);

    console.log(`📦 ${slotKey} → équipé avec : ${rawItemId}`);

    if (itemData) {
        const qualityClass = `quality-${getScoredItemQuality(itemData)}`;
        const wrapper = document.createElement('div');
        wrapper.classList.add('stuff-item-wrapper', qualityClass);
        wrapper.dataset.stuffId = rawItemId;

        const itemImg = document.createElement('img');
        itemImg.src = cachedResourceUrl(itemData.itemAsset);
        itemImg.alt = itemData.displayName;
        itemImg.id = rawItemId;
        itemImg.classList.add('inventory-item-icon', itemData.functionName);
        itemImg.setAttribute('draggable', 'true');

itemImg.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', rawItemId);
    e.dataTransfer.effectAllowed = 'move';
    itemImg.classList.add('using');
    console.log(`🚚 Drag depuis slot (createStuffDom) pour ${rawItemId}`);
});

        itemImg.addEventListener('dragend', () => {
            itemImg.classList.remove('using');
        });

        wrapper.appendChild(itemImg);
        slot.appendChild(wrapper);
        slot.classList.add('equiped'); // ✅ Ajoute la classe si équipé

        console.log(`🎯 ${slotKey} DOM rempli avec ${itemData.displayName}`);
    } else {
        console.warn(`❌ ${slotKey} → AUCUN item trouvé avec l'ID ${rawItemId}`);
        slot.classList.remove('equiped'); // 🔁 Par sécurité si incohérence
    }

} else {
    console.log(`🕳️ ${slotKey} → slot vide`);
    slot.classList.remove('equiped');

    // Helper uniquement sur les slots générés vides
    if (!slot.classList.contains("equiped")) {
        slot.dataset.stat = "stuffSlot";
        slot.dataset.hover = "true";
        slot.dataset.entityId = entite.id;
    }
}

    entityEquipement.appendChild(slot);
}

    if (codexEntityView) {
      codexEntityView.appendChild(entityEquipement);
      console.log(`→ DOM .entity-equipement injecté pour ${entite.name}`);
    }

    console.groupEnd();

    requestAnimationFrame(() => {
		DropEquipementtoInventory();
        DclicSlottoInventory();
        equippedHoverDescription();
    });

    return entityEquipement;
}

function getItemDataById(equippedId) {
    const item = getEquippedItemById(equippedId);

    if (!item) {
        console.warn(`🛑 getItemDataById → Aucun item équipé trouvé pour equippedId: ${equippedId}`);
    }

    return item;
}

export { createStuffDom, getCodexStableEquipmentCharge, createEquipmentSubmenu };

// Register shared handlers once, after the complete module graph is initialized.
let initialized = false;
export function initializeEquipment() {
  if (initialized) return;
  initialized = true;
  if (typeof window !== "undefined") {
    window.refreshCodexEquipmentInventory = refreshCodexEquipmentInventory;
  }
}
