// Réglages et calculs communs au jeu et à Index 14 / Maj.
// Modifier ici la limite, les courbes ou les bases ; balanceData.js les réutilise.
// Classic script compatible with file://; no DOM, storage or game bootstrap.
(() => {
  'use strict';
  if (globalThis.umbraProgression) return;
  const defaultUmbraThreshold = 150;
  function getUmbraThreshold(entity) {
    const threshold = Number(entity?.seuilUmbra ?? defaultUmbraThreshold);
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : defaultUmbraThreshold;
  }
  const progression = {
      // Référence des ratios et seuil des attributs ; indépendant du seuil d'Umbra de l'entité.
      limit: 150,
      levelOverflowRate: 0.10,
      otherOverflowRate: 0.50,
      crystalRate: 1,
      // Un cycle suit la limite commune. +85 % de la base sur un cycle normal.
      curve: { profile: 'exp', intensity: 2.5, gainPercent: 85, residualPercent: 0.05 },
      // Surcharges indépendantes possibles : ex. strength: { intensity: 3 }.
      curves: { strength: {}, vigueur: {}, intelligence: {}, esprit: {}, agility: {}, finesse: {}, constitution: {}, integrite: {}, adresse: {}, vision: {}, criticalPower: {}, resilience: {}, equilibre: {}, vivacite: {}, robustness: {}, astrality: {} },
    };
  // Conversions physique et magique indépendantes de la limite d'acquisition.
  const resistanceCurve = { constant: 150, physicalConstant: 70, magicalConstant: 70, maxPercent: 100 };
  const dodgeCurve = { constant: 98, maxPercent: 99 };
  // Direct passive percentage: the first Vision point grants 1%; Agility
  // accelerates the remaining progression without moving that first point.
  const bullsEyeCurve = { constant: 98, maxPercent: 99, firstPointPercent: 1, agilityInfluence: 1 };
  const precisionCurve = { firstPointPercent: 5, minPercent: 5, maxPercent: 80, growthK: 0.025, decimals: 1 };
  const vision = { bullsEyeCurve };
  const critical = {
    chanceCurve: { constant: 98, maxPercent: 99, ratios: { source: 1, attribute: 0.5 } },
    damage: { nativeBasePercent: 50, sourceRatio: 1 },
  };
  // The three resistances share the same curve and base ratios; only their
  // supporting attribute differs. Exclusive cancellation has its own ratio.
  const resilienceCurve = { constant: 98, maxPercent: 99 };
  const resilience = {
    criticalResistance: { ...resilienceCurve, attribute: 'strength', ratios: { source: 1, attribute: 0.5 } },
    alterationResistance: { ...resilienceCurve, attribute: 'intelligence', ratios: { source: 1, attribute: 0.5 } },
    hindranceResistance: { ...resilienceCurve, attribute: 'agility', ratios: { source: 1, attribute: 0.5 } },
    // Exclusive cancellation has its own spread and requires Resilience.
    resilienceTotal: { ...resilienceCurve, constant: 25, attribute: 'strength', sourceRatio: 0.25, attributeInfluence: 1 },
  };
  const equilibre = {
    equilibreAggroReduction: { constant: 98, maxPercent: 60, attribute: 'intelligence', ratios: { source: 1, attribute: 0.5 } },
    equilibreInvisibleDetection: { constant: 98, maxPercent: 99, attribute: 'agility', ratios: { source: 1, attribute: 0.5 } },
    equilibreBalancedAttackChance: { constant: 25, maxPercent: 40, attribute: 'intelligence', sourceRatio: 0.25, attributeInfluence: 1 },
  };
  const vivacite = {
    velocity: { target: 'velocity', attribute: 'agility', decimals: 6, ratioPercent: true,
      constant: 98, maxPercent: 65, ratios: { source: 1, attribute: 0.5 } },
    controlledSpeed: { constant: 25, maxPercent: 99, attribute: 'agility', sourceRatio: 0.25, attributeInfluence: 1 },
    retreat: { basePercent: 50, maxPercent: 100 },
    movementRecoilPercent: 20,
  };
  // Réglages d’Astralité, partagés par le combat, les helpers et index-14.
  // Les bases multiplient les courbes propres d’Astralité et de l’attribut.
  const astrality = {
    fatalSurvival: { maxPercent: 99, firstPointPercent: 1, ratios: { source: 1, attribute: 0.5 } },
    // Même délai pour toutes les sources de Survie fatale. Seule l’Umbra
    // permet à l’Agilité de le réduire ; aucun délai supplémentaire après le soin.
    astralCooldown: { baseSeconds: 5, minSeconds: 2, constant: 98, attributeRatio: 0.5 },
    // La Force seule augmente le budget. Il est versé pendant le cooldown astral.
    astralReturn: { basePercent: 10, maxPercent: 100, constant: 98,
      ratios: { attribute: 0.5 },
      // HP distribués par versement, selon le budget total de soin.
      ticks: [{ from: 0, amount: 1 }, { from: 100, amount: 2 }, { from: 300, amount: 3 }] },
    // Jet seulement à l’état inactif ; l’attente repart à la fin de l’effet.
    astralBody: { maxPercent: 25, firstPointPercent: 1, ratios: { source: 1, attribute: 0.5 },
      checkSeconds: 3, baseDurationSeconds: 3, opacity: 0.5 },
  };
  // Calibrate the first source point with no attribute to exactly 1%, even
  // when the shared curve is edited. Autonomous + keeps its fixed base.
  function astralityChanceDetails(points, intelligence = 0, normal = 0, plus = 0, settings = astrality.fatalSurvival) {
    const firstWeight = settings.ratios.source * getProgressiveRatio(1, 'astrality');
    const constant = firstWeight * (settings.maxPercent / Math.max(Number.EPSILON, settings.firstPointPercent) - 1);
    return ratioPercentDetails('astrality', 'intelligence', points, intelligence, normal, plus, { ...settings, constant });
  }
  function astralCooldownDetails(points, agility = 0, settings = astrality.astralCooldown) {
    points = Math.max(0, capacity(points)); agility = Math.max(0, capacity(agility));
    const attributeRatio = settings.attributeRatio * getProgressiveRatio(agility, 'agility');
    const weight = points > 0 ? Math.min(Number.MAX_VALUE, agility * attributeRatio) : 0;
    const progress = weight > 0 ? 1 / (1 + settings.constant / weight) : 0;
    const seconds = settings.baseSeconds - (settings.baseSeconds - settings.minSeconds) * progress;
    return { points, agility, attributeRatio, weight, progress, seconds,
      baseSeconds: settings.baseSeconds, minSeconds: settings.minSeconds, constant: settings.constant };
  }
  function astralReturnDetails(points, strength = 0, maxHP = 0, agility = 0, settings = astrality.astralReturn) {
    points = Math.max(0, capacity(points)); strength = Math.max(0, capacity(strength));
    const attributeRatio = settings.ratios.attribute * getProgressiveRatio(strength, 'strength');
    const attributeWeight = strength * attributeRatio;
    const weight = Math.min(Number.MAX_VALUE, attributeWeight);
    const progress = weight > 0 ? 1 / (1 + settings.constant / weight) : 0;
    const percent = points > 0 ? settings.basePercent + (settings.maxPercent - settings.basePercent) * progress : 0;
    const cooldown = astralCooldownDetails(points, agility);
    const seconds = points > 0 ? cooldown.seconds : 0;
    const amount = Math.max(0, Math.round(Math.max(0, capacity(maxHP)) * percent / 100));
    const tickAmount = [...settings.ticks].reverse().find(tier => amount >= tier.from)?.amount || 1;
    return { points, strength, attributeRatio, attributeWeight, weight, cooldown,
      progress, percent, seconds, amount, tickAmount, maxHP: Math.max(0, capacity(maxHP)),
      maxPercent: settings.maxPercent, basePercent: settings.basePercent, constant: settings.constant };
  }
  function astralBodyDetails(points, intelligence = 0, settings = astrality.astralBody) {
    const chance = astralityChanceDetails(points, intelligence, 0, 0, settings);
    const ratio = getProgressiveRatio(points, 'astrality');
    return { ...chance, value: points > 0 ? chance.value : 0, ratio,
      seconds: points > 0 ? settings.baseDurationSeconds * ratio : 0, checkSeconds: settings.checkSeconds };
  }
  function vivaciteDetails(key, points, agility = 0, normal = 0, plus = 0, settings = vivacite[key]) {
    return ratioPercentDetails('vivacite', settings.attribute, points, agility, normal, plus, settings);
  }
  function controlledSpeedDetails(points, agility = 0, settings = vivacite.controlledSpeed) {
    return exclusivePercentDetails('vivacite', points, agility, settings);
  }
  function retreatChance(velocity) {
    return Math.max(0, Math.min(vivacite.retreat.maxPercent, vivacite.retreat.basePercent + capacity(velocity)));
  }
  function velocityTiming(velocity, baseSpeed) {
    const s = Math.max(0, Math.round(capacity(baseSpeed)));
    const percentage = Math.max(0, Math.min(vivacite.velocity.maxPercent, capacity(velocity)));
    const adjustedSpeed = s > 0 ? Math.max(1, Math.round(s * (1 - percentage / 100))) : 0;
    return { adjustedSpeed, speedReduction: Math.max(0, s - adjustedSpeed), reductionRatio: percentage / 100, percentage, seconds: adjustedSpeed / 1000 };
  }
  // Direct percentages. Normal gains have no ratio; + unlocks the fixed
  // Agility base, X uses both progressive curves, just like Vision.
  // Ratio gains approach the asymptote. Autonomous % gains are then pooled
  // directly, as for Bull's Eye, with a single final cap.
  function criticalChanceDetails(power, agility = 0, normal = 0, plus = 0, settings = critical.chanceCurve) {
    return ratioPercentDetails('criticalPower', 'agility', power, agility, normal, plus, settings);
  }
  function resilienceDetails(key, points, attribute = 0, normal = 0, plus = 0, settings = resilience[key]) {
    return ratioPercentDetails('resilience', settings.attribute, points, attribute, normal, plus, settings);
  }
  function resilienceCancelDetails(points, strength = 0, settings = resilience.resilienceTotal) {
    return exclusivePercentDetails('resilience', points, strength, settings);
  }
  function equilibreDetails(key, points, attribute = 0, normal = 0, plus = 0, settings = equilibre[key]) {
    return ratioPercentDetails('equilibre', settings.attribute, points, attribute, normal, plus, settings);
  }
  function balancedAttackDetails(points, intelligence = 0, settings = equilibre.equilibreBalancedAttackChance) {
    return exclusivePercentDetails('equilibre', points, intelligence, settings);
  }
  function exclusivePercentDetails(origin, points, attributePoints, settings) {
    points = Math.max(0, capacity(points));
    attributePoints = Math.max(0, capacity(attributePoints));
    const max = Math.max(0, Math.min(100, Number(settings.maxPercent)));
    const constant = Math.max(Number.EPSILON, Number(settings.constant) || resilienceCurve.constant);
    const curveRatio = 1 + (getProgressiveRatio(attributePoints, settings.attribute) - 1) * settings.attributeInfluence;
    const weight = Math.min(Number.MAX_VALUE, points * (settings.sourceRatio * curveRatio));
    const percent = weight > 0 ? Math.min(max - Number.EPSILON * max, max / (1 + constant / weight)) : 0;
    // The displayed product really equals the granted percentage.
    return { origin, points, attribute: settings.attribute, attributePoints, influence: settings.attributeInfluence, ratio: points > 0 ? percent / points : 0, curveRatio, max, constant, percent };
  }
  function ratioPercentDetails(origin, attributeKey, sourcePoints, attributePoints, normal, plus, settings) {
    const points = Math.max(0, capacity(sourcePoints)), attribute = Math.max(0, capacity(attributePoints));
    const max = Math.max(0, Math.min(100, Number(settings.maxPercent)));
    const constant = Math.max(Number.EPSILON, Number(settings.constant) || 98);
    const sourceRatio = settings.ratios.source * getProgressiveRatio(points, origin);
    const attributeRatio = settings.ratios.attribute * (points > 0 ? getProgressiveRatio(attribute, attributeKey) : 1);
    const sourceWeight = Math.min(Number.MAX_VALUE, points * sourceRatio);
    const attributeWeight = points > 0 || plus > 0 ? Math.min(Number.MAX_VALUE, attribute * attributeRatio) : 0;
    const weight = Math.min(Number.MAX_VALUE, sourceWeight + attributeWeight);
    const generated = weight > 0 ? Math.max(0, Math.min(max - Number.EPSILON * max, max / (1 + constant / weight))) : 0;
    const scale = Math.max(1, sourceWeight, attributeWeight);
    const share = weight > 0 ? (sourceWeight / scale) / (sourceWeight / scale + attributeWeight / scale) : 0;
    const part = (stat, count, value) => ({ stat, value, unit: ' %', rounded: false, rounding: 'nearest',
      compact: { source: { stat, value: count }, multiplier: { stat, value: count > 0 ? value / count : 0 } } });
    const source = part(origin, points, Math.max(0, generated) * share);
    const attributePart = part(attributeKey, attribute, Math.max(0, generated) - source.value);
    const fixed = Math.max(0, Math.min(max, generated + capacity(normal)));
    const value = Math.max(0, Math.min(max, generated + capacity(normal) + capacity(plus)));
    const normalApplied = fixed - generated;
    return { value, generated, source, attribute: attributePart,
      normalApplied, plusApplied: value - generated - normalApplied, max, constant, sourceRatio, attributeRatio };
  }
  function criticalDamageDetails(power) {
    return progressivePowerPart('criticalPower', Math.max(0, capacity(power)), critical.damage.sourceRatio);
  }
  const sources = {
      vigueur: {
        target: "physicalDamage",
        attribute: "strength",
        decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true,
        flatPerPoint: 1,
      },
      esprit: {
        target: "magicalDamage",
        attribute: "intelligence",
        decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true,
        flatPerPoint: 1,
      },
      finesse: {
        target: "piercingDamage",
        attribute: "agility",
        decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true,
        flatPerPoint: 1,
      },
      robustness: {
        target: 'armor', attribute: 'strength', decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true, flatPerPoint: 1,
      },
      constitution: {
        target: "physicalResistance",
        attribute: "strength",
        decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true,
        flatPerPoint: 1,
        resistance: true,
      },
      integrite: {
        target: "magicalResistance",
        attribute: "intelligence",
        decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true,
        flatPerPoint: 1,
        resistance: true,
      },
      adresse: {
        target: 'dodge', attribute: 'agility', decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true, flatPerPoint: 1, dodge: true,
      },
      vision: {
        target: 'precision', attribute: 'agility', decimals: 0,
        ratios: { source: 1, attribute: 0.5 },
        progressive: true, flatPerPoint: 1, precision: true,
      },
  };
  function capacity(value) { return Number(value?.max ?? value?.current ?? value) || 0; }
  function round(value) { const n = Math.round(value * 1e6) / 1e6; return Object.is(n, -0) ? 0 : n; }
  function getResistanceConstant(stat) {
    return stat === 'magicalResistance' ? resistanceCurve.magicalConstant : resistanceCurve.physicalConstant;
  }
  function dodgeChancePercent(points) {
    const amount = Math.max(0, capacity(points));
    const max = Math.min(99, Math.max(0, dodgeCurve.maxPercent));
    const k = Math.max(Number.EPSILON, Number(dodgeCurve.constant) || 98);
    // Avoid overflow and never let floating-point rounding reach the asymptote.
    return amount > 0 ? Math.min(max - Number.EPSILON * max, max / (1 + k / amount)) : 0;
  }
  function resistanceReductionRatio(points, constant = resistanceCurve.physicalConstant) {
    const amount = Math.max(0, capacity(points));
    const k = Math.max(Number.EPSILON, Number(constant) || resistanceCurve.physicalConstant);
    return amount / (amount + k) * Math.max(0, Math.min(100, resistanceCurve.maxPercent)) / 100;
  }
  function bullsEyeDetails(visionPoints, agilityPoints = 0, settings = bullsEyeCurve) {
    const points = Math.max(0, capacity(visionPoints)), agility = Math.max(0, capacity(agilityPoints));
    const max = Math.min(100, Math.max(0, Number(settings.maxPercent)));
    const first = Math.min(max, Math.max(0, Number(settings.firstPointPercent ?? 1)));
    const constant = Math.max(Number.EPSILON, Number(settings.constant) || 98);
    const influence = Math.max(0, Number(settings.agilityInfluence ?? 1));
    const ratio = 1 + (getProgressiveRatio(agility, 'agility') - 1) * influence;
    const percent = points <= 1 ? points * first
      : Math.min(max - Number.EPSILON * max, first + (max - first) / (1 + constant / (points - 1) / ratio));
    return { points, agility, ratio, constant, max, first, influence, percent };
  }
  function bullsEyePercent(visionPoints, agilityPoints = 0, settings = bullsEyeCurve) {
    return bullsEyeDetails(visionPoints, agilityPoints, settings).percent;
  }
  function bullsEyeVision(percent, agilityPoints = 0, settings = bullsEyeCurve) {
    const { max, first, constant, ratio } = bullsEyeDetails(0, agilityPoints, settings);
    if (!Number.isFinite(percent) || percent < 0 || percent > max) return NaN;
    if (percent === max) return Infinity;
    if (percent <= first) return first ? percent / first : 0;
    return 1 + constant * ((percent - first) / (max - percent)) / ratio;
  }
  function bullsEyeTotal(generated, normal = 0, plus = 0) {
    const max = bullsEyeCurve.maxPercent;
    const fixed = Math.max(0, Math.min(max, generated + normal));
    const total = Math.max(0, Math.min(max, generated + normal + plus));
    return { total, generated, normal: fixed - generated, plus: total - fixed };
  }
  function precisionPercent(points) {
    if (points <= 0) return 0;
    if (points === 1) return precisionCurve.firstPointPercent;
    const { minPercent: min, maxPercent: max, growthK: k, decimals } = precisionCurve;
    return Math.min(Number((min + (max - min) * (1 - Math.exp(-k * (points - 1)))).toFixed(decimals)), max);
  }
  function getProgressiveStatKeys() {
    return [...new Set(Object.entries(sources)
      .filter(([, cfg]) => cfg.progressive).flatMap(([source, cfg]) => [source, cfg.attribute]))];
  }
  function calculateProgressivePower(source, attribute, cfg, origin) {
    const sourcePart = progressivePowerPart(origin, source, cfg.ratios.source);
    const attributePart = progressivePowerPart(cfg.attribute, attribute, cfg.ratios.attribute, source > 0);
    return round(sourcePart.value + attributePart.value + source * cfg.flatPerPoint);
  }
  function calculateStatPointLimit(natural, other = 0, crystal = 0, threshold = progression.limit) {
    const cfg = progression, limit = Math.max(0, capacity(threshold));
    const retain = (start, gain, rate) => gain <= 0 ? gain
      : Math.min(gain, Math.max(0, limit - start)) + Math.max(0, gain - Math.max(0, limit - start)) * rate;
    // Recompute from permanent natural points, then apply the pooled external
    // bonuses to the remaining room. No acquisition order is saved.
    // A malus first frees room under the threshold; it is never discounted.
    const negative = Math.min(0, capacity(other));
    const naturalApplied = retain(0, capacity(natural) + negative, cfg.levelOverflowRate) - negative;
    const otherApplied = negative + retain(naturalApplied + negative, Math.max(0, capacity(other)), cfg.otherOverflowRate);
    // Crystals are permanent full-strength gains, added after the limited sources.
    const crystalApplied = Math.max(0, capacity(crystal)) * cfg.crystalRate;
    return { limit, natural: capacity(natural), other: capacity(other), naturalApplied, otherApplied,
      crystal: capacity(crystal), crystalApplied,
      value: round(naturalApplied + otherApplied + crystalApplied), raw: round(capacity(natural) + capacity(other) + capacity(crystal)),
      levelRate: cfg.levelOverflowRate, otherRate: cfg.otherOverflowRate, crystalRate: cfg.crystalRate };
  }
  function getProgressiveRatio(points, stat) {
    const cfg = progression;
    const curve = { ...cfg.curve, ...cfg.curves[stat] };
    const width = Math.max(1, capacity(cfg.limit)), k = Math.max(.001, capacity(curve.intensity));
    const x = Math.max(0, capacity(points)), limit = Math.max(0, capacity(cfg.limit));
    const gain = n => {
      const cycles = Math.floor(n / width), t = (n - cycles * width) / width;
      const normalized = curve.profile === 'j' ? Math.expm1(k * t) / Math.expm1(k)
        : -Math.expm1(-k * t) / -Math.expm1(-k);
      return (cycles + normalized) * curve.gainPercent / 100;
    };
    const normal = gain(Math.min(x, limit));
    return 1 + normal + (gain(x) - normal) * curve.residualPercent / 100;
  }
  function progressivePowerPart(stat, points, base, enabled = true) {
    const limit = progression.limit, x = Math.max(0, points);
    const normalPoints = Math.min(x, limit), multiplier = enabled ? getProgressiveRatio(x, stat) : 1;
    const normalMultiplier = enabled ? getProgressiveRatio(normalPoints, stat) : 1;
    const coefficient = base * multiplier, normalCoefficient = base * normalMultiplier;
    const raw = x * coefficient, normalRaw = normalPoints * normalCoefficient;
    const epsilon = Number.EPSILON * Math.max(1, normalRaw) * 4;
    const normalValue = Math.round(normalRaw + epsilon);
    const extra = Math.max(0, raw - normalRaw), value = round(normalValue + extra);
    const ratioNote = `Base ${base} × courbe ${multiplier} ; ${x} points propres. ${enabled ? 'Ratio progressif.' : 'Ratio autonome fixe.'}`;
    return { stat, value, base, points: x, multiplier, coefficient, raw, normalPoints, normalRaw, normalValue, extra,
      rounded: true, rounding: 'nearest',
      note: ratioNote + ' Arrondi au plus proche.' + (x > limit ? ' Supplément au-delà de la limite conservé sans arrondi entier.' : ''),
      ...(x > limit ? { arithmetic: { terms: [{ stat, value: normalValue }, '+', { stat, value: extra }, '→', { stat, value }] } }
        : { compact: { source: { stat, value: x }, multiplier: { stat, value: base * multiplier } } }) };
  }
  globalThis.umbraProgression = Object.freeze({ progression, sources, resistanceCurve, getResistanceConstant, resistanceReductionRatio, dodgeCurve, dodgeChancePercent, bullsEyeCurve, bullsEyeDetails, bullsEyePercent, bullsEyeVision, bullsEyeTotal, precisionCurve, precisionPercent, vision, resilience, resilienceDetails, resilienceCancelDetails, critical, criticalChanceDetails, criticalDamageDetails,
    astrality, astralityChanceDetails, astralCooldownDetails, astralReturnDetails, astralBodyDetails,
    vivacite, vivaciteDetails, controlledSpeedDetails, retreatChance, velocityTiming,
    equilibre, equilibreDetails, balancedAttackDetails, defaultUmbraThreshold, getUmbraThreshold,
    getProgressiveStatKeys, calculateProgressivePower, calculateStatPointLimit,
    getProgressiveRatio, progressivePowerPart });
})();
