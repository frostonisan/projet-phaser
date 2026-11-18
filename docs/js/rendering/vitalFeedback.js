// Presentation of resolved vital outcomes; never changes HP, armor, scores or persistence.
import { PopUpDamages, updateTotalHealCounter } from "./hud.js";
import { updateHealthBar, updateHPCounters } from "../entities/progression.js";
import { showHealingFeedback } from "../combat/effects.js";
import { damageImpact, damageArmorImpact, shakeImpact, brokenMagicImpact, applyEntityTint, releaseEntityTint } from "./animations.js";
import { syncEntityAuras } from "./auras.js";
import { setTimeout } from "../combat/clock.js";

export function presentEntityVitals(entity) {
  updateHealthBar(entity.stats.HP.current, entity.stats.HP.max,
    entity.stats.armor?.current || 0, entity.stats.armor?.max || 0, entity.id);
}

export function presentSupportHealing(attacker, target, healedHP) {
  updateTotalHealCounter(attacker.id, attacker.totalHeal);
  presentEntityVitals(target);
  if (healedHP > 0) showHealingFeedback(target, healedHP);
}

export function presentDamageOutcome(target, { hpDamage, armorDamage, effects, content,
  sources = {}, popupType = '', nature, execution = false, critical = false }) {
  const finalPopupType = execution ? (critical ? 'execution-critical' : 'execution') : popupType;
  PopUpDamages(target, hpDamage, effects, content, sources, finalPopupType, armorDamage, nature);
}

export function presentExecutionHealing(attacker, healedHP) {
  presentEntityVitals(attacker);
  updateHPCounters(attacker.id, attacker.stats.HP.current, attacker.stats.HP.max);
  if (healedHP > 0) PopUpDamages(attacker, healedHP, 'blood-glutony', null, {}, 'blood-glutony');
}

export function presentVitalImpact(target, { broken, armored }) {
  if (broken) {
    brokenMagicImpact(target.id);
  } else if (armored) {
    damageArmorImpact(target.id);
  } else {
    damageImpact(target.id);
  }

  if (broken) {
    brokenMagicImpact(target.id);
  }

  shakeImpact(target.id);
}

export function presentBloodCrazyGain(attacker) {
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

export function presentBloodCrazyConsumption(attacker) {
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

export function presentVitalSummary({ attacker, target, totalDamageSourcesReduced,
  absorbedByArmor, damageCredited, purePiercingArmorBypass, damageApplied }) {
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
}

export function presentDamageResolution(ctx) {
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
  console.groupEnd();
}
