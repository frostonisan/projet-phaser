import { animationProjectile, animationMelee, getMeleeFlightVisual, prepareCombatRenderer, animationPhaserMelee, isPhaserMeleeAttack } from "./animations.js";
import { normArr, getAttackResolutionFlags } from "../combat/attackResolution.js";
import { attackEffects } from '../data/attackEffects.js';

export function prepareAttackTransport(attack) {
  if (getAttackResolutionFlags(attack).isRange || isPhaserMeleeAttack(attack)) prepareCombatRenderer(getProjectileEffectClasses(attack));
}

function getProjectileEffectClasses(attack = {}) {
  return normArr(attack?.effets)
    .map(effectName => attackEffects.find(effect => effect.effectName === effectName)?.effectProjectile)
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value || "").trim())
    .filter(value => value && value !== "none");
}

// The combat scheduler supplies the impact promise. Rendering only observes it.
export async function presentAttackTransport(flight, impact, { duration, isRange, options, restored }) {
  const { attacker, target, attack } = flight;
  if (isRange) {
    const effectClasses = getProjectileEffectClasses(attack);
    // The visual follows the scheduled impact, never the other way round.
    void animationProjectile(attacker, target, () => impact, {
      id: flight.id, attackId: attack.attackId, attacknature: attack.attacknature,
      executionTime: duration, effectProjectileClasses: effectClasses,
      isLaunchedUnderMysticism: Boolean(attack.isLaunchedUnderMysticism),
      aura: options.secondHit ? 'ambidextry' : undefined,
      flight, impactPromise: impact, restoredVisual: restored?.visual,
    }).catch(error => console.error('[ProjectileVisual]', error));
    return impact;
  }
  const controller = (restored && getMeleeFlightVisual(flight.id))
    || (isPhaserMeleeAttack(attack) && !options.secondHit
      ? animationPhaserMelee(attacker, target, { duration, flightId: flight.id, flight })
      : animationMelee(attacker, target, Boolean(options.secondHit), { duration, flightId: flight.id }));
  controller?.bindFlight?.(flight);
  const status = await impact;
  // Display completion must not delay the next gameplay phase.
  void controller?.resolveImpact?.(status === 'hit');
  return status;
}
