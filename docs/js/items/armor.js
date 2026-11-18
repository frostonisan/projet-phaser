import { balanceData } from "../data/balanceData.js";

const ARMOR_KEY = "armor";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNonNegativeInt(value) {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

export function calculateRobustnessArmorDetails(robustness, strength = 0) {
  const cfg = balanceData.generatedStats.robustnessArmor;
  const points = Math.max(0, toNumber(robustness));
  const force = Math.max(0, toNumber(strength));
  const P = globalThis.umbraProgression;
  const sourcePart = P.progressivePowerPart('robustness', points, cfg.ratios.source);
  const attributePart = P.progressivePowerPart('strength', force, points > 0 ? cfg.ratios.attribute : 0);
  const flatBonus = points * cfg.flatPerPoint;
  // The shared curve retains fractional overflow. Only the resource capacity
  // is rounded to whole armor points; recomputing never refills that resource.
  return {
    armor: Math.min(Number.MAX_VALUE, Math.round(sourcePart.value + attributePart.value + flatBonus)),
    robustness: points,
    robustnessBonus: sourcePart.value,
    strength: force,
    strengthBonus: attributePart.value,
    flatBonus, sourcePart, attributePart,
  };
}

export function calculateRobustnessBonus(robustness, strength = 0) {
  return calculateRobustnessArmorDetails(robustness, strength).armor;
}

function clampPoolCurrent(current, max) {
  const cap = toNonNegativeInt(max);
  return Math.max(0, Math.min(toNonNegativeInt(current), cap));
}

function clampPrecisePoolCurrent(current, max) {
  const cap = toNonNegativeInt(max);
  const value = Math.max(0, toNumber(current, 0));
  if (value < 0.000001) return 0;
  return Math.min(value, cap);
}

function normalizeStatName(stat) {
  const raw = String(stat || "").trim();
  if (!raw) return "";
  const last = raw.includes(".") ? raw.split(".").pop() : raw;
  return last.trim();
}

function isArmorStat(stat) {
  return normalizeStatName(stat) === ARMOR_KEY;
}

function readArmorEffectValue(value) {
  if (value && typeof value === "object") {
    return toNumber(value.max ?? value.current ?? value.flat ?? 0, 0);
  }

  return toNumber(value, 0);
}

function armorEffectMax(effect) {
  if (!effect || effect.type !== "stat-buff" || !isArmorStat(effect.stat)) return 0;
  return Math.max(0, readArmorEffectValue(effect.value ?? effect.amount ?? effect.quantity));
}

export function getStuffArmorReserveMax(item) {
  const effects = Array.isArray(item?.Stuffeffets) ? item.Stuffeffets : [];
  return toNonNegativeInt(effects.reduce((sum, effect) => sum + armorEffectMax(effect), 0));
}

export function ensureStuffArmorReserve(item) {
  if (!item || typeof item !== "object") return item;

  const max = getStuffArmorReserveMax(item);
  if (max <= 0) return item;

  const previous = item.armorReserve && typeof item.armorReserve === "object"
    ? item.armorReserve
    : null;
  const preciseCurrent = previous && Number.isFinite(Number(previous.preciseCurrent ?? previous.current))
    ? clampPrecisePoolCurrent(previous.preciseCurrent ?? previous.current, max)
    : max;

  item.armorReserve = {
    current: clampPoolCurrent(preciseCurrent, max),
    preciseCurrent,
    max,
  };

  return item;
}

export function stripStuffArmorModifier(delta = {}) {
  if (!delta || typeof delta !== "object") return {};

  const next = {};
  for (const [stat, value] of Object.entries(delta)) {
    if (!isArmorStat(stat)) {
      next[stat] = value;
      continue;
    }

    const numeric = readArmorEffectValue(value);
    if (numeric < 0) next[stat] = value;
  }

  return next;
}

function equippedItemsById(equippedItems = []) {
  const map = {};
  if (!Array.isArray(equippedItems)) return map;

  equippedItems.forEach(item => {
    if (item?.equippedId) map[item.equippedId] = item;
  });

  return map;
}

function entityEquippedIds(entity) {
  const stuff = entity?.stuff && typeof entity.stuff === "object" ? entity.stuff : {};
  return Object.keys(stuff)
    .sort((a, b) => String(a).localeCompare(String(b), "fr", { numeric: true }))
    .flatMap(slotKey => Array.isArray(stuff[slotKey]) ? stuff[slotKey] : [])
    .filter(id => typeof id === "string" && id.startsWith("e"));
}

function normalizePool(pool, max, fallbackCurrent = max) {
  const cap = toNonNegativeInt(max);
  const currentSource = pool && typeof pool === "object" && Number.isFinite(Number(pool.current))
    ? pool.current
    : fallbackCurrent;

  return {
    current: clampPoolCurrent(currentSource, cap),
    max: cap,
  };
}

function allocateCurrentByConsumptionOrder(current, externalMax, robustnessMax) {
  const baseMax = externalMax + robustnessMax;
  const safeCurrent = clampPoolCurrent(current, baseMax);
  let consumed = Math.max(0, baseMax - safeCurrent);

  const externalConsumed = Math.min(externalMax, consumed);
  consumed -= externalConsumed;

  const robustnessConsumed = Math.min(robustnessMax, consumed);

  return {
    external: {
      current: externalMax - externalConsumed,
      max: externalMax,
    },
    robustness: {
      current: robustnessMax - robustnessConsumed,
      max: robustnessMax,
    },
  };
}

function allocateAllCurrentByConsumptionOrder(current, externalMax, stuffLayers, robustnessMax, equippedIds) {
  const stuffMax = equippedIds.reduce((sum, equippedId) => (
    sum + toNonNegativeInt(stuffLayers?.[equippedId]?.max ?? 0)
  ), 0);
  const totalMax = externalMax + stuffMax + robustnessMax;
  let consumed = Math.max(0, totalMax - clampPoolCurrent(current, totalMax));

  const externalConsumed = Math.min(externalMax, consumed);
  consumed -= externalConsumed;

  for (const equippedId of equippedIds) {
    const layer = stuffLayers?.[equippedId];
    if (!layer) continue;

    const max = toNonNegativeInt(layer.max);
    const layerConsumed = Math.min(max, consumed);
    consumed -= layerConsumed;
    consumeStuffArmorLayer(layer, layerConsumed);
  }

  const robustnessConsumed = Math.min(robustnessMax, consumed);

  return {
    external: {
      current: externalMax - externalConsumed,
      max: externalMax,
    },
    robustness: {
      current: robustnessMax - robustnessConsumed,
      max: robustnessMax,
    },
  };
}

function readExistingPool(layers, key) {
  const pool = layers?.[key];
  return pool && typeof pool === "object" ? pool : null;
}

function getEntityWeaponOrfevrePercent(entity) {
  const value = Number(entity?.modifierStats?.durable?.stuff?.orfevre?.activePercent ?? 0) || 0;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeReserveArmorPool(pool, maxFallback = 0, currentFallback = maxFallback) {
  const max = toNonNegativeInt(pool?.max ?? maxFallback);
  const preciseCurrent = clampPrecisePoolCurrent(
    pool?.preciseCurrent ?? pool?.current ?? currentFallback,
    max
  );

  return {
    current: clampPoolCurrent(preciseCurrent, max),
    preciseCurrent,
    max,
  };
}

function buildEffectiveStuffArmorPool(reserve, percent = 0) {
  const reservePool = normalizeReserveArmorPool(reserve);
  const activePercent = Math.max(0, toNumber(percent, 0));
  const multiplier = 1 + activePercent / 100;
  const max = toNonNegativeInt(reservePool.max * multiplier);
  const preciseCurrent = Math.min(max, reservePool.preciseCurrent * multiplier);

  return {
    current: clampPoolCurrent(preciseCurrent, max),
    preciseCurrent,
    max,
    percent: activePercent,
    multiplier,
    baseMax: reservePool.max,
  };
}

function composeStuffArmorLayer(reserve, percent = 0) {
  const reservePool = normalizeReserveArmorPool(reserve, reserve?.max ?? 0, reserve?.current ?? 0);
  const effectivePool = buildEffectiveStuffArmorPool(reservePool, percent);
  const orfevreCurrent = Math.max(0, effectivePool.current - reservePool.current);
  const orfevreMax = Math.max(0, effectivePool.max - reservePool.max);

  return {
    current: effectivePool.current,
    max: effectivePool.max,
    reserve: reservePool,
    effective: effectivePool,
    // Derived compatibility fields used by descriptions/debug tools.
    orfevre: {
      current: orfevreCurrent,
      max: orfevreMax,
      percent: effectivePool.percent,
      multiplier: effectivePool.multiplier,
      baseMax: reservePool.max,
    },
    reserveCurrent: reservePool.current,
    reserveMax: reservePool.max,
    effectiveCurrent: effectivePool.current,
    effectiveMax: effectivePool.max,
    orfevreCurrent,
    orfevreMax,
  };
}

function normalizeStuffArmorLayer(layer) {
  if (!layer || typeof layer !== "object") {
    return composeStuffArmorLayer({ current: 0, max: 0 }, 0);
  }

  const reserve = layer.reserve && typeof layer.reserve === "object"
    ? layer.reserve
    : {
        current: layer.reserveCurrent ?? layer.current ?? 0,
        preciseCurrent: layer.reservePreciseCurrent ?? layer.preciseCurrent,
        max: layer.reserveMax ?? layer.max ?? 0,
      };
  const percent = layer.effective?.percent
    ?? layer.orfevre?.percent
    ?? layer.orfevrePercent
    ?? 0;

  return composeStuffArmorLayer(reserve, percent);
}

function consumeStuffArmorLayer(layer, amount) {
  const normalized = normalizeStuffArmorLayer(layer);
  const absorbed = Math.min(
    Math.max(0, toNumber(amount, 0)),
    toNonNegativeInt(normalized.current)
  );
  if (absorbed <= 0) return 0;

  const nextEffectivePrecise = Math.max(0, normalized.effective.preciseCurrent - absorbed);
  const multiplier = Math.max(1, toNumber(normalized.effective.multiplier, 1));
  const nextReservePrecise = clampPrecisePoolCurrent(
    nextEffectivePrecise / multiplier,
    normalized.reserve.max
  );
  const nextReserve = {
    ...normalized.reserve,
    preciseCurrent: nextReservePrecise,
    current: clampPoolCurrent(nextReservePrecise, normalized.reserve.max),
  };

  Object.assign(layer, composeStuffArmorLayer(nextReserve, normalized.effective.percent));
  return absorbed;
}

export function syncEntityArmorLayers(entity, {
  equippedItems = [],
  previousArmorCurrent = null,
  previousArmorMax = null,
  robustnessArmorMax = null,
} = {}) {
  if (!entity || typeof entity !== "object") return entity;

  const itemById = equippedItemsById(equippedItems);
  const equippedIds = entityEquippedIds(entity);
  const previousLayers = entity.armorLayers && typeof entity.armorLayers === "object"
    ? entity.armorLayers
    : null;
  const hadLayers = Boolean(previousLayers);

  const baseArmorMax = toNonNegativeInt(entity.stats?.armor?.max ?? entity.stats?.armor?.current ?? 0);
  const robustnessMax = Math.min(
    baseArmorMax,
    toNonNegativeInt(robustnessArmorMax ?? entity.modifierStats?.durable?.derived?.armor ?? 0)
  );
  const externalMax = Math.max(0, baseArmorMax - robustnessMax);

  const stuffLayers = {};
  let stuffCurrent = 0;
  let stuffMax = 0;
  const orfevrePercent = getEntityWeaponOrfevrePercent(entity);

  equippedIds.forEach(equippedId => {
    const item = ensureStuffArmorReserve(itemById[equippedId]);
    const reserveMax = toNonNegativeInt(item?.armorReserve?.max ?? 0);
    if (reserveMax <= 0) return;

    const reserveCurrent = clampPoolCurrent(item.armorReserve.preciseCurrent ?? item.armorReserve.current, reserveMax);
    const layer = composeStuffArmorLayer(
      {
        current: reserveCurrent,
        preciseCurrent: clampPrecisePoolCurrent(item.armorReserve.preciseCurrent ?? item.armorReserve.current, reserveMax),
        max: reserveMax,
      },
      orfevrePercent
    );

    stuffLayers[equippedId] = layer;
    stuffCurrent += layer.current;
    stuffMax += layer.max;
  });

  let external;
  let robustness;

  if (hadLayers) {
    external = normalizePool(readExistingPool(previousLayers, "external"), externalMax, externalMax);
    robustness = normalizePool(readExistingPool(previousLayers, "robustness"), robustnessMax, robustnessMax);
  } else {
    // Missing history means a new full reserve; an explicit zero remains empty.
    const previousCurrent = previousArmorCurrent != null && Number.isFinite(Number(previousArmorCurrent))
      ? toNonNegativeInt(previousArmorCurrent)
      : baseArmorMax;
    const previousMax = previousArmorMax != null && Number.isFinite(Number(previousArmorMax))
      ? toNonNegativeInt(previousArmorMax)
      : baseArmorMax;
    const previousIncludedStuff = stuffMax > 0 && previousMax > baseArmorMax;
    const allocated = previousIncludedStuff
      ? allocateAllCurrentByConsumptionOrder(previousCurrent, externalMax, stuffLayers, robustnessMax, equippedIds)
      : allocateCurrentByConsumptionOrder(previousCurrent, externalMax, robustnessMax);
    external = allocated.external;
    robustness = allocated.robustness;
    stuffCurrent = Object.values(stuffLayers).reduce((sum, layer) => sum + toNonNegativeInt(layer?.current), 0);
  }

  const consumable = normalizePool(previousLayers?.consumable, previousLayers?.consumable?.max ?? 0, 0);
  const spell = normalizePool(previousLayers?.spell, previousLayers?.spell?.max ?? 0, 0);
  const totalCurrent = consumable.current + external.current + spell.current + stuffCurrent + robustness.current;
  const totalMax = consumable.max + external.max + spell.max + stuffMax + robustness.max;

  entity.armorLayers = {
    consumable,
    spell,
    external,
    stuff: stuffLayers,
    robustness,
  };

  if (totalMax > 0) {
    entity.stats ??= {};
    entity.stats.armor = {
      current: totalCurrent,
      max: robustness.max,
      totalMax,
      externalMax: external.max + consumable.max + spell.max,
      stuffMax,
      robustnessMax: robustness.max,
      regenMax: robustness.max,
    };
  } else if (entity.stats?.armor) {
    delete entity.stats.armor;
  }

  return entity;
}

function ensureConsumableLayers(entity) {
  if (entity?.armorLayers && typeof entity.armorLayers === "object") {
    entity.armorLayers.consumable ??= { current: 0, max: 0 };
    entity.armorLayers.spell ??= { current: 0, max: 0 };
    return entity.armorLayers;
  }

  const current = toNonNegativeInt(entity?.stats?.armor?.current ?? 0);
  const max = Math.max(current, toNonNegativeInt(entity?.stats?.armor?.max ?? 0));
  entity.armorLayers = {
    consumable: { current: 0, max: 0 },
    spell: { current: 0, max: 0 },
    external: { current, max },
    stuff: {},
    robustness: { current: 0, max: 0 },
  };

  return entity.armorLayers;
}

function recomputeArmorAggregate(entity) {
  const layers = ensureConsumableLayers(entity);
  const stuffEntries = Object.entries(layers.stuff || {});
  let stuffCurrent = 0;
  let stuffMax = 0;
  for (const [equippedId, layer] of stuffEntries) {
    const normalized = normalizeStuffArmorLayer(layer);
    layers.stuff[equippedId] = normalized;
    stuffCurrent += normalized.current;
    stuffMax += normalized.max;
  }
  const external = normalizePool(layers.external, layers.external?.max ?? 0, 0);
  const robustness = normalizePool(layers.robustness, layers.robustness?.max ?? 0, 0);

  layers.external = external;
  layers.robustness = robustness;

  const totalCurrent = layers.consumable.current + external.current + layers.spell.current + stuffCurrent + robustness.current;
  const totalMax = layers.consumable.max + external.max + layers.spell.max + stuffMax + robustness.max;

  if (totalMax > 0) {
    entity.stats ??= {};
    entity.stats.armor = {
      current: totalCurrent,
      max: robustness.max,
      totalMax,
      externalMax: external.max + layers.consumable.max + layers.spell.max,
      stuffMax,
      robustnessMax: robustness.max,
      regenMax: robustness.max,
    };
  } else if (entity.stats?.armor) {
    delete entity.stats.armor;
  }

  return entity.stats?.armor || null;
}

function consumePool(pool, amount) {
  const damage = Math.max(0, toNumber(amount, 0));
  const before = toNonNegativeInt(pool?.current ?? 0);
  const absorbed = Math.min(before, damage);
  pool.current = before - absorbed;
  return absorbed;
}

export function consumeEntityArmor(entity, amount) {
  const layers = ensureConsumableLayers(entity);
  let remaining = Math.max(0, toNumber(amount, 0));
  const before = toNonNegativeInt(entity?.stats?.armor?.current ?? 0);
  const stuffDamage = {};

  const consumableAbsorbed = consumePool(layers.consumable, remaining);
  remaining -= consumableAbsorbed;

  let stuffAbsorbed = 0;
  for (const equippedId of entityEquippedIds(entity)) {
    const layer = layers.stuff?.[equippedId];
    if (!layer || remaining <= 0) continue;

    const absorbed = consumeStuffArmorLayer(layer, remaining);
    if (absorbed > 0) {
      stuffDamage[equippedId] = absorbed;
      stuffAbsorbed += absorbed;
      remaining -= absorbed;
    }
  }

  const spellAbsorbed = consumePool(layers.spell, remaining);
  remaining -= spellAbsorbed;
  const naturalAbsorbed = consumePool(layers.external, remaining);
  remaining -= naturalAbsorbed;
  const externalAbsorbed = consumableAbsorbed + spellAbsorbed + naturalAbsorbed;
  const robustnessAbsorbed = consumePool(layers.robustness, remaining);
  remaining -= robustnessAbsorbed;

  const armor = recomputeArmorAggregate(entity);
  const absorbed = externalAbsorbed + stuffAbsorbed + robustnessAbsorbed;

  return {
    before,
    after: armor?.current ?? 0,
    absorbed,
    remainingDamage: Math.max(0, remaining),
    layers: {
      external: externalAbsorbed,
      consumable: consumableAbsorbed,
      spell: spellAbsorbed,
      natural: naturalAbsorbed,
      stuff: stuffAbsorbed,
      robustness: robustnessAbsorbed,
    },
    stuffDamage,
  };
}

export function resetEntityRegenerableArmor(entity) {
  const layers = ensureConsumableLayers(entity);
  if (!layers.robustness || layers.robustness.max <= 0) {
    recomputeArmorAggregate(entity);
    return false;
  }

  layers.robustness.current = toNonNegativeInt(layers.robustness.max);
  recomputeArmorAggregate(entity);
  return true;
}

export function syncEntityRobustnessArmorCapacity(entity, capacity) {
  if (!entity || typeof entity !== "object") return;
  const layers = ensureConsumableLayers(entity);
  // A changed capacity is not a daily refill: preserve the remaining armor.
  layers.robustness = normalizePool(layers.robustness, capacity, 0);
  entity.modifierStats ??= {};
  entity.modifierStats.durable ??= {};
  entity.modifierStats.durable.derived ??= {};
  if (layers.robustness.max > 0) {
    entity.modifierStats.durable.derived.armor = layers.robustness.max;
  } else {
    delete entity.modifierStats.durable.derived.armor;
  }
  recomputeArmorAggregate(entity);
}

export function grantEntityRobustnessArmor(entity, amount) {
  const value = toNonNegativeInt(amount);
  if (!entity || value <= 0) return 0;
  const layers = ensureConsumableLayers(entity);
  const before = toNonNegativeInt(layers.robustness.current);
  layers.robustness.current = clampPoolCurrent(before + value, layers.robustness.max);
  recomputeArmorAggregate(entity);
  return layers.robustness.current - before;
}

export function grantEntityExternalArmor(entity, amount, source = 'spell') {
  const value = toNonNegativeInt(amount);
  if (!entity || value <= 0) return 0;

  const layers = ensureConsumableLayers(entity);
  if (!['consumable', 'spell', 'natural'].includes(source)) throw new TypeError('Unknown armor source');
  const pool = layers[source === 'natural' ? 'external' : source];
  pool.current = toNonNegativeInt(pool.current) + value;
  pool.max = toNonNegativeInt(pool.max) + value;
  recomputeArmorAggregate(entity);

  return value;
}

export function destroyEntityArmor(entity) {
  const layers = ensureConsumableLayers(entity);
  const before = toNonNegativeInt(entity?.stats?.armor?.current ?? 0);

  layers.external.current = 0;
  layers.consumable.current = 0;
  layers.spell.current = 0;
  Object.values(layers.stuff || {}).forEach(layer => {
    if (!layer) return;
    const normalized = normalizeStuffArmorLayer(layer);
    normalized.reserve.current = 0;
    normalized.reserve.preciseCurrent = 0;
    Object.assign(layer, composeStuffArmorLayer(normalized.reserve, normalized.effective.percent));
  });
  layers.robustness.current = 0;

  recomputeArmorAggregate(entity);

  return {
    armorBefore: before,
    armorAfter: entity?.stats?.armor?.current ?? 0,
    armorDamage: before,
  };
}

export function applyArmorLayersToEquippedItems(entity, equippedItems = []) {
  const layers = entity?.armorLayers?.stuff;
  if (!layers || !Array.isArray(equippedItems)) return equippedItems;

  return equippedItems.map(item => {
    const layer = item?.equippedId ? layers[item.equippedId] : null;
    if (!layer) return item;
    const normalized = normalizeStuffArmorLayer(layer);

    return {
      ...item,
      armorReserve: {
        current: clampPoolCurrent(normalized.reserve.current, normalized.reserve.max),
        preciseCurrent: clampPrecisePoolCurrent(normalized.reserve.preciseCurrent, normalized.reserve.max),
        max: toNonNegativeInt(normalized.reserve.max),
      },
    };
  });
}
