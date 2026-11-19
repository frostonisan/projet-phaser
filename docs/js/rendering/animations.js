import { applyMovementDestabilisation, wakeFromMovement } from "../combat/effects.js";
import {
  setIntervalFrom, remainingCombatTimer, registerCombatState, removeCombatVisualAfter, setTimeout,
  clearTimeout, setInterval, clearInterval, requestAnimationFrame, cancelAnimationFrame, clockNow, isCombatPaused, combatReference, combatTarget,
} from "../combat/clock.js";
import { playCachedGif as playGif, cachedResourceUrl, loadSpriteAtlas, PROJECTILE_ASSETS } from "../data/loaderList.js";
import { QuitCurrentLevel } from "../app/stages.js";
import { getSafe, getBattleEntityDomPrefix, getBattleEntityElement } from "../entities/rules.js";
import { getAttackResolutionFlags } from "../combat/attackResolution.js";
import { buildStatGraphHelper } from "../data/helpers.js";

const playCachedGif = (image, source) => playGif(image, source, { shared: true });
const originalImages = new WeakMap();
const meleeTextures = new WeakMap();
let meleeTextureSequence = 0;
function acquireMeleeTexture(scene, canvas) {
  let texture = meleeTextures.get(canvas);
  if (!texture || texture.scene !== scene || !scene.textures.exists(texture.key)) {
    texture = { key: `melee:shared-${++meleeTextureSequence}`, scene, canvas, users: 0 };
    scene.textures.addImage(texture.key, canvas);
    meleeTextures.set(canvas, texture);
  }
  texture.users++;
  return texture;
}
function releaseMeleeTexture(texture) {
  if (!texture || --texture.users > 0) return;
  texture.scene.textures.remove(texture.key);
  if (meleeTextures.get(texture.canvas) === texture) meleeTextures.delete(texture.canvas);
}
const canvasRuns = new Map();
let canvasRunSequence = 0;
function beginCanvasRun(name, entityId, options, saved) {
  const record = { key: saved?.key || ++canvasRunSequence, name, entityId, options,
    nextAt: saved?.nextAt, capture: null };
  canvasRunSequence = Math.max(canvasRunSequence, record.key);
  canvasRuns.set(record.key, record); return record;
}
function finishCanvasRun(record) { canvasRuns.delete(record.key); }
const targetSearchPulseTimers = new Map();

function getTargetSearchIndicator(entite) {
  const container = document.getElementById(`effectsContainer_${entite?.id}`);
  if (!container || !entite?.id) return null;

  let indicator = document.getElementById(`targetSearchIndicator_${entite.id}`);
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = `targetSearchIndicator_${entite.id}`;
    indicator.className = 'target-search-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    container.appendChild(indicator);
  }
  return indicator;
}

export function setTargetSearchVisual(entite, state = 'clear') {
  const box = document.getElementById(`Box_Entite_${entite?.id}`);
  box?.classList.toggle('entity-target-searching', state === 'searching');
  box?.classList.toggle('entity-target-search-failed', state === 'failed');
  box?.classList.toggle('entity-cooldown-waiting', state === 'cooldown');

  if (state === 'clear') {
    const id = String(entite?.id ?? '');
    for (const prefix of ['atbFill_', 'HUATBfill_', 'scanATBFill_']) {
      document.getElementById(prefix + id)?.classList.remove('cooldown-wait-pulse');
    }
    document.getElementById(`targetSearchIndicator_${entite?.id}`)?.remove();
    return;
  }

  const indicator = getTargetSearchIndicator(entite);
  if (!indicator) return;
  indicator.className = `target-search-indicator target-search-indicator--${state}`;
}

export function pulseTargetSearchAtb(entite, mode = 'search') {
  const id = String(entite?.id ?? '');
  if (!id) return;
  clearTimeout(targetSearchPulseTimers.get(id));

  const bars = [
    document.getElementById(`atbFill_${id}`),
    document.getElementById(`HUATBfill_${id}`),
    document.getElementById(`scanATBFill_${id}`),
  ].filter(Boolean);

  const className = mode === 'cooldown' ? 'cooldown-wait-pulse' : 'target-search-pulse';
  const restarting = bars.some(bar => bar.classList.contains(className));
  bars.forEach(bar => bar.classList.remove('target-search-pulse', 'cooldown-wait-pulse'));
  // A new/different animation starts naturally; flush only to restart the same one.
  if (restarting) void bars[0].offsetWidth;
  bars.forEach(bar => bar.classList.add(className));

  targetSearchPulseTimers.set(id, setTimeout(() => {
    bars.forEach(bar => bar.classList.remove('target-search-pulse', 'cooldown-wait-pulse'));
    targetSearchPulseTimers.delete(id);
  }, 460));
}

const ENTITY_TINTS = {
	
  indestructibility: {
    color: "255, 120, 0",
    priority: 98,
  },
movementImpossible: {
  color: "255, 0, 0",
  priority: 97,
},
  brokenMagicImpact: {
    color: "162, 0, 255",
    priority: 92,
  },
    mysticismBoostedAttack: {
    color: "210, 245, 255",
    priority: 91,
  },
  damageImpact: {
    color: "255, 0, 0",
    priority: 90,
  },

  armorImpact: {
    color: "79, 112, 179",
    priority: 80,
  },
bloodCrazy: {
  color: "20, 0, 0",
  priority: 79,
},
  ambidextry: {
    color: "237, 255, 0",
    priority: 70,
  },

  astrality: {
    color: "192, 212, 255",
    priority: 65,
  },

  esoterism: {
    color: "255, 184, 227",
    priority: 60,
  },

  mysticism: {
    color: "79, 112, 179",
    priority: 55,
  },
occultism: {
    color: "120, 120, 120",
    priority: 54,
  },
armorActive: {
    color: "70, 165, 225",
    priority: 51,
  },
  order: {
    color: "255, 255, 255",
    priority: 50,
  },
};

const activeEntityTints = new WeakMap();
const activeSnapshotDamageImpacts = new WeakMap();
const damageImpacts = new WeakMap();
const impactPoses = new WeakMap();
const impactShakes = new WeakMap();
const brokenMagicImpacts = new WeakMap();

// Concurrent hit effects share the pose from BEFORE the first hit. A later hit
// must never save another shake's temporary rotation as its resting position.
function acquireImpactPose(node, saved = {}) {
    if (!node) return null;
    let pose = impactPoses.get(node);
    if (!pose) {
        pose = {
            previousTransform: saved.previousTransform ?? node.style.transform,
            previousTop: saved.previousTop ?? node.style.top,
            previousTransition: saved.previousTransition ?? node.style.transition,
            previousWillChange: saved.previousWillChange ?? node.style.willChange,
            users: 0,
        };
        impactPoses.set(node, pose);
    }
    pose.users++;
    return pose;
}

function releaseImpactPose(node, pose) {
    if (!pose || impactPoses.get(node) !== pose || --pose.users > 0) return;
    node.style.transform = pose.previousTransform;
    node.style.top = pose.previousTop;
    node.style.transition = pose.previousTransition;
    node.style.willChange = pose.previousWillChange;
    impactPoses.delete(node);
}

function trackImpactVibration(node, animation) {
    node._damageImpactVibration = animation;
    const release = () => {
        if (node._damageImpactVibration === animation) node._damageImpactVibration = null;
    };
    animation.addEventListener('finish', release, { once: true });
    animation.addEventListener('cancel', release, { once: true });
    return animation;
}
const activeMeleeAnimations = new Map();
const meleeOriginalVisibilityLocks = new Map();
const meleeOriginalRecoveryAnimations = new Map();
const meleePostRecoveryOpacityLocks = new WeakMap();
const MELEE_ORIGINAL_RECOVERY_DURATION = 750;

// Courbes position/temps dérivées de vitesses continues. La deuxième colonne
// garde un freinage léger sur les trajets compacts ; la troisième accentue le
// freinage étalé autour du milieu des longues courses. Toutes deux repartent
// progressivement puis accélèrent franchement devant la cible.
const MELEE_CHARGE_MOTION_SAMPLES = Object.freeze([
  [0, 0, 0],
  [0.05, 0.023797, 0.017481],
  [0.1, 0.060922, 0.058322],
  [0.14, 0.099669, 0.102149],
  [0.18, 0.140731, 0.15005],
  [0.22, 0.184792, 0.205236],
  [0.26, 0.232496, 0.266422],
  [0.3, 0.281972, 0.328192],
  [0.35, 0.342381, 0.399708],
  [0.4, 0.398548, 0.460376],
  [0.45, 0.448985, 0.50814],
  [0.5, 0.493558, 0.543882],
  [0.58, 0.556219, 0.58666],
  [0.64, 0.602674, 0.620625],
  [0.7, 0.654361, 0.662176],
  [0.76, 0.710258, 0.708024],
  [0.82, 0.770339, 0.76094],
  [0.86, 0.814521, 0.800643],
  [0.9, 0.860582, 0.84338],
  [0.94, 0.910952, 0.896916],
  [0.97, 0.953829, 0.945895],
  [1, 1, 1],
]);

function interpolateMeleeMotionValue(offset, stops) {
  if (!stops.length || offset <= stops[0][0]) return stops[0]?.[1] ?? 0;

  for (let index = 1; index < stops.length; index += 1) {
    const [nextOffset, nextValue] = stops[index];
    if (offset > nextOffset) continue;

    const [previousOffset, previousValue] = stops[index - 1];
    const span = nextOffset - previousOffset;
    const ratio = span > 0 ? (offset - previousOffset) / span : 1;
    return previousValue + (nextValue - previousValue) * ratio;
  }

  return stops[stops.length - 1][1];
}

const DEFAULT_SPEED_TRAIL_FILAMENTS = Object.freeze([
  { top: "14%", right: "3%", width: "74%", height: "1px", opacity: "0.72" },
  { top: "48%", right: "0", width: "100%", height: "2px", opacity: "0.95" },
  { top: "78%", right: "9%", width: "61%", height: "1px", opacity: "0.58" },
]);

function configureSpeedTrail(trail, options = {}) {
  const {
    className = "melee-motion-trail",
    style = {},
    filamentSpecs = DEFAULT_SPEED_TRAIL_FILAMENTS,
  } = options;

  trail.className = className;
  trail.setAttribute("aria-hidden", "true");
  Object.assign(trail.style, {
    position: "absolute",
    zIndex: "9998",
    pointerEvents: "none",
    borderRadius: "50% 20% 20% 50%",
    background: "linear-gradient(90deg, rgba(255, 245, 190, 0) 0%, rgba(255, 240, 175, 0.12) 34%, rgba(255, 246, 205, 0.52) 78%, rgba(255, 255, 235, 0.78) 100%)",
    transformOrigin: "right center",
    overflow: "visible",
    opacity: "0",
    willChange: "transform, opacity",
    ...style,
  });

  if (!trail._filaments) {
    trail._filaments = filamentSpecs.map(spec => {
      const filament = document.createElement("i");
      Object.assign(filament.style, {
        position: "absolute",
        display: "block",
        top: spec.top,
        right: spec.right,
        width: spec.width,
        height: spec.height,
        borderRadius: "999px",
        background: "linear-gradient(90deg, rgba(255, 240, 170, 0) 0%, rgba(255, 244, 195, 0.54) 68%, rgba(255, 255, 238, 1) 100%)",
        opacity: spec.opacity,
        pointerEvents: "none",
      });
      trail.appendChild(filament);
      return filament;
    });
  }

  return trail;
}

export function createSpeedTrail(parent = null, options = {}) {
  const trail = configureSpeedTrail(document.createElement("div"), options);

  if (parent?.appendChild) {
    parent.appendChild(trail);
  }

  return trail;
}

function registerActiveMeleeAnimation(attackerId, controller) {
  const key = String(attackerId);
  let controllers = activeMeleeAnimations.get(key);
  if (!controllers) {
    controllers = new Set();
    activeMeleeAnimations.set(key, controllers);
  }
  controllers.add(controller);
}

function unregisterActiveMeleeAnimation(attackerId, controller) {
  const key = String(attackerId);
  const controllers = activeMeleeAnimations.get(key);
  if (!controllers) return;

  controllers.delete(controller);
  if (controllers.size === 0) activeMeleeAnimations.delete(key);
}

function cancelActiveMeleeAnimations(attackerId) {
  const controllers = activeMeleeAnimations.get(String(attackerId));
  if (!controllers) return;
  [...controllers].forEach(controller => controller?.cancel?.());
}

function lockMeleePostRecoveryOpacity(attackerId, sprite) {
  const key = String(attackerId);
  const currentSprite = document.getElementById(`DragSprite_${key}`)
    || sprite
    || null;
  if (!currentSprite?.isConnected) return false;

  if (!meleePostRecoveryOpacityLocks.has(currentSprite)) {
    meleePostRecoveryOpacityLocks.set(currentSprite, {
      value: currentSprite.style.getPropertyValue("opacity"),
      priority: currentSprite.style.getPropertyPriority("opacity"),
    });
  }

  // Important volontairement : les animations CSS de .iddle ne doivent plus
  // pouvoir reprendre opacity après le retour CAC 0 -> 1.
  currentSprite.style.setProperty("opacity", "1", "important");
  return true;
}

function unlockMeleePostRecoveryOpacity(attackerId, sprite) {
  const key = String(attackerId);
  const currentSprite = document.getElementById(`DragSprite_${key}`)
    || sprite
    || null;
  if (!currentSprite) return false;

  const previous = meleePostRecoveryOpacityLocks.get(currentSprite);
  if (!previous) return false;

  meleePostRecoveryOpacityLocks.delete(currentSprite);
  if (previous.value) {
    currentSprite.style.setProperty("opacity", previous.value, previous.priority || "");
  } else {
    currentSprite.style.removeProperty("opacity");
  }
  return true;
}

function cancelMeleeOriginalRecovery(attackerId, forceVisible = false) {
  const key = String(attackerId);
  const recovery = meleeOriginalRecoveryAnimations.get(key);

  if (recovery) {
    meleeOriginalRecoveryAnimations.delete(key);
    recovery.cancelled = true;
    if (recovery.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(recovery.rafId);
    }
    clearTimeout(recovery.timeoutId);
    recovery.deathObserver?.disconnect();

    const recoverySprite = document.getElementById(`DragSprite_${key}`)
      || recovery.sprite
      || null;
    if (recoverySprite?.isConnected) {
      if (recovery.previousTransition) {
        recoverySprite.style.setProperty(
          "transition",
          recovery.previousTransition,
          recovery.previousTransitionPriority || ""
        );
      } else {
        recoverySprite.style.removeProperty("transition");
      }
    }
  }

  if (forceVisible) {
    const currentSprite = document.getElementById(`DragSprite_${key}`)
      || recovery?.sprite
      || null;
    if (currentSprite?.isConnected) {
      // Pas de transition CSS parasite : la visibilité forcée est instantanée.
      currentSprite.style.setProperty("opacity", "1", "important");
    }
  }

  return Boolean(recovery);
}

function startMeleeOriginalRecovery(
  attackerId,
  sprite,
  duration = MELEE_ORIGINAL_RECOVERY_DURATION,
  saved = null
) {
  const key = String(attackerId);
  cancelMeleeOriginalRecovery(key);

  const initialSprite = document.getElementById(`DragSprite_${key}`)
    || sprite
    || null;
  if (!initialSprite?.isConnected) return false;

  const safeDuration = Math.max(
    1,
    Number(duration) || MELEE_ORIGINAL_RECOVERY_DURATION
  );

  // IMPORTANT : on n'utilise volontairement NI transition CSS NI WAAPI pour
  // l'opacité du retour CAC. Sinon, à la fin d'un fill/cancel, le CSS peut
  // reprendre la main et rejouer un second 0 -> 1.
  const previousTransition = initialSprite.style.getPropertyValue("transition");
  const previousTransitionPriority = initialSprite.style.getPropertyPriority("transition");
  initialSprite.style.setProperty("transition", "none", "important");
  if (!saved) initialSprite.style.setProperty("opacity", "0", "important");

  const recovery = {
    cancelled: false,
    deathObserver: null,
    rafId: 0,
    sprite: initialSprite,
    startTime: saved?.startTime ?? null, duration: safeDuration,
    timeoutId: null,
    previousTransition: saved?.previousTransition ?? previousTransition,
    previousTransitionPriority: saved?.previousTransitionPriority ?? previousTransitionPriority,
  };

  const getSprite = () => document.getElementById(`DragSprite_${key}`)
    || (initialSprite.isConnected ? initialSprite : null);

  const restoreTransition = (currentSprite) => {
    if (!currentSprite?.isConnected) return;
    if (recovery.previousTransition) {
      currentSprite.style.setProperty(
        "transition",
        recovery.previousTransition,
        recovery.previousTransitionPriority || ""
      );
    } else {
      currentSprite.style.removeProperty("transition");
    }
  };

  const finishRecovery = () => {
    if (recovery.cancelled) return;
    if (meleeOriginalRecoveryAnimations.get(key) !== recovery) return;

    meleeOriginalRecoveryAnimations.delete(key);
    recovery.cancelled = true;
    if (recovery.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(recovery.rafId);
      recovery.rafId = 0;
    }
    clearTimeout(recovery.timeoutId);
    recovery.deathObserver?.disconnect();

    const finalSprite = getSprite();
    if (finalSprite?.isConnected) {
      // L'ordre est volontaire : 1 est verrouillé AVANT de rendre les
      // transitions/classes au sprite. Il ne peut donc pas repartir vers 0.
      finalSprite.style.setProperty("opacity", "1", "important");
      lockMeleePostRecoveryOpacity(key, finalSprite);
      restoreTransition(finalSprite);
      addIddle(finalSprite);
    }
  };

  const step = (timestamp) => {
    if (recovery.cancelled) return;
    if (meleeOriginalRecoveryAnimations.get(key) !== recovery) return;

    if (recovery.startTime === null) recovery.startTime = timestamp;
    const progress = Math.min(1, (timestamp - recovery.startTime) / safeDuration);
    // ease-out cubic : retour doux, mais UNE SEULE montée 0 -> 1.
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentSprite = getSprite();

    if (currentSprite?.isConnected) {
      currentSprite.style.setProperty("transition", "none", "important");
      currentSprite.style.setProperty("opacity", eased.toFixed(4), "important");
    }

    if (progress >= 1) {
      finishRecovery();
      return;
    }

    recovery.rafId = requestAnimationFrame(step);
  };

  const attackerBox = document.getElementById(`Box_Entite_${key}`);
  if (attackerBox && typeof MutationObserver !== "undefined") {
    recovery.deathObserver = new MutationObserver(() => {
      if (attackerBox.dataset.dead !== "true") return;
      cancelMeleeOriginalRecovery(key, true);

      const deadSprite = document.getElementById(`DragSprite_${key}`);
      const deadCanvas = document.getElementById(`spriteCanvas_${key}`);
      for (const element of [deadSprite, deadCanvas]) {
        if (!element?.isConnected) continue;
        element.hidden = false;
        element.style.setProperty("opacity", "1", "important");
        element.style.visibility = "visible";
        if (element.style.display === "none") element.style.display = "";
      }
    });
    recovery.deathObserver.observe(attackerBox, {
      attributes: true,
      attributeFilter: ["data-dead"],
    });
  }

  meleeOriginalRecoveryAnimations.set(key, recovery);

  if (typeof requestAnimationFrame === "function") {
    recovery.rafId = requestAnimationFrame(step);
  } else {
    // Fallback ancien navigateur : pas de clignotement, retour direct à 1.
    initialSprite.style.setProperty("opacity", "1", "important");
    finishRecovery();
  }

  // Filet de sécurité uniquement : il termine le même cycle, il n'en démarre jamais un second.
  recovery.timeoutId = setTimeout(finishRecovery, Math.max(0, safeDuration + 120 - (saved?.startTime ? clockNow() - saved.startTime : 0)));
  return true;
}

function acquireMeleeOriginalVisibility(attackerId, sprite) {
  const key = String(attackerId);
  const recoveryWasActive = cancelMeleeOriginalRecovery(key);
  let state = meleeOriginalVisibilityLocks.get(key);
  if (!state) {
    state = {
      sprite,
      originalOpacity: recoveryWasActive ? "1" : sprite.style.opacity,
      locks: new Set(),
    };
    meleeOriginalVisibilityLocks.set(key, state);
  } else if (sprite?.isConnected) {
    state.sprite = sprite;
  }

  const token = Symbol(`melee-visibility-${key}`);
  state.locks.add(token);
  sprite.style.setProperty("opacity", "0", "important");
  return token;
}

function releaseMeleeOriginalVisibility(
  attackerId,
  token,
  forceVisible = false,
  deferRestore = false
) {
  const key = String(attackerId);
  if (forceVisible) cancelMeleeOriginalRecovery(key, true);
  const state = meleeOriginalVisibilityLocks.get(key);
  const currentSprite = document.getElementById(`DragSprite_${key}`)
    || state?.sprite
    || null;

  if (!state) {
    if (forceVisible && currentSprite?.isConnected) currentSprite.style.opacity = "1";
    return false;
  }

  if (forceVisible) state.locks.clear();
  else if (token) state.locks.delete(token);

  if (state.locks.size > 0) {
    if (currentSprite?.isConnected) currentSprite.style.setProperty("opacity", "0", "important");
    return true;
  }

  meleeOriginalVisibilityLocks.delete(key);
  if (currentSprite?.isConnected) {
    if (forceVisible) {
      currentSprite.style.setProperty("opacity", "1", "important");
    } else if (deferRestore) {
      currentSprite.style.setProperty("opacity", "0", "important");
    } else if (state.originalOpacity) {
      currentSprite.style.setProperty("opacity", state.originalOpacity, "");
    } else {
      currentSprite.style.removeProperty("opacity");
    }
  }
  return false;
}

function hasMeleeOriginalVisibilityLock(attackerId) {
  return (meleeOriginalVisibilityLocks.get(String(attackerId))?.locks.size || 0) > 0;
}

function showMeleeOriginalForImpact(targetId, duration) {
  const controllers = activeMeleeAnimations.get(String(targetId));
  if (!controllers) return false;

  const orderedControllers = [...controllers];
  for (let index = orderedControllers.length - 1; index >= 0; index -= 1) {
    if (orderedControllers[index]?.showOriginalForImpact?.(duration)) return true;
  }
  return false;
}

function createCanvasSnapshot(canvas) {
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  const snapshotContext = snapshot.getContext("2d");
  if (!snapshotContext) return null;
  snapshotContext.drawImage(canvas, 0, 0, snapshot.width, snapshot.height);
  return snapshot;
}

function restoreCanvasSnapshot(canvas, context, snapshot) {
  if (!canvas || !context || !snapshot) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(snapshot, 0, 0, canvas.width, canvas.height);
  return true;
}

function getNeutralMeleeCloneSource(canvas) {
  if (!canvas) return null;

  // Les impacts qui restaurent leur propre snapshot ne passent pas toujours
  // par le registre de teintes. Leur source neutre reste donc prioritaire.
  const activeDamageSnapshot = activeSnapshotDamageImpacts.get(canvas);
  return activeDamageSnapshot?.neutralSource
    || originalImages.get(canvas)
    || canvas;
}

function getCanvasTintStore(canvas) {
  if (!activeEntityTints.has(canvas)) {
    activeEntityTints.set(canvas, new Map());
  }

  return activeEntityTints.get(canvas);
}

function ensureOriginalCanvasImage(canvas) {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    console.error(`❌ Impossible d'obtenir le contexte 2D pour canvas id: ${canvas.id}`);
    return null;
  }

  const cachedImage = originalImages.get(canvas);
  const canvasSizeChanged = cachedImage
    && (cachedImage.width !== canvas.width || cachedImage.height !== canvas.height);

  if (!cachedImage || canvasSizeChanged) {
    try {
      const snapshot = createCanvasSnapshot(canvas);
      if (!snapshot) return null;
      originalImages.set(canvas, snapshot);
    } catch (error) {
      console.warn(`⚠️ Snapshot du canvas impossible pour ${canvas.id}`, error);
      return null;
    }
    if (canvasSizeChanged) {
      activeEntityTints.delete(canvas);
    }
  }

  return ctx;
}

export function renderEntityTint(canvas) {
  const ctx = ensureOriginalCanvasImage(canvas);
  if (!ctx) return;

  const tintStore = activeEntityTints.get(canvas);

  restoreCanvasSnapshot(canvas, ctx, originalImages.get(canvas));

  if (!tintStore || tintStore.size === 0) {
    return;
  }

  let dominantTint = null;

  for (const tint of tintStore.values()) {
    if (
      !dominantTint ||
      tint.priority > dominantTint.priority ||
      (
        tint.priority === dominantTint.priority &&
        tint.updatedAt > dominantTint.updatedAt
      )
    ) {
      dominantTint = tint;
    }
  }

  if (!dominantTint) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(${dominantTint.color}, ${dominantTint.opacity})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

export function applyEntityTint(canvas, tintName, opacity = 0.6) {
  if (!canvas) return;

  const tintConfig = ENTITY_TINTS[tintName];

  if (!tintConfig) {
    console.warn(`⚠️ Teinte inconnue : ${tintName}`);
    return;
  }

  const tintStore = getCanvasTintStore(canvas);

  tintStore.set(tintName, {
    name: tintName,
    color: tintConfig.color,
    priority: tintConfig.priority,
    opacity,
    updatedAt: clockNow(),
  });

  renderEntityTint(canvas);
}

export function releaseEntityTint(canvas, tintName) {
  if (!canvas) return;

  const tintStore = activeEntityTints.get(canvas);

  if (!tintStore) {
    renderEntityTint(canvas);
    return;
  }

  tintStore.delete(tintName);

  if (tintStore.size === 0) {
    activeEntityTints.delete(canvas);
  }

  renderEntityTint(canvas);
}

export function clearEntityTints(canvas) {
  if (!canvas) return;

  activeEntityTints.delete(canvas);
  renderEntityTint(canvas);
}

export function addIddle(sprite) {
    if (sprite && !sprite.classList.contains("iddle")) {
        sprite.classList.add("iddle");
    }
}

export function removeIddle(sprite) {
    if (sprite && sprite.classList.contains("iddle")) {
        sprite.classList.remove("iddle");
    }
}


// TEINTER CANVAS
export function entiteTinter(canvas, color, opacity = 0.6) {
  let ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error(`❌ Impossible d'obtenir le contexte 2D pour canvas id: ${canvas.id}`);
    return;
  }

  if (originalImages.has(canvas)) {
    restoreCanvasSnapshot(canvas, ctx, originalImages.get(canvas));
  }

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(${color}, ${opacity})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// 💥 Pulsation de teinte pour signaler un impact
export function damageImpact(targetId, options = {}, saved = null) {
  const visualRun = beginCanvasRun('damageImpact', targetId, options, saved);
  const {
    effectName = "blood-impact",
    src = null,
    className = "",
    lifetime = 800,
    offsetY = "10px",
    randomBloodImpact = true,
    preserveCanvasSnapshot = false,
    skipCanvasTint = false,
  } = options;

  const canvas = document.getElementById(`spriteCanvas_${targetId}`);
  if (!canvas) {
    finishCanvasRun(visualRun);
    console.warn(`⚠️ Canvas non trouvé pour targetId: ${targetId}`);
    return;
  }

  if (!saved) showMeleeOriginalForImpact(targetId, lifetime);

  const ctx = skipCanvasTint ? null : canvas.getContext("2d");
  if (!skipCanvasTint && !ctx) {
    finishCanvasRun(visualRun);
    console.error(`❌ Impossible d'obtenir le contexte 2D pour ${targetId}`);
    return;
  }

  if (!skipCanvasTint) damageImpacts.get(canvas)?.();

  let canvasSnapshot = null;
  if (!skipCanvasTint && preserveCanvasSnapshot) {
    activeSnapshotDamageImpacts.get(canvas)?.stop?.();
    try {
      canvasSnapshot = createCanvasSnapshot(canvas);
    } catch (error) {
      console.error("❌ Instantané du canvas impossible :", error);
    }
  }

  const effectsContainer = document.getElementById(`effectsContainer_${targetId}`);

  let finalSrc = src;
  let finalClassName = className;

  if (!saved && !finalSrc && randomBloodImpact) {
    const idx = Math.floor(Math.random() * 4) + 1;
    finalSrc = `./media/assets/effects/blood-impact-${idx}.gif`;
    finalClassName = `blood-impact fx-${idx}`;
  }

  if (!finalSrc) {
    finalSrc = `./media/assets/effects/${effectName}.gif`;
    finalClassName = finalClassName || effectName;
  }

  if (!saved) spawnEffectGif(effectsContainer, {
    className: finalClassName,
    src: finalSrc,
    lifetime,
    offsetY,
  });

  // Pour les cadavres, l'impact visuel reste entièrement dans le conteneur
  // d'effets : aucune lecture, teinte ou réécriture du canvas du sprite.
  if (skipCanvasTint) {
    finishCanvasRun(visualRun);
    const vibrationTarget = document.getElementById(`Animationsprite_${targetId}`)
      || canvas.parentElement;
    if (vibrationTarget?.animate) {
      vibrationTarget._damageImpactVibration?.cancel?.();
      const computedTransform = getComputedStyle(vibrationTarget).transform;
      const baseTransform = computedTransform === "none" ? "" : computedTransform;
      const transformAt = (offset) => `${baseTransform} translate3d(${offset}px, 0, 0)`.trim();
      const vibration = vibrationTarget.animate([
        { transform: transformAt(0) },
        { transform: transformAt(-3) },
        { transform: transformAt(3) },
        { transform: transformAt(-2) },
        { transform: transformAt(2) },
        { transform: transformAt(0) }
      ], {
        duration: 170,
        easing: "ease-out"
      });
      trackImpactVibration(vibrationTarget, vibration);
    }
    return;
  }

  const duration = 800;
  const maxOpacity = 0.6;
  let stopped = false;
  let snapshotController = null;
  let animationFrame = null;

  function restoreAndStop() {
    finishCanvasRun(visualRun);
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(animationFrame);
    if (damageImpacts.get(canvas) === restoreAndStop) damageImpacts.delete(canvas);
    if (canvasSnapshot) {
      restoreCanvasSnapshot(canvas, ctx, canvasSnapshot);
      if (activeSnapshotDamageImpacts.get(canvas) === snapshotController) {
        activeSnapshotDamageImpacts.delete(canvas);
      }
    } else {
      releaseEntityTint(canvas, "damageImpact");
    }
  }

  if (canvasSnapshot) {
    snapshotController = {
      stop: restoreAndStop,
      neutralSource: originalImages.get(canvas) || canvasSnapshot,
    };
    activeSnapshotDamageImpacts.set(canvas, snapshotController);
  }

  let start = saved?.state?.start;

  function animate(ts) {
    if (stopped) return;
    if (!document.body.contains(canvas)) return restoreAndStop();
    if (start === undefined) start = ts;

    const t = ts - start;
    const progress = Math.min(t / duration, 1);
    const opacity = Math.sin(progress * Math.PI) * maxOpacity;

    if (canvasSnapshot) {
      restoreCanvasSnapshot(canvas, ctx, canvasSnapshot);
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      applyEntityTint(canvas, "damageImpact", opacity);
    }

    if (progress >= 1) return restoreAndStop();
    animationFrame = requestAnimationFrame(animate);
  }


  damageImpacts.set(canvas, restoreAndStop);
  visualRun.stop = restoreAndStop;
  visualRun.capture = () => ({ start });
  animationFrame = requestAnimationFrame(animate);
}
export function brokenMagicImpact(targetId, saved = null) {
  const visualRun = beginCanvasRun('brokenMagicImpact', targetId, null, saved);
  const canvas = document.getElementById(`spriteCanvas_${targetId}`);
  const spriteContainer = document.getElementById(`spriteContainer_${targetId}`);

  if (!canvas) {
    finishCanvasRun(visualRun);
    console.warn(`⚠️ Canvas non trouvé pour brokenMagicImpact targetId: ${targetId}`);
    return;
  }

  brokenMagicImpacts.get(canvas)?.();
  const pose = acquireImpactPose(spriteContainer, saved?.state);
  let animationFrame = null;

  if (!saved) showMeleeOriginalForImpact(targetId, 350);

  const duration = 350;
  const blinkInterval = 55;
  const maxOpacity = 0.85;

  let startTime = saved?.state?.startTime ?? (clockNow());
  let stopped = false;

  const previousTransform = pose?.previousTransform ?? "";
  const previousTransition = pose?.previousTransition ?? "";
  const previousWillChange = pose?.previousWillChange ?? "";

  if (spriteContainer) {
    spriteContainer.style.transition = "transform 0.08s ease-in-out";
    spriteContainer.style.willChange = "transform";
  }

  function restoreAndStop() {
    finishCanvasRun(visualRun);
    if (stopped) return;

    stopped = true;
    cancelAnimationFrame(animationFrame);
    if (brokenMagicImpacts.get(canvas) === restoreAndStop) brokenMagicImpacts.delete(canvas);

    releaseEntityTint(canvas, "brokenMagicImpact");

    releaseImpactPose(spriteContainer, pose);
  }

  function animate(ts) {
    if (stopped) return;

    if (
      spriteContainer?.closest('[data-dead="true"]') ||
      spriteContainer?.querySelector('.dead-sprite, canvas.dead')
    ) {
      restoreAndStop();
      return;
    }

    if (!document.body.contains(canvas)) {
      restoreAndStop();
      return;
    }

    const elapsed = ts - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const blink = Math.sin((elapsed / blinkInterval) * Math.PI);
    const opacity = Math.abs(blink) * maxOpacity;

    applyEntityTint(canvas, "brokenMagicImpact", opacity);

if (spriteContainer) {
  const isSideB =
    spriteContainer.classList.contains("side-B") ||
    spriteContainer.classList.contains("B") ||
    spriteContainer.classList.contains("sideB");

  const rotateA = 0.08;
  const rotateB = 0;

  const rotationDirection = isSideB ? -1 : 1;

  const rotateValue =
    Math.sin(progress * Math.PI * 4) > 0
      ? rotateA * rotationDirection
      : rotateB;

  spriteContainer.style.transform = isSideB
    ? `rotate(${rotateValue}turn) scaleX(-1)`
    : `rotate(${rotateValue}turn)`;
}
    if (progress >= 1) {
      restoreAndStop();
      return;
    }

    animationFrame = requestAnimationFrame(animate);
  }


  brokenMagicImpacts.set(canvas, restoreAndStop);
  visualRun.stop = restoreAndStop;
  visualRun.capture = () => ({ startTime, previousTransform, previousTop: pose?.previousTop,
    previousTransition, previousWillChange });
  animationFrame = requestAnimationFrame(animate);
}
// Helper (inchangé sauf qu’on ne l’appelle plus à chaque frame)
function spawnEffectGif(container, { className, src, lifetime = 800, offsetY = null }) {
  if (!container) return;
  const selector = className.trim().split(/\s+/).map(name => `.${CSS.escape(name)}`).join('');
  let img = container.querySelector(selector);
  if (!img) {
    img = document.createElement("img");
    img.className = className;
      container.appendChild(img);
  }
  playCachedGif(img, `${src}`); // force le redémarrage du GIF
  

  img._armorImpactTO?.cancel?.();
  img._armorImpactTO = removeCombatVisualAfter(img, lifetime + 50);
}
export function mysticismBoostedAttackAnimation(attackerId, saved = null) {
  const visualRun = beginCanvasRun('mysticismBoostedAttackAnimation', attackerId, null, saved);
  const canvas = document.getElementById(`spriteCanvas_${attackerId}`);
  const sprite = document.getElementById(`DragSprite_${attackerId}`);

  if (!canvas) {
    console.warn(`⚠️ Canvas non trouvé pour mysticismBoostedAttackAnimation attackerId: ${attackerId}`);
    return;
  }

  const duration = 900;
  const pulses = 2;
  const maxOpacity = 0.55;
  const maxScale = 1.055;
  const maxRotation = 2.5;

  const previousCanvasTransform = saved?.state?.previousCanvasTransform ?? (canvas.style.transform || "");
  const previousCanvasFilter = saved?.state?.previousCanvasFilter ?? (canvas.style.filter || "");
  const previousCanvasTransition = saved?.state?.previousCanvasTransition ?? (canvas.style.transition || "");
  const previousCanvasWillChange = saved?.state?.previousCanvasWillChange ?? (canvas.style.willChange || "");

  const isSideB =
    sprite?.classList.contains("side-B") ||
    sprite?.classList.contains("B") ||
    sprite?.classList.contains("sideB");

  const direction = saved?.state?.direction ?? (isSideB ? -1 : 1);

  let startTime = saved?.state?.startTime ?? (clockNow());
  let stopped = false;

  canvas.style.transition = "none";
  canvas.style.willChange = "transform, filter";

  function restoreAndStop() {
    finishCanvasRun(visualRun);
    if (stopped) return;

    stopped = true;

    releaseEntityTint(canvas, "mysticismBoostedAttack");

    canvas.style.transform = previousCanvasTransform;
    canvas.style.filter = previousCanvasFilter;
    canvas.style.transition = previousCanvasTransition;
    canvas.style.willChange = previousCanvasWillChange;
  }

  function animate(now) {
    if (stopped) return;

    if (!document.body.contains(canvas)) {
      restoreAndStop();
      return;
    }

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const pulse = Math.abs(Math.sin(progress * Math.PI * pulses));
    const fade = 1 - progress;

    const opacity = pulse * maxOpacity * fade;
    const scale = 1 + pulse * (maxScale - 1);
    const rotation = Math.sin(progress * Math.PI * pulses * 2) * maxRotation * direction * fade;

    applyEntityTint(canvas, "mysticismBoostedAttack", opacity);

    canvas.style.transform = `
      ${previousCanvasTransform}
      scale(${scale.toFixed(3)})
      rotate(${rotation.toFixed(2)}deg)
    `;

    canvas.style.filter = `
      ${previousCanvasFilter}
      drop-shadow(0 0 ${6 + pulse * 10}px rgba(210, 245, 255, ${0.35 + opacity}))
      brightness(${1 + pulse * 0.35})
    `;

    if (progress >= 1) {
      restoreAndStop();
      return;
    }

    requestAnimationFrame(animate);
  }


  visualRun.capture = () => ({ previousCanvasTransform, previousCanvasFilter, previousCanvasTransition, previousCanvasWillChange, direction, startTime });
  requestAnimationFrame(animate);
}
// === Ta fonction existante, avec l’injection du GIF ===
export function damageArmorImpact(targetId, saved = null) {
  const visualRun = beginCanvasRun('damageArmorImpact', targetId, null, saved);
    const canvas = document.getElementById(`spriteCanvas_${targetId}`);
    if (!canvas) {
        console.warn(`⚠️ Canvas non trouvé pour targetId: ${targetId}`);
        return;
    }

    if (!saved) showMeleeOriginalForImpact(targetId, 800);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error(`❌ Impossible d'obtenir le contexte 2D pour ${targetId}`);
        return;
    }

    const effectsContainer = document.getElementById(`effectsContainer_${targetId}`);
    if (!saved) spawnEffectGif(effectsContainer, {
        className: "armorImpactGif",
        src: "./media/assets/effects/armor-impact.gif",
        lifetime: 800,
    });

    if (!window.originalImages) window.originalImages = {};
    if (!originalImages.has(canvas)) {
        originalImages.set(canvas, createCanvasSnapshot(canvas));
    }

    let opacity = saved?.state?.opacity ?? (0);
    const fadeSpeed = 0.08;
    const duration = 800;
    const startTime = saved?.state?.startTime ?? (clockNow());
    let fadeIn = saved?.state?.fadeIn ?? (true);

    console.log(`⚔️ Début de l'animation Armor Impact sur ${targetId}`);

    canvas.style.transition = "transform 0.1s ease-in-out, filter 0.2s ease-in-out";

    let pulseUp = saved?.state?.pulseUp ?? (true);
    const pulseInterval = setIntervalFrom(() => {
        canvas.style.transform = pulseUp
            ? "scale(1.05) rotate(0.5deg)"
            : "scale(1) rotate(-0.5deg)";
        pulseUp = !pulseUp;
    }, 100, saved?.pulseRemaining);

    function stopArmorImpact() {
    finishCanvasRun(visualRun);
        clearInterval(pulseInterval);
        canvas.style.transform = "scale(1)";
        canvas.style.filter = "none";
        releaseEntityTint(canvas, "armorImpact");
        console.log(`✅ Fin de l'animation Armor Impact pour ${targetId}`);
    }

    function animate() {
        const elapsed = clockNow() - startTime;

        if (elapsed > duration) {
            stopArmorImpact();
            return;
        }

        // 💠 Teinte bleue avec hiérarchie
        applyEntityTint(canvas, "armorImpact", opacity);

        // ✨ Lueur argentée dynamique
        const glowIntensity = 0.5 + Math.sin(elapsed / 80) * 0.5;
        canvas.style.filter = `drop-shadow(0 0 ${6 * glowIntensity}px rgba(180, 200, 255, ${glowIntensity}))
                               brightness(${1 + glowIntensity * 0.3})`;

        if (fadeIn) {
            opacity += fadeSpeed;
            if (opacity >= 0.6) fadeIn = false;
        } else {
            opacity -= fadeSpeed;
            if (opacity <= 0) fadeIn = true;
        }

        requestAnimationFrame(animate);
    }


  visualRun.capture = () => ({ opacity, startTime, fadeIn, pulseUp });
  visualRun.pulseRemaining = () => remainingCombatTimer(pulseInterval);
    if (saved) requestAnimationFrame(animate);
    else animate();
}
export function animateAmbidextry(targetId, saved = null) {
  const visualRun = beginCanvasRun('animateAmbidextry', targetId, null, saved);
    const canvas = document.getElementById(`spriteCanvas_${targetId}`);
    if (!canvas) {
        console.warn(`⚠️ Canvas non trouvé pour targetId: ${targetId}`);
        return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error(`❌ Impossible d'obtenir le contexte 2D pour ${targetId}`);
        return;
    }

    // 🧩 Sauvegarde du sprite original
    if (!window.originalImages) window.originalImages = {};
    if (!originalImages.has(canvas)) {
        originalImages.set(canvas, createCanvasSnapshot(canvas));
    }

    let opacity = saved?.state?.opacity ?? (0);
    const fadeSpeed = 0.15;
    const blinkCount = 2;
    let completedBlinks = saved?.state?.completedBlinks ?? (0);
    let fadeIn = saved?.state?.fadeIn ?? (true);

    function stopAmbidextry() {
    finishCanvasRun(visualRun);
        releaseEntityTint(canvas, "ambidextry");
        canvas.style.filter = "none";
    }

    function animate() {
        if (completedBlinks >= blinkCount) {
            stopAmbidextry();
            return;
        }

        // 💛 Teinte jaune vif avec hiérarchie
        applyEntityTint(canvas, "ambidextry", opacity);

        // ✨ Lueur légère
        const glow = 0.3 + opacity * 0.7;
        canvas.style.filter = `drop-shadow(0 0 ${8 * glow}px rgba(237,255,0,${glow})) brightness(${1 + glow * 0.5})`;

        // 🔁 Gestion du fade
        if (fadeIn) {
            opacity += fadeSpeed;
            if (opacity >= 0.8) fadeIn = false;
        } else {
            opacity -= fadeSpeed;
            if (opacity <= 0) {
                fadeIn = true;
                completedBlinks++;
            }
        }

        requestAnimationFrame(animate);
    }


  visualRun.capture = () => ({ opacity, completedBlinks, fadeIn });
    if (saved) requestAnimationFrame(animate);
    else animate();
}
export function shakeImpact(targetId, saved = null) {
  const visualRun = beginCanvasRun('shakeImpact', targetId, null, saved);
    const spriteContainer = document.getElementById(`spriteContainer_${targetId}`);

    if (!spriteContainer) {
        finishCanvasRun(visualRun);
        console.warn(`⚠️ SpriteContainer non trouvé pour targetId: ${targetId}`);
        return;
    }

    impactShakes.get(spriteContainer)?.();
    const pose = acquireImpactPose(spriteContainer, saved?.state);
    let stopped = false, timer = null;

    const duration = 200;
    const startTime = saved?.state?.startTime ?? (clockNow());
    const intensity = 2;
    const jumpHeight = 2;

    const { previousTransform, previousTop, previousTransition, previousWillChange } = pose;

    const isSideB = !spriteContainer.classList.contains("A");

    let direction = saved?.state?.direction ?? (isSideB ? -1 : 1);
    let jumpDirection = saved?.state?.jumpDirection ?? (1);

    spriteContainer.style.willChange = "transform, top";

    function stopShakeImpact() {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
    finishCanvasRun(visualRun);
        if (impactShakes.get(spriteContainer) === stopShakeImpact) impactShakes.delete(spriteContainer);
        releaseImpactPose(spriteContainer, pose);
    }

    function animate() {
        if (stopped) return;
        if (
            !spriteContainer.isConnected ||
            spriteContainer.closest('[data-dead="true"]') ||
            spriteContainer.querySelector('.dead-sprite, canvas.dead')
        ) {
            stopShakeImpact();
            return;
        }

        const elapsed = clockNow() - startTime;

        if (elapsed > duration) {
            stopShakeImpact();
            return;
        }

        const angle = direction * intensity;
        const jumpOffset = jumpDirection * jumpHeight;

        spriteContainer.style.transform = isSideB
            ? `rotate(${angle}deg) scaleX(-1)`
            : `rotate(${angle}deg)`;

        spriteContainer.style.top = `${jumpOffset}px`;

        direction *= -1;
        jumpDirection *= -1;

        const timeStep = Math.max(30, 80 - (elapsed / duration) * 50);

        visualRun.nextAt = clockNow() + timeStep;
        timer = setTimeout(animate, timeStep);
    }


  visualRun.capture = () => ({ startTime, previousTransform, previousTop, previousTransition, previousWillChange, direction, jumpDirection });
    impactShakes.set(spriteContainer, stopShakeImpact);
    visualRun.stop = stopShakeImpact;
    if (saved) timer = setTimeout(animate, Math.max(0, saved.nextAt - clockNow()));
    else animate();
}
// DEAD SPRITE ANIMATION
export function updateSpriteUI(entity) {
    if (!entity.isDEAD) return;

    const container = document.getElementById(`spriteContainer_${entity.id}`);
    if (!container) return;

    if (document.getElementById(`bloodEffect_${entity.id}`)) return;

    let effectsContainer = document.getElementById(`effectsContainer_${entity.id}`);

    if (!effectsContainer) {
        effectsContainer = document.createElement("div");
        effectsContainer.id = `effectsContainer_${entity.id}`;
        effectsContainer.className = "effects-container";
        container.appendChild(effectsContainer);
    }

    const bloodGif = document.createElement("img");
    playCachedGif(bloodGif, `./media/assets/effects/death-blood.gif`);
    bloodGif.className = "effect-vfx death-blood";
    bloodGif.id = `bloodEffect_${entity.id}`;

    effectsContainer.appendChild(bloodGif);

    setTimeout(() => {
        if (bloodGif && bloodGif.parentNode) {
            bloodGif.remove();
        }
    }, 1000);
}
// 💠 Fonction d'animation d'indestructibilité (pulsation orange)
export function animateIndestructibility(targetId, saved = null) {
  const visualRun = beginCanvasRun('animateIndestructibility', targetId, null, saved);
    const canvas = document.getElementById(`spriteCanvas_${targetId}`);
    if (!canvas) {
        console.warn(`⚠️ Canvas non trouvé pour targetId: ${targetId}`);
        return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error(`❌ Impossible d'obtenir le contexte 2D pour ${targetId}`);
        return;
    }

    if (!originalImages.has(canvas)) {
        originalImages.set(canvas, createCanvasSnapshot(canvas));
    }

    let opacity = saved?.state?.opacity ?? (0);
    const fadeSpeed = 0.08;
    const duration = 2000;
    const startTime = saved?.state?.startTime ?? (clockNow());
    let fadeIn = saved?.state?.fadeIn ?? (true);

    const previousTransform = saved?.state?.previousTransform ?? (canvas.style.transform);
    const previousTransition = saved?.state?.previousTransition ?? (canvas.style.transition);

    console.log(`🟠 Début de l'animation indestructibilité sur ${targetId}`);

    canvas.style.transition = "transform 0.15s ease-in-out";

    let pulseUp = saved?.state?.pulseUp ?? (true);

    const pulseInterval = setIntervalFrom(() => {
        canvas.style.transform = pulseUp ? "scale(1.06)" : "scale(1)";
        pulseUp = !pulseUp;
    }, 150, saved?.pulseRemaining);

    function stopIndestructibility() {
    finishCanvasRun(visualRun);
        clearInterval(pulseInterval);

        canvas.style.transform = previousTransform || "scale(1)";
        canvas.style.transition = previousTransition || "";

        releaseEntityTint(canvas, "indestructibility");

        console.log(`✅ Fin de l'animation indestructibilité pour ${targetId}`);
    }

    function animate() {
        const elapsed = clockNow() - startTime;

        if (elapsed > duration) {
            stopIndestructibility();
            return;
        }

        // 🔸 Teinte orange avec hiérarchie
        applyEntityTint(canvas, "indestructibility", opacity);

        if (fadeIn) {
            opacity += fadeSpeed;
            if (opacity >= 0.6) fadeIn = false;
        } else {
            opacity -= fadeSpeed;
            if (opacity <= 0) fadeIn = true;
        }

        requestAnimationFrame(animate);
    }


  visualRun.capture = () => ({ opacity, startTime, fadeIn, previousTransform, previousTransition, pulseUp });
  visualRun.pulseRemaining = () => remainingCombatTimer(pulseInterval);
    if (saved) requestAnimationFrame(animate);
    else animate();
}
export function animateEsoterism(targetId, saved = null) {
  const visualRun = beginCanvasRun('animateEsoterism', targetId, null, saved);
    const canvas = document.getElementById(`spriteCanvas_${targetId}`);
    if (!canvas) {
        console.warn(`⚠️ Canvas non trouvé pour targetId: ${targetId}`);
        return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error(`❌ Impossible d'obtenir le contexte 2D pour ${targetId}`);
        return;
    }

    if (!originalImages.has(canvas)) {
        originalImages.set(canvas, createCanvasSnapshot(canvas));
    }

    let opacity = saved?.state?.opacity ?? (0);
    const fadeSpeed = 0.05;
    const duration = 2200;
    const startTime = saved?.state?.startTime ?? (clockNow());
    let fadeIn = saved?.state?.fadeIn ?? (true);

    const previousTransform = saved?.state?.previousTransform ?? (canvas.style.transform);
    const previousTransition = saved?.state?.previousTransition ?? (canvas.style.transition);

    console.log(`🔮 Début de l'animation Ésotérisme sur ${targetId}`);

    canvas.style.transition = "transform 0.25s ease-in-out";

    let pulseUp = saved?.state?.pulseUp ?? (true);

    const pulseInterval = setIntervalFrom(() => {
        canvas.style.transform = pulseUp ? "scale(1.04)" : "scale(1)";
        pulseUp = !pulseUp;
    }, 250, saved?.pulseRemaining);

    function stopEsoterism() {
    finishCanvasRun(visualRun);
        clearInterval(pulseInterval);

        canvas.style.transform = previousTransform || "scale(1)";
        canvas.style.transition = previousTransition || "";

        releaseEntityTint(canvas, "esoterism");

        console.log(`✅ Fin de l'animation Ésotérisme pour ${targetId}`);
    }

    function animate() {
        const elapsed = clockNow() - startTime;

        if (elapsed > duration) {
            stopEsoterism();
            return;
        }

        // 🌸 Teinte rose douce avec hiérarchie
        applyEntityTint(canvas, "esoterism", opacity);

        if (fadeIn) {
            opacity += fadeSpeed;
            if (opacity >= 0.5) fadeIn = false;
        } else {
            opacity -= fadeSpeed;
            if (opacity <= 0) fadeIn = true;
        }

        requestAnimationFrame(animate);
    }


  visualRun.capture = () => ({ opacity, startTime, fadeIn, previousTransform, previousTransition, pulseUp });
  visualRun.pulseRemaining = () => remainingCombatTimer(pulseInterval);
    if (saved) requestAnimationFrame(animate);
    else animate();
}

export function animateAstrality(targetId, saved = null) {
  const visualRun = beginCanvasRun('animateAstrality', targetId, null, saved);
  const canvas = document.getElementById(`spriteCanvas_${targetId}`);

  if (!canvas) {
    console.warn(`⚠️ Canvas non trouvé pour targetId: ${targetId}`);
    return;
  }

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    console.error(`❌ Impossible d'obtenir le contexte 2D pour ${targetId}`);
    return;
  }

  if (!originalImages.has(canvas)) {
    originalImages.set(canvas, createCanvasSnapshot(canvas));
  }

  const duration = 1500;
  const start = saved?.state?.start ?? (clockNow());

  const previousOpacity = saved?.state?.previousOpacity ?? (canvas.style.opacity);
  const previousWillChange = saved?.state?.previousWillChange ?? (canvas.style.willChange);

  canvas.style.opacity = "0.3";
  canvas.style.willChange = "opacity";

  console.log(`✨ Début animation Astralité sur ${targetId}`);

  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

  function stopAstrality() {
    finishCanvasRun(visualRun);
    releaseEntityTint(canvas, "astrality");

    canvas.style.opacity = previousOpacity || "1";
    canvas.style.willChange = previousWillChange || "";

    console.log(`✅ Fin animation Astralité pour ${targetId}`);
  }

  function frame(now) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);

    const visualOpacity = 0.3 + 0.7 * easeOutCubic(t);

    applyEntityTint(canvas, "astrality", 0.45);

    canvas.style.opacity = visualOpacity.toFixed(3);

    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }

    stopAstrality();
  }


  visualRun.capture = () => ({ start, previousOpacity, previousWillChange });
  requestAnimationFrame(frame);
}

export function animateDodge(entityId, saved = null) {
    const visualRun = beginCanvasRun('animateDodge', entityId, {}, saved);
    const startedAt = saved?.state.startedAt ?? clockNow();
    const sprite = document.getElementById(`imgContainer_${entityId}`);
    if (!sprite) return;

    const isSideB = sprite.classList.contains("img-side-B");

    const previousTransition = saved?.state.previousTransition ?? sprite.style.transition;
    const previousPosition = saved?.state.previousPosition ?? sprite.style.position;
    const previousLeft = saved?.state.previousLeft ?? sprite.style.left;
    const previousRight = saved?.state.previousRight ?? sprite.style.right;
    const previousTransform = saved?.state.previousTransform ?? sprite.style.transform;

    visualRun.capture = () => ({ startedAt, previousTransition, previousPosition, previousLeft, previousRight, previousTransform });
    if (!saved) {
    sprite.style.transition = "left 0.1s ease-out, right 0.1s ease-out, transform 0.1s ease-out";
    sprite.style.position = "relative";

    if (isSideB) {
        sprite.style.right = "60px";
        sprite.style.left = "";
        sprite.style.transform = "rotate(10deg)";
    } else {
        sprite.style.left = "-60px";
        sprite.style.right = "";
        sprite.style.transform = "rotate(10deg)";
    }

    }
    const restoreStyle = () => {
        finishCanvasRun(visualRun);
        Object.assign(sprite.style, { transition: previousTransition, position: previousPosition, left: previousLeft, right: previousRight, transform: previousTransform });
    };
    if (saved && clockNow() >= startedAt + 100) {
        setTimeout(restoreStyle, Math.max(0, startedAt + 400 - clockNow()));
        return;
    }
    setTimeout(() => {
        sprite.style.transition = "left 0.3s ease-out, right 0.3s ease-out, transform 0.3s ease-out";

        if (isSideB) {
            sprite.style.right = previousRight || "0px";
            sprite.style.left = previousLeft || "";
        } else {
            sprite.style.left = previousLeft || "0px";
            sprite.style.right = previousRight || "";
        }

        sprite.style.transform = previousTransform || "rotate(0deg)";

        setTimeout(restoreStyle, 300);
    }, Math.max(0, startedAt + 100 - clockNow()));
}

export function getAttackCastingVisual(attack) {
  if (typeof attack.castingAsset === 'string' && attack.castingAsset.trim()) {
    return { asset: attack.castingAsset, className: '' };
  }
  const flags = getAttackResolutionFlags(attack);
  if (!flags.hasMagicalBehavior) {
    return { asset: './media/assets/effects/castingfx-base.gif', className: 'cast-default' };
  }
  const tone = attack.attackTarget?.includes('hexa') ? 'invocateur'
    : flags.hasHybridal || flags.hasPhysical || flags.hasPiercing ? 'hybrid'
    : attack.combatFunction === 'Support' ? 'support' : 'magical';
  return { asset: './media/assets/effects/magic-circle.png', className: `cast-default-circle cast-tone-${tone}` };
}

export function animatePreparation(entity, attack, forcedDuration = null) {
  // A preparation owns the transient pose. Stop an older loop before reading
  // the neutral transform so overlapping actions can never preserve a lean.
  entity.stopPreparationAnimation?.();
  const saved = entity._preparationVisual;

  const castContainer = document.getElementById(`Cast_Animation_${entity.id}`);

  if (!castContainer) {
    console.warn(`⚠️ Impossible de trouver #Cast_Animation_${entity.id}, l'animation ne sera pas affichée.`);
    return null;
  }

  const existingCast = document.getElementById(`cast_${entity.id}`);

  if (existingCast && !saved) {
    existingCast.remove();
  }

  const existingCastEffect = document.getElementById(`castEffect_${entity.id}`);

  if (existingCastEffect && !saved) {
    existingCastEffect.remove();
  }

  const castEffectDiv = saved && existingCastEffect || document.createElement("div");
  castEffectDiv.id = `castEffect_${entity.id}`;
  castEffectDiv.className = `cast-preparation-container ${attack.functionName} side-${entity.side}`;
  castContainer.appendChild(castEffectDiv);

  const castImg = saved && existingCast || document.createElement("img");
  castImg.id = `cast_${entity.id}`;
  const castingVisual = getAttackCastingVisual(attack);
  if (!saved) castImg.src = cachedResourceUrl(castingVisual.asset);
  castImg.className = `cast ${attack.functionName} ${castingVisual.className}`;
  castEffectDiv.appendChild(castImg);

  const sprite = document.getElementById(`DragSprite_${entity.id}`);

  if (!sprite) {
    console.warn(`⚠️ Impossible de trouver #DragSprite_${entity.id}, annulation de l'animation.`);
    castEffectDiv.remove();
    return null;
  }

  const previousTransform = saved?.previousTransform ?? sprite.style.transform;
  const previousWillChange = saved?.previousWillChange ?? sprite.style.willChange;

  removeIddle(sprite);

  const frameRate = 1000 / 30;

  let direction = saved?.direction ?? 1;
  let maxBackward = saved?.maxBackward ?? -6;
  let phase = saved?.phase ?? 0;
  let finalPhaseStarted = saved?.finalPhaseStarted ?? false;
  let cleanupPlanned = false;
  let stopped = false;

  const state = entity._preparationVisual = saved || { previousTransform, previousWillChange };
  sprite.style.willChange = "transform";
  if (saved?.final) animateFinalPhase(castImg, saved.final);

  function stopPreparationAnimation() {
    if (stopped) return;

    stopped = true; delete entity._preparationVisual;

    if (castEffectDiv && castEffectDiv.parentNode) {
      castEffectDiv.remove();
    }

    sprite.style.transform = previousTransform || "";
    sprite.style.willChange = previousWillChange || "";

    addIddle(sprite);

    if (entity.stopPreparationAnimation === stopPreparationAnimation) {
      entity.stopPreparationAnimation = null;
    }
  }

  entity.stopPreparationAnimation = stopPreparationAnimation;

  function getDynamicProgress() {
    const progress = Number(entity.preparationProgressRatio);

    if (Number.isFinite(progress)) {
      return Math.max(0, Math.min(1, progress));
    }

    return 0;
  }

  function updateAnimation() {
    if (stopped) return;

    if (!document.body.contains(sprite)) {
      stopPreparationAnimation();
      return;
    }

    const progress = getDynamicProgress();

    if (progress >= 0.85 && !finalPhaseStarted) {
      finalPhaseStarted = true;

      if (castImg.classList.contains("boulassefeu")) {
        castImg.style.animation = "pulsateFlame 1.5s ease-in-out infinite alternate";
      }

      state.final = animateFinalPhase(castImg);
    }

    if (progress >= 1) {
      sprite.style.transform = previousTransform || "";

      if (!cleanupPlanned) {
        cleanupPlanned = true;

        setTimeout(() => {
          stopPreparationAnimation();
        }, 2000);
      }

      return;
    }

    const maxIntensity = 0.3 + progress * 1.5;
    const intensity = Math.sin(progress * Math.PI) * maxIntensity;
    const easingFactor = Math.pow(progress, 1.8);
    const translateBackward = maxBackward * easingFactor;

    if (progress > (phase + 1) / 5) {
      phase++;
      maxBackward *= 1.4;
    }

    const translateX = direction * intensity + translateBackward;
    direction *= -1;
    Object.assign(state, { direction, maxBackward, phase, finalPhaseStarted });

    sprite.style.transform = `translateX(${translateX}px)`;

    setTimeout(() => {
      requestAnimationFrame(updateAnimation);
    }, frameRate);
  }

  requestAnimationFrame(updateAnimation);
  return stopPreparationAnimation;
}
export function animateFinalPhase(castImg, saved = null) {
    if (!castImg) return;

    const finalStartTime = saved?.finalStartTime ?? clockNow();
    const finalDuration = 1000;
    const frameRate = 1000 / 30;

    const previousTransform = saved?.previousTransform ?? castImg.style.transform;
    const previousFilter = saved?.previousFilter ?? castImg.style.filter;
    const castingFilter = saved?.castingFilter ?? getComputedStyle(castImg).filter;
    const previousTransition = saved?.previousTransition ?? castImg.style.transition;
    const previousOpacity = saved?.previousOpacity ?? castImg.style.opacity;
    const previousWillChange = saved?.previousWillChange ?? castImg.style.willChange;

    castImg.style.willChange = "transform, filter, opacity";

    function finalAnimation() {
        const elapsed = clockNow() - finalStartTime;
        const progress = elapsed / finalDuration;

        if (progress >= 1) {
            castImg.style.transform = previousTransform || "";
            castImg.style.filter = previousFilter || "";
            return;
        }

        const scaleUp = 1 + progress * 0.2;
        const brightness = 1 + progress;

        castImg.style.transform = `scale(${scaleUp})`;
        castImg.style.filter = `${castingFilter === 'none' ? '' : castingFilter} brightness(${brightness})`;

        setTimeout(() => {
            requestAnimationFrame(finalAnimation);
        }, frameRate);
    }

    requestAnimationFrame(finalAnimation);

    setTimeout(() => {
        if (!castImg || !castImg.parentNode) return;

        castImg.style.transition = "transform 0.3s ease-in-out, opacity 0.3s ease-in-out";
        castImg.style.transform = "scale(1.5)";
        castImg.style.opacity = "0";
    }, Math.max(0, finalStartTime + finalDuration - clockNow()));

    setTimeout(() => {
        if (!castImg) return;

        castImg.style.transform = previousTransform || "";
        castImg.style.filter = previousFilter || "";
        castImg.style.transition = previousTransition || "";
        castImg.style.opacity = previousOpacity || "";
        castImg.style.willChange = previousWillChange || "";
    }, Math.max(0, finalStartTime + finalDuration + 350 - clockNow()));
    return { finalStartTime, previousTransform, previousFilter, castingFilter, previousTransition, previousOpacity, previousWillChange };
}

export function animateRecuperation(entity, attack) {
    const sprite = document.getElementById(`DragSprite_${entity.id}`);
    let effectsContainer = document.getElementById(`effectsContainer_${entity.id}`);

    if (!sprite) {
        console.warn(`⚠️ Impossible de trouver #DragSprite_${entity.id}, annulation de l'animation.`);
        return;
    }

    if (entity.recoveryTime === undefined || entity.recoveryTime <= 0) {
        console.warn(`⏳ ${entity.name} (Side ${entity.side}) a un recoveryTime invalide: ${entity.recoveryTime}`);
        return;
    }

    removeIddle(sprite);

    if (!effectsContainer) {
        console.warn(`⚠️ Impossible de trouver #effectsContainer_${entity.id}, création dynamique.`);
        effectsContainer = document.createElement("div");
        effectsContainer.id = `effectsContainer_${entity.id}`;
        effectsContainer.className = "effects-container";
        sprite.parentNode.appendChild(effectsContainer);
    }

    const saved = entity._recoveryVisual;
    const entityTrackingId = String(entity.id);
    const previousTransform = saved?.previousTransform ?? sprite.style.transform;
    const previousScale = saved?.previousScale ?? sprite.style.scale;
    const previousWillChange = saved?.previousWillChange ?? sprite.style.willChange;

    const startTime = saved?.startTime ?? clockNow();
    const duration = saved?.duration ?? entity.recoveryTime;
    entity._recoveryVisual = { startTime, duration, previousTransform, previousScale, previousWillChange };
    const frameRate = 1000 / 30;

    const maxVerticalMove = 3;
    const maxHorizontalMove = 1.5;
    const recoveryScaleMin = 0.8;
    const recoveryScaleMax = 1;

    let stopped = false;

    const recoveryGif = saved && effectsContainer.querySelector(".recoveryGif") || document.createElement("img");
    if (!saved) playCachedGif(recoveryGif, `./media/assets/effects/recovery.gif`);
    if (!saved) recoveryGif.style.opacity = "0";
    recoveryGif.className = "recoveryGif";
    effectsContainer.appendChild(recoveryGif);

    // La récupération ne gère JAMAIS l'opacité du sprite.
    // Le CAC / la charge restent seuls propriétaires de cette propriété.
    sprite.style.willChange = "transform, scale";

    setTimeout(() => {
        if (recoveryGif && recoveryGif.parentNode) {
            recoveryGif.style.opacity = "1";
        }
    }, Math.max(0, startTime + 50 - clockNow()));

    function stopRecuperation() {
        if (stopped) return;
        stopped = true; delete entity._recoveryVisual;
        if (entity.stopRecoveryAnimation === stopRecuperation) entity.stopRecoveryAnimation = null;

        sprite.style.transform = previousTransform || "";
        sprite.style.scale = previousScale || "";
        sprite.style.willChange = previousWillChange || "";

        recoveryGif.style.opacity = "0";

        if (entity.battleStopped) recoveryGif.remove();
        else setTimeout(() => {
            if (recoveryGif && recoveryGif.parentNode) {
                recoveryGif.remove();
            }
        }, 300);

        const meleeStillOwnsVisualState =
            hasMeleeOriginalVisibilityLock(entityTrackingId)
            || meleeOriginalRecoveryAnimations.has(entityTrackingId)
            || Boolean(activeMeleeAnimations.get(entityTrackingId)?.size);

        if (!meleeStillOwnsVisualState) addIddle(sprite);
    }

    function updateAnimation() {
        if (stopped) return;

        const elapsed = clockNow() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            stopRecuperation();
            return;
        }

        const breathingSpeed = 0.002;
        const verticalMove =
            Math.sin(elapsed * breathingSpeed * Math.PI * 2) * maxVerticalMove;

        const horizontalMove =
            Math.sin(elapsed * breathingSpeed * Math.PI) * maxHorizontalMove;

        // Pulsation régulière 1 -> 0.8 -> 1, sans toucher à opacity.
        const recoveryScale =
            recoveryScaleMin +
            ((Math.cos(elapsed * breathingSpeed * Math.PI * 2) + 1) / 2) *
            (recoveryScaleMax - recoveryScaleMin);

        sprite.style.transform = `translate(${horizontalMove.toFixed(2)}px, ${verticalMove.toFixed(2)}px)`;
        sprite.style.scale = recoveryScale.toFixed(3);

        setTimeout(() => {
            requestAnimationFrame(updateAnimation);
        }, frameRate);
    }

    entity.stopRecoveryAnimation = stopRecuperation;
    requestAnimationFrame(updateAnimation);
    return stopRecuperation;
}

// One shared Phaser scene projects combat time; it never resolves an attack.
const phaserFlights = new Map(), phaserEffects = new Map(), phaserMelees = new Map();
let phaserLayer = null, phaserReady = null, projectileEffectSequence = 0;
const viewport = () => ({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) });
// The shared Phaser scene drives board travel while the HTML entity, HUD and
// shaped hitbox stay together. Logical placement is committed before this view.
const phaserPlacements = new Map();
function placementProgress(visual) {
  const x = Math.max(0, Math.min(1, (clockNow() - visual.startedAt) / 420));
  if (x === 0 || x === 1) return x;
  // Match the existing cubic-bezier(.22,.65,.3,1), including interrupted moves.
  const cubic = (t, a, b) => 3 * (1-t) ** 2 * t * a + 3 * (1-t) * t * t * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const t = (low + high) / 2;
    if (cubic(t, .22, .3) < x) low = t; else high = t;
  }
  return cubic((low + high) / 2, .65, 1);
}
function validPlacement(entry) {
  return entry.box.isConnected && !entry.entity.isDEAD && !entry.entity.hasFled
    && String(entry.entity.position) === entry.visual.position
    && entry.box.closest('.hex')?.dataset.position === entry.visual.position;
}
export function getEntityPlacementOrigin(entity) {
  const entry = phaserPlacements.get(String(entity.id));
  if (!entry || !validPlacement(entry)) return null;
  const { from, to } = entry.visual, t = placementProgress(entry.visual);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}
export function clearEntityPlacement(id) {
  const entry = phaserPlacements.get(String(id));
  if (!entry) return;
  phaserPlacements.delete(String(id)); clearTimeout(entry.timer);
  const { previousTransform, previousPriority } = entry.visual;
  if (previousTransform) entry.box.style.setProperty('transform', previousTransform, previousPriority);
  else entry.box.style.removeProperty('transform');
  entry.smoke?.remove(); hideIdlePhaser();
}
export function clearEntityPlacements() {
  for (const id of [...phaserPlacements.keys()]) clearEntityPlacement(id);
}
function updatePhaserPlacements() {
  for (const entry of phaserPlacements.values()) {
    if (!validPlacement(entry) || clockNow() >= entry.visual.startedAt + 600) {
      clearEntityPlacement(entry.entity.id); continue;
    }
    const { from, to } = entry.visual, remaining = 1 - placementProgress(entry.visual);
    const dx = Number(((from.x-to.x)*remaining).toFixed(6)), dy = Number(((from.y-to.y)*remaining).toFixed(6));
    const transform = `translate(${dx}px, ${dy}px)`;
    if (entry.box.style.transform !== transform) entry.box.style.transform = transform;
  }
}
export function animateEntityPlacement(entity, from, to, saved = null) {
  if (globalThis.__combatSimulation) return;
  const box = document.getElementById(`Box_Entite_${entity.id}`);
  if (!box) return;
  clearEntityPlacement(entity.id);
  const visual = saved || { renderer: 'phaser', from, to, position: String(entity.position), startedAt: clockNow(),
    previousTransform: box.style.getPropertyValue('transform'), previousPriority: box.style.getPropertyPriority('transform') };
  // A saved inline offset belongs to this renderer, not to the base entity.
  if (saved) {
    if (visual.previousTransform) box.style.setProperty('transform', visual.previousTransform, visual.previousPriority);
    else box.style.removeProperty('transform');
  }
  if (!visual.from || !visual.to || Math.hypot(visual.from.x-visual.to.x, visual.from.y-visual.to.y) < .1
    || matchMedia('(prefers-reduced-motion: reduce)').matches || clockNow() >= visual.startedAt + 600) return;
  const entry = { entity, box, visual, timer: null, smoke: null };
  if (!validPlacement(entry)) return;
  phaserPlacements.set(String(entity.id), entry);
  // Project immediately: cold loading must never flash the monster at arrival.
  updatePhaserPlacements();
  const smoke = entry.smoke = new Image(); smoke.className = 'entity-footprint-smoke'; smoke.alt = '';
  smoke.dataset.phaserPlacement = String(entity.id);
  (box.querySelector('.drag-box') || box).append(smoke);
  void playCachedGif(smoke, './media/assets/effects/dodge-smoke.gif');
  entry.timer = setTimeout(() => clearEntityPlacement(entity.id), Math.max(0, visual.startedAt + 600 - clockNow()));
  void ensurePhaserLayer().then(layer => {
    if (phaserPlacements.get(String(entity.id)) !== entry) return;
    updatePhaserPlacements(); layer.game.loop.wake();
  }).catch(error => {
    if (phaserPlacements.get(String(entity.id)) === entry) clearEntityPlacement(entity.id);
    console.warn('[PhaserPlacement]', error);
  });
}
for (const event of ['stageInterfaceClosing', 'battleStopped', 'battleResolved']) window.addEventListener(event, clearEntityPlacements);
for (const event of ['combatPaused', 'combatPauseRestored']) window.addEventListener(event, updatePhaserPlacements);
registerCombatState('placements', () => {
  updatePhaserPlacements();
  return [...phaserPlacements.values()].map(entry => ({ entityId: entry.entity.id, visual: { ...entry.visual } }));
}, (saved, { entities }) => {
  clearEntityPlacements();
  document.querySelectorAll('[data-phaser-placement]').forEach(node => node.remove());
  for (const entry of saved) {
    const entity = entities.find(candidate => String(candidate.id) === String(entry.entityId));
    if (entity) animateEntityPlacement(entity, null, null, entry.visual);
  }
});

// Phaser owns the gesture and its temporary preview. The board owns the drop.
// Its input target is the document, so the transparent canvas never covers HTML
// buttons, inventory drops or the existing shaped monster hitboxes.
let boardDragHooks = null, boardDragZone = null, boardDragPending = null, boardDrag = null;
let boardDragClickUntil = 0, boardDragMultiTouch = false;
export const isPhaserBoardDragReady = () => Boolean(boardDragZone?.scene && phaserLayer?.host.isConnected);
function finishPhaserBoardDrag() {
  const drag = boardDrag;
  boardDrag = null; boardDragPending = null;
  if (phaserLayer?.game) phaserLayer.game.canvas.style.pointerEvents = 'none';
  if (drag) {
    drag.image.destroy(); phaserLayer?.scene.textures.remove(drag.texture);
    boardDragClickUntil = performance.now() + 500;
    boardDragHooks?.end();
  }
  hideIdlePhaser();
}
export function cancelPhaserBoardDrag() {
  finishPhaserBoardDrag();
  const input = boardDragZone?.scene?.input;
  if (!input) return;
  input.disable(boardDragZone);
  boardDragZone.input.enabled = true;
  for (const pointer of input.manager.pointers) input.setDragState(pointer, 0);
}
function updatePhaserBoardDrag() {
  if (boardDragPending && !boardDragHooks.valid(boardDragPending.view)) { cancelPhaserBoardDrag(); return; }
  if (!boardDrag) return;
  if (!boardDragHooks.valid(boardDrag.view)) { cancelPhaserBoardDrag(); return; }
  const { pointer, image, offsetX, offsetY } = boardDrag;
  image.setPosition(pointer.x + offsetX, pointer.y + offsetY);
}
export async function configurePhaserBoardDrag(hooks) {
  if (globalThis.__combatSimulation) return;
  boardDragHooks = hooks;
  const layer = await ensurePhaserLayer();
  if (boardDragZone?.scene) return;
  const scene = layer.scene;
  boardDragZone = scene.add.zone(0, 0, 1, 1).setOrigin(0).setName('board-drag-input');
  boardDragZone.setInteractive({
    hitArea: {}, hitAreaCallback: (_area, x, y) => !boardDragMultiTouch && Boolean(boardDragHooks.pick(x, y)),
    draggable: true,
  });
  scene.input.dragDistanceThreshold = 8;
  boardDragZone.on('pointerdown', pointer => {
    if (boardDrag || boardDragPending || !pointer.primaryDown) return;
    const view = boardDragHooks.pick(pointer.x, pointer.y);
    if (view) {
      boardDragPending = { view, pointer, rect: view.source.getBoundingClientRect() };
      // Phaser 3.90 accepts touch movement only above its canvas. Capture the
      // surface for this contact only; HTML hitboxes still choose the drop below it.
      if (pointer.wasTouch) {
        layer.game.canvas.style.pointerEvents = 'auto';
        hideIdlePhaser(); layer.game.loop.wake();
      }
    }
  });
  scene.input.on('dragstart', (pointer, object) => {
    const pending = boardDragPending;
    if (object !== boardDragZone || !pending || pending.pointer !== pointer || !boardDragHooks.valid(pending.view)) return;
    const canvas = createCanvasSnapshot(pending.view.source);
    if (!canvas || !boardDragHooks.begin(pending.view)) return;
    const texture = 'board-drag-preview';
    scene.textures.addImage(texture, canvas);
    const { rect, view } = pending;
    const image = scene.add.image(0, 0, texture).setName(texture).setDepth(100000)
      .setDisplaySize(rect.width, rect.height).setFlipX(String(view.entity.side).toUpperCase() === 'B').setAlpha(.9);
    boardDrag = { ...pending, image, texture, offsetX: rect.left + rect.width / 2 - pointer.downX,
      offsetY: rect.top + rect.height / 2 - pointer.downY };
    updatePhaserBoardDrag(); hideIdlePhaser(); layer.game.loop.wake();
  });
  scene.input.on('drag', (pointer, object) => {
    if (object !== boardDragZone || boardDrag?.pointer !== pointer) return;
    updatePhaserBoardDrag();
    if (boardDrag) boardDragHooks.move(boardDrag.view, pointer.x, pointer.y);
  });
  scene.input.on('dragend', (pointer, object) => {
    if (object !== boardDragZone || boardDrag?.pointer !== pointer) return;
    try {
      if (pointer.event?.type !== 'touchcancel' && !boardDragMultiTouch)
        boardDragHooks.drop(boardDrag.view, pointer.x, pointer.y);
    } finally { finishPhaserBoardDrag(); }
  });
  for (const name of ['pointerup', 'pointerupoutside']) scene.input.on(name, pointer => {
    if (boardDragPending?.pointer === pointer) finishPhaserBoardDrag();
  });
  hideIdlePhaser(); layer.game.scale.refresh(); layer.game.loop.wake();
}
// Gesture cancellation is UI time, including during tactical pause. A gesture is
// never persisted; only an accepted placement becomes a combat action.
window.addEventListener('keydown', event => {
  if (['Escape', 'F5'].includes(event.key)) cancelPhaserBoardDrag();
}, true);
for (const name of ['blur', 'resize', 'pagehide', 'stageInterfaceClosing', 'battleStopped', 'battleResolved', 'combatPaused'])
  window.addEventListener(name, cancelPhaserBoardDrag);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPhaserBoardDrag(); }, true);
document.addEventListener('pointercancel', cancelPhaserBoardDrag, true);
window.addEventListener('mouseout', event => { if (!event.relatedTarget) cancelPhaserBoardDrag(); });
document.addEventListener('touchstart', event => {
  if (event.touches.length > 1) { boardDragMultiTouch = true; cancelPhaserBoardDrag(); }
}, { capture: true, passive: true });
for (const name of ['touchend', 'touchcancel']) document.addEventListener(name, event => {
  if (!event.touches.length) boardDragMultiTouch = false;
}, { passive: true });
document.addEventListener('click', event => {
  if (performance.now() < boardDragClickUntil && event.target.closest?.('#hexGrid')) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);

// Geometry is shared only inside one synchronous Phaser update, never across
// frames: moving targets, board scaling and tactical placement stay live.
let phaserFrameRects = null;
function phaserViewRect(element) {
  if (!element) return null;
  if (!phaserFrameRects) return element.getBoundingClientRect();
  let rect = phaserFrameRects.get(element);
  if (!rect) { rect = element.getBoundingClientRect(); phaserFrameRects.set(element, rect); }
  return rect;
}
function viewCenter(element) {
  if (!element?.isConnected) return null;
  const rect = phaserViewRect(element), { width, height } = viewport();
  return { x: (rect.left + rect.width / 2) / width, y: (rect.top + rect.height / 2) / height };
}
function projectileProfile(attacker, data) {
  const classes = [data.effectProjectile, data.effectProjectileClass, ...(data.effectProjectileClasses || [])].flat().filter(Boolean);
  const natures = data.attacknature ?? data.natures ?? attacker.currentAttack?.attacknature ?? [];
  const flags = getAttackResolutionFlags({ attacknature: natures });
  const lord = getBattleEntityDomPrefix(attacker) === 'lord';
  let color = lord ? 0x080010 : 0xff3028, glow = lord ? 0x8b00ff : 0xff3028;
  if (flags.hasMagical) color = glow = 0x8f5dff;
  if (natures.includes('hybridalDamage')) color = glow = 0xd600ae;
  if (natures.includes('piercingDamage')) color = glow = 0xffda24;
  for (const [effect, core, aura] of [
    ['poison-fx', 0x026800, 0x76ff04], ['brulure-fx', 0x740000, 0xff0000],
    ['heal-fx', 0xcdfdff, 0x00f6ff], ['rez-fx', 0xccfff3, 0xccfff3],
  ]) if (classes.includes(effect)) { color = core; glow = aura; }
  const effect = Object.keys(PROJECTILE_ASSETS).find(key => classes.includes(key));
  if (effect === 'profanation-fx') glow = 0xff0000;
  if (effect === 'jarret-fx') glow = 0xffd800;
  return { color, glow, radius: lord ? 6.5 : 5, effect: effect || null,
    aura: data.aura || null, mysticism: Boolean(data.isLaunchedUnderMysticism) };
}
function hideIdlePhaser() {
  if (!phaserLayer?.game) return;
  const visible = boardDrag || boardDragPending?.pointer.wasTouch || phaserMelees.size || phaserEffects.size || [...phaserFlights.values()].some(entry => entry.record.visual.phase !== 'hidden');
  phaserLayer.host.hidden = !visible;
  if (!visible && !phaserPlacements.size) phaserLayer.game.loop.sleep();
}
function destroyProjectileDisplay(entry) {
  entry.graphic?.destroy(); entry.sprite?.destroy(); entry.impactSprite?.destroy();
}
function removePhaserFlight(entry, status = 'removed') {
  if (phaserFlights.get(entry.record.id) !== entry) return;
  phaserFlights.delete(entry.record.id); clearTimeout(entry.timer);
  destroyProjectileDisplay(entry);
  entry.record.status = status; entry.record.impactTime = clockNow();
  cleanupOldProjectiles(entry.attacker);
  entry.resolve?.(status); hideIdlePhaser();
}
function removePhaserEffect(entry) {
  phaserEffects.delete(entry.id); clearTimeout(entry.timer); destroyProjectileDisplay(entry); hideIdlePhaser();
}
function clearPhaserProjectiles() {
  for (const entry of [...phaserFlights.values()]) removePhaserFlight(entry);
  for (const entry of [...phaserEffects.values()]) removePhaserEffect(entry);
  for (const entry of [...phaserMelees.values()]) removePhaserMelee(entry);
}
for (const event of ['projectileVisualsCleared', 'battleStopped', 'battleResolved']) window.addEventListener(event, clearPhaserProjectiles);
for (const event of ['combatResumed', 'resize']) window.addEventListener(event, () => {
  const wake = () => {
    if (boardDragZone || phaserFlights.size || phaserEffects.size || phaserMelees.size || phaserPlacements.size) phaserLayer?.game?.loop.wake();
  };
  // Resize handlers also rescale the HTML board. Draw after those handlers,
  // including when the combat clock is paused and the scene draws only once.
  if (event === 'resize') globalThis.requestAnimationFrame(wake);
  else wake();
});
function wakeProjectileRenderer() {
  void ensurePhaserLayer().then(layer => {
    hideIdlePhaser();
    if (!layer.host.hidden) layer.game.loop.wake();
  }).catch(error => console.warn('[PhaserProjectile]', error));
}
export function prepareCombatRenderer(effectClasses = []) {
  if (globalThis.__combatSimulation) return;
  void ensurePhaserLayer().then(layer => {
    for (const effect of effectClasses) {
      const asset = PROJECTILE_ASSETS[effect];
      requestProjectileTexture(layer.scene, asset);
      requestProjectileTexture(layer.scene, asset?.impact);
    }
  }).catch(error => console.warn('[PhaserProjectile]', error));
}
function addPhaserEffect(visual, profile, projectileId) {
  const entry = { id: `projectile-effect-${++projectileEffectSequence}`, visual, profile, projectileId };
  phaserEffects.set(entry.id, entry);
  entry.timer = setTimeout(() => removePhaserEffect(entry), Math.max(0, visual.until - clockNow()));
  wakeProjectileRenderer();
  return entry;
}
function disperseProjectile(entry) {
  const visual = entry.record.visual;
  addPhaserEffect({ kind: 'burst', x: visual.x, y: visual.y, angle: visual.angle,
    startTime: clockNow(), until: clockNow() + 720, particleCount: 7 },
    { ...visual.profile, glow: visual.profile.glow || 0x8f5dff }, entry.record.id);
}
function projectileTarget(entry) {
  const flight = entry.flight;
  flight?.sample();
  if (flight?.mode === 'physical') return flight.cellView(flight.aimedHex);
  if (flight?.mode === 'mixed' && flight.guidanceLost) return flight.cellView(flight.lockedHex);
  return entry.target?.nodeType === 1 ? entry.target : getBattleEntityElement(entry.target);
}
function sampleProjectile(entry, timestamp = clockNow(), arriving = false) {
  const visual = entry.record.visual;
  if (visual.phase !== 'flight') return false;
  const target = viewCenter(projectileTarget(entry));
  if (entry.flight?.expired()) { removePhaserFlight(entry); return false; }
  if (entry.flight?.consumeMagicalLoss()) {
    disperseProjectile(entry);
    visual.remnantNature = entry.flight.remnantNature;
    visual.profile.color = visual.remnantNature === 'piercing' ? 0xb99a00 : 0xb00000;
    visual.profile.glow = visual.remnantNature === 'piercing' ? 0xffda24 : 0xf00000;
  }
  if (entry.flight?.cancelled()) {
    if (entry.flight.mode === 'magical' && entry.flight.casterLost) disperseProjectile(entry);
    visual.phase = 'hidden'; destroyProjectileDisplay(entry);
    entry.resolve?.('dispelled');
    // Keep the data until the combat scheduler settles, including across F5.
    if (!entry.impactPromise) removePhaserFlight(entry, 'dispelled');
    hideIdlePhaser(); return false;
  }
  if (!target) return false;
  const { width, height } = viewport();
  const dx = target.x - visual.x, dy = target.y - visual.y;
  if (dx || dy) visual.angle = Math.atan2(dy * height, dx * width);
  const remaining = visual.startTime + visual.duration - visual.lastTime;
  const step = arriving ? 1 : Math.min(1, Math.max(0, timestamp - visual.lastTime) / Math.max(1, remaining));
  visual.x += dx * step; visual.y += dy * step;
  visual.lastTime = timestamp;
  visual.progress = Math.min(1, Math.max(0, (timestamp - visual.startTime) / visual.duration));
  return true;
}
function settleProjectile(entry, status = 'hit') {
  if (phaserFlights.get(entry.record.id) !== entry) return;
  sampleProjectile(entry, clockNow(), true);
  if (phaserFlights.get(entry.record.id) !== entry) return;
  const visual = entry.record.visual;
  if (visual.phase !== 'hidden' && status !== 'dispelled' && status !== 'removed' && status !== 'error') {
    const missed = status === 'miss' || status === 'dodged', rect = projectileTarget(entry)?.getBoundingClientRect();
    addPhaserEffect({ ...visual, kind: missed ? 'miss' : 'hit', startTime: clockNow(),
      until: clockNow() + (missed ? 220 : 80),
      overshoot: Math.max(63, Math.hypot(rect?.width || 0, rect?.height || 0) * .875) }, visual.profile, entry.record.id);
  }
  removePhaserFlight(entry, status);
}
const projectileTextures = new Map();
function requestProjectileTexture(scene, asset) {
  if (!asset) return null;
  const key = `projectile:${asset.file}`;
  if (!projectileTextures.has(key)) {
    const state = {};
    projectileTextures.set(key, state);
    void loadSpriteAtlas(`./media/assets/projectiles/${asset.file}`, asset.width, asset.height).then(atlas => {
      if (!scene.sys.isActive()) return;
      const texture = scene.textures.addImage(key, atlas.canvas);
      for (let i = 0; i < atlas.count; i++) texture.add(i, 0,
        (i % atlas.columns) * atlas.width, Math.floor(i / atlas.columns) * atlas.height, atlas.width, atlas.height);
      state.atlas = atlas;
      // A paused cold restore still needs one frame once its media are ready.
      phaserLayer?.game?.loop.wake();
    }).catch(error => console.warn('[ProjectileTexture]', asset.file, error));
  }
  return { key, ...projectileTextures.get(key) };
}
function drawProjectileSprite(entry, property, scene, asset, elapsed, x, y, angle, alpha = 1, scale = 1) {
  const texture = requestProjectileTexture(scene, asset);
  if (!texture?.atlas) return false;
  let time = Math.max(0, elapsed) % texture.atlas.total, frame = 0;
  while (frame < texture.atlas.count - 1 && time >= texture.atlas.durations[frame]) time -= texture.atlas.durations[frame++];
  const sprite = entry[property] ||= scene.add.image(0, 0, texture.key, frame).setName(entry.record?.id || entry.projectileId || entry.id);
  sprite.setFrame(frame).setPosition(x, y + (asset.offsetY || 0)).setRotation(angle).setAlpha(alpha).setScale(scale);
  const remnant = entry.record?.visual.remnantNature || entry.visual?.remnantNature;
  sprite.setTint(remnant ? (remnant === 'piercing' ? 0xffda24 : 0xf00000) : 0xffffff);
  return true;
}
function drawProjectile(entry, scene) {
  const visual = entry.record?.visual || entry.visual;
  if (visual.phase === 'hidden') return;
  const { width, height } = viewport(), profile = visual.profile || entry.profile;
  const elapsed = clockNow() - visual.startTime;
  const graphic = entry.graphic ||= scene.add.graphics().setName(entry.record?.id || entry.projectileId || entry.id);
  let x = visual.x * width, y = visual.y * height, alpha = 1;
  graphic.clear();
  if (visual.kind === 'burst') {
    // Decorative spread never consumes the combat's random-number stream.
    for (let i = 0; i < visual.particleCount; i++) {
      const progress = Math.max(0, Math.min(1, (elapsed - (i % 3) * 14) / (480 + (i * 37 % 210))));
      const angle = visual.angle - .75 + 1.5 * i / (visual.particleCount - 1);
      const distance = (56 + i * 19 % 48) * (1 - (1 - progress) ** 2);
      const px = x + Math.cos(angle) * distance, py = y + Math.sin(angle) * distance;
      graphic.fillStyle(profile.glow, (1 - progress) * .18).fillCircle(px, py, 6);
      graphic.fillStyle(profile.glow, 1 - progress).fillCircle(px, py, (2 + i % 3) * (1 - progress * .88));
    }
    return;
  }
  if (visual.kind === 'miss') {
    const progress = Math.min(1, elapsed / 220);
    x += Math.cos(visual.angle) * visual.overshoot * progress;
    y += Math.sin(visual.angle) * visual.overshoot * progress; alpha = 1 - progress;
  }
  const aura = profile.aura === 'ambidextry' ? 0xedff00 : profile.mysticism ? 0xd2ebff : profile.glow;
  graphic.setPosition(x, y).setRotation(visual.angle).setAlpha(alpha);
  graphic.lineStyle(6, aura, .18).lineBetween(-26, 0, 0, 0);
  graphic.lineStyle(2, aura, .75).lineBetween(-20, 0, 0, 0);
  const asset = PROJECTILE_ASSETS[profile.effect];
  graphic.fillStyle(aura, .12).fillCircle(0, 0, asset ? Math.min(asset.width, asset.height) * .4 : profile.radius + 7);
  graphic.fillStyle(aura, .3).fillCircle(0, 0, profile.radius + 3);
  const spin = profile.effect === 'jarret-fx' ? elapsed / 700 * Math.PI * 2 : visual.angle;
  const scale = profile.effect === 'profanation-fx' ? .8 + .2 * Math.sin(elapsed / 500 * Math.PI * 2)
    : profile.effect === 'jarret-fx' ? 1 + .05 * Math.sin(elapsed / 1000 * Math.PI) ** 2 : 1;
  if (!drawProjectileSprite(entry, 'sprite', scene, asset, elapsed, x, y, spin, alpha, scale)) {
    graphic.fillStyle(profile.color, 1).fillCircle(0, 0, profile.radius);
    graphic.fillStyle(0xfff2dd, 1).fillCircle(1, -1, 2);
  }
  if (visual.kind === 'hit') drawProjectileSprite(entry, 'impactSprite', scene, asset?.impact, elapsed, x, y, 0);
  else if (asset?.impact) requestProjectileTexture(scene, asset.impact);
}

async function ensurePhaserLayer() {
  if (phaserReady) return phaserReady;
  phaserReady = (async () => {
    // Local, pinned dependency; neither menus nor simulation download or boot it.
    const Phaser = await import('../../vendor/phaser-3.90.0.esm.min.js');
    const host = document.createElement('div');
    host.id = 'phaser-projectiles'; host.setAttribute('aria-hidden', 'true'); host.hidden = true;
    document.body.append(host);
    const layer = phaserLayer = { host, game: null, scene: null };
    await new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error('Initialisation Phaser trop longue.')), 10000);
      try {
        layer.game = new Phaser.Game({
          type: Phaser.AUTO, parent: host, ...viewport(), transparent: true, banner: false, autoFocus: false,
          audio: { noAudio: true }, input: { keyboard: false, gamepad: false, windowEvents: false,
            mouse: { target: document, preventDefaultDown: false, preventDefaultUp: false, preventDefaultMove: false },
            touch: { target: document, capture: false } },
          scale: { mode: Phaser.Scale.NONE }, render: { antialias: true },
          seed: ['dark-pit-projectiles'],
          scene: {
            create() {
              layer.scene = this;
              layer.game = this.game;
              this.game.canvas.setAttribute('aria-hidden', 'true');
              globalThis.clearTimeout(timeout); resolve();
              hideIdlePhaser();
            },
            update() {
              const { width, height } = viewport();
              if (this.scale.width !== width || this.scale.height !== height) this.scale.resize(width, height);
              updatePhaserPlacements();
              updatePhaserBoardDrag();
              phaserFrameRects = new Map();
              try {
                const flights = [...phaserFlights.values()], melees = [...phaserMelees.values()];
                if (!isCombatPaused()) {
                  for (const entry of flights) sampleProjectile(entry);
                  for (const entry of melees) samplePhaserMelee(entry);
                }
                for (const entry of flights) {
                  if (phaserFlights.get(entry.record.id) === entry) drawProjectile(entry, this);
                }
                for (const entry of melees) {
                  if (phaserMelees.get(entry.id) === entry) drawPhaserMelee(entry);
                }
                for (const entry of phaserEffects.values()) drawProjectile(entry, this);
              } finally { phaserFrameRects = null; }
              hideIdlePhaser();
              if (isCombatPaused() && !boardDrag) this.game.loop.sleep();
            },
          },
        });
      } catch (error) { globalThis.clearTimeout(timeout); reject(error); }
    });
    return layer;
  })().catch(error => {
    if (phaserLayer) {
      phaserLayer.game?.destroy(true); phaserLayer.game?.loop.wake(); phaserLayer.host.remove();
    }
    phaserLayer = null; phaserReady = null; projectileTextures.clear();
    throw error;
  });
  return phaserReady;
}


export async function animationProjectile(attacker, target, onHit, data = {}) {
  if (globalThis.__combatSimulation) return 'hidden';
  data ||= {};
  const { flight, impactPromise, restoredVisual, ...metadata } = data;
  const from = restoredVisual?.from || viewCenter(getBattleEntityElement(attacker));
  if (!from) return 'cancelled';
  const duration = Math.max(1, Number(data.executionTime ?? data.travelDuration ?? data.duration
    ?? attacker.currentAttack?.executionTime ?? attacker.executionTime) || 1000);
  const now = clockNow();
  const visual = restoredVisual || { renderer: 'phaser', phase: 'flight', from, x: from.x, y: from.y,
    angle: 0, progress: 0, startTime: now, lastTime: now, duration, profile: projectileProfile(attacker, data) };
  const record = { ...metadata, id: data.id || `projectile_${crypto.randomUUID()}`,
    attackerId: attacker.id, targetId: target.id, attackId: data.attackId ?? attacker.currentAttack?.attackId,
    flightMode: flight?.mode, startTime: visual.startTime, status: 'in-flight', visual };
  attacker.projectiles ||= [];
  cleanupOldProjectiles(attacker);
  attacker.projectiles = attacker.projectiles.filter(candidate => candidate.id !== record.id);
  attacker.projectiles.push(record);
  const entry = { record, attacker, target, flight, impactPromise };
  phaserFlights.set(record.id, entry);
  const done = new Promise(resolve => { entry.resolve = resolve; });
  if (impactPromise) {
    impactPromise.then(status => settleProjectile(entry, status), error => {
      removePhaserFlight(entry, 'error'); console.error('[ProjectileImpact]', error);
    });
  } else {
    // Scripted visuals use the combat clock too, even if WebGL has not booted.
    entry.timer = setTimeout(async () => {
      if (phaserFlights.get(record.id) !== entry) return;
      sampleProjectile(entry, clockNow(), true);
      if (phaserFlights.get(record.id) !== entry) return;
      try { settleProjectile(entry, await onHit?.() || 'hit'); }
      catch (error) { removePhaserFlight(entry, 'error'); console.error('[ProjectileImpact]', error); }
    }, Math.max(0, visual.startTime + visual.duration - now));
  }
  wakeProjectileRenderer();
  return done;
}

// Active flights already save their visual through attackExecution. Only the
// detached bursts and short impact/miss tails belong to this rendering section.
registerCombatState('projectile-effects', () => [...phaserEffects.values()].map(entry => ({
  visual: entry.visual, profile: entry.profile, projectileId: entry.projectileId,
})), effects => {
  for (const entry of [...phaserEffects.values()]) removePhaserEffect(entry);
  for (const effect of effects || []) addPhaserEffect(effect.visual, effect.profile, effect.projectileId);
});
// Movement feedback remains in the combat system; Phaser samples visible targets.
export function notifyProjectileTargetMoved(targetOrId, movementEffect = null, movementOrigin = 'automatic') {
  if (targetOrId && typeof targetOrId === 'object') {
    applyMovementDestabilisation(targetOrId, movementEffect, movementOrigin);
    wakeFromMovement(targetOrId);
  }
  const domId = String(targetOrId?.id || '');
  const targetId = targetOrId?.nodeType === 1
    ? domId.match(/^(?:Box_Entite_|sbire_|lord_)(.+)$/)?.[1] ?? targetOrId.dataset?.entityId ?? targetOrId.dataset?.position ?? domId
    : typeof targetOrId === 'object' ? targetOrId?.id : targetOrId;
  if (targetId == null) return 0;
  const count = [...phaserFlights.values(), ...phaserMelees.values()]
    .filter(entry => String(entry.target?.id) === String(targetId)).length;
  window.dispatchEvent(new CustomEvent('entityCombatInteraction', {
    detail: { entity: targetOrId?.stats ? targetOrId : null, entityId: targetId, kind: 'movement' },
  }));
  return count;
}
export function notifyAllProjectileTargetsMoved() {
  return phaserFlights.size + phaserMelees.size;
}

document.addEventListener('projectileTargetsMoved', notifyAllProjectileTargetsMoved);

export function clearProjectileEffects(entityList = []) {
    window.dispatchEvent(new Event('projectileVisualsCleared'));

    [...activeMeleeAnimations.values()]
        .flatMap(controllers => [...controllers])
        .forEach(controller => controller?.cancel?.());
    activeMeleeAnimations.clear();
    meleeOriginalVisibilityLocks.clear();
    [...meleeOriginalRecoveryAnimations.keys()]
        .forEach(key => cancelMeleeOriginalRecovery(key, true));

    if (!Array.isArray(entityList)) return;

    entityList.forEach(entity => {
        if (Array.isArray(entity?.projectiles)) {
            entity.projectiles.length = 0;
        }
    });
}

function cleanupOldProjectiles(attackerObj) {
    if (!attackerObj || !Array.isArray(attackerObj.projectiles)) {
        return;
    }

    const now = clockNow();

    attackerObj.projectiles = attackerObj.projectiles.filter((projectile) => {
        if (!projectile) return false;

        if (projectile.status === "in-flight") {
            return true;
        }

        if (projectile.status === "hit" && projectile.impactTime) {
            return now - projectile.impactTime < 5000;
        }

        return false;
    });
}
// All melee visuals share the projectile scene and the combat clock.
const MELEE_DEATH_ASSET = { file: '../effects/death-blood.gif', width: 110, height: 93 };
// Use the board's rendered frame, with one scale for both axes. The UI can
// scale inside a tall mobile viewport; viewport height must not stretch the copy.
function meleeViewFrame(root) {
  const rect = phaserViewRect(root);
  return rect?.width > 0 ? rect : { left: 0, top: 0, width: viewport().width };
}
function meleeTargetView(target) {
  return target?.nodeType === 1 ? target : document.getElementById(`spriteCanvas_${target?.id}`)
    || getBattleEntityElement(target);
}
function meleeViewCenter(element, frame) {
  if (!element?.isConnected) return null;
  const rect = phaserViewRect(element);
  return { x: (rect.left + rect.width / 2 - frame.left) / frame.width,
    y: (rect.top + rect.height / 2 - frame.top) / frame.width };
}
function returnPhaserMeleeOriginal(entry, forceVisible = false) {
  const visual = entry.visual;
  if (visual.released && !forceVisible) return;
  visual.released = true;
  const token = entry.visibilityToken;
  entry.visibilityToken = null;
  const stillHidden = releaseMeleeOriginalVisibility(entry.attacker.id, token, forceVisible, Boolean(token) && !forceVisible);
  const sprite = document.getElementById(`DragSprite_${entry.attacker.id}`);
  if (token && !stillHidden && !forceVisible && sprite?.isConnected) {
    startMeleeOriginalRecovery(entry.attacker.id, sprite, MELEE_ORIGINAL_RECOVERY_DURATION);
  }
}
function removePhaserMelee(entry) {
  if (phaserMelees.get(entry.id) !== entry) return;
  phaserMelees.delete(entry.id);
  clearTimeout(entry.returnTimer); clearTimeout(entry.endTimer); clearTimeout(entry.impactTimer);
  const dead = entry.attacker.isDEAD || entry.attacker.hasFled;
  returnPhaserMeleeOriginal(entry, dead);
  unregisterActiveMeleeAnimation(entry.attacker.id, entry.controller);
  destroyProjectileDisplay(entry);
  releaseMeleeTexture(entry.texture);
  const sprite = document.getElementById(`DragSprite_${entry.attacker.id}`);
  if (sprite && !dead && !hasMeleeOriginalVisibilityLock(entry.attacker.id)
    && !meleeOriginalRecoveryAnimations.has(String(entry.attacker.id))) sprite.classList.add('iddle');
  hideIdlePhaser();
}
function abortPhaserMelee(entry) {
  if (entry.visual.phase !== 'flight') return;
  entry.visual.phase = 'cancelled';
  entry.visual.phaseAt = clockNow();
  returnPhaserMeleeOriginal(entry, true);
  clearTimeout(entry.endTimer);
  entry.endTimer = setTimeout(() => removePhaserMelee(entry), 1700);
}
function samplePhaserMelee(entry, arriving = false) {
  const visual = entry.visual;
  if (visual.phase !== 'flight') return;
  if (entry.flight?.expired()) { removePhaserMelee(entry); return; }
  if (entry.flight?.cancelled() || !entry.flight && (entry.attacker.isDEAD || entry.attacker.hasFled)) {
    abortPhaserMelee(entry); return;
  }
  const frame = meleeViewFrame(entry.root);
  const target = meleeViewCenter(meleeTargetView(entry.target), frame);
  if (target) visual.to = target;
  const progress = arriving ? 1 : Math.min(1, Math.max(0, (clockNow() - visual.startedAt) / visual.duration));
  const travel = interpolateMeleeMotionValue(progress, entry.motion);
  const step = arriving ? 1 : Math.max(0, travel - visual.travel) / Math.max(.000001, 1 - visual.travel);
  const destination = visual.closeRange
    ? { x: visual.from.x + (visual.to.x - visual.from.x) * .62, y: visual.from.y + (visual.to.y - visual.from.y) * .62 }
    : visual.to;
  const dx = destination.x - visual.x, dy = destination.y - visual.y;
  if (dx || dy) visual.angle = Math.atan2(dy, dx);
  visual.x += dx * step; visual.y += dy * step;
  visual.progress = progress; visual.travel = travel;
}
function settlePhaserMeleeImpact(entry) {
  const visual = entry.visual;
  if (phaserMelees.get(entry.id) !== entry || visual.phase !== 'flight' || visual.impactOutcome === null) return;
  const arrival = visual.startedAt + visual.duration, remaining = arrival - clockNow();
  clearTimeout(entry.impactTimer);
  if (remaining > 0) {
    entry.impactTimer = setTimeout(() => settlePhaserMeleeImpact(entry), remaining);
    return;
  }
  // Early event confirmations wait for arrival; late damage never replays an
  // already expired visual, including after a stalled browser frame.
  if (clockNow() >= arrival + 180) { removePhaserMelee(entry); return; }
  samplePhaserMelee(entry, true);
  if (phaserMelees.get(entry.id) !== entry || visual.phase !== 'flight') return;
  visual.phase = visual.impactOutcome ? 'hit' : 'miss'; visual.phaseAt = arrival;
  returnPhaserMeleeOriginal(entry);
  clearTimeout(entry.endTimer);
  entry.endTimer = setTimeout(() => removePhaserMelee(entry), Math.max(0, arrival + 180 - clockNow()));
  phaserLayer?.game?.loop.wake();
}
function drawPhaserMelee(entry) {
  if (!entry.sprite) return;
  const visual = entry.visual, frame = meleeViewFrame(entry.root);
  const elapsed = Math.max(0, clockNow() - visual.phaseAt);
  const tail = visual.phase === 'flight' || visual.phase === 'cancelled' ? 0 : Math.min(1, elapsed / 180);
  // A late combat result must not leave a clone parked over the target.
  const alpha = visual.phase === 'flight'
    ? 1 - Math.min(1, Math.max(0, clockNow() - visual.startedAt - visual.duration) / 180)
    : 1 - tail;
  const x = frame.left + visual.x * frame.width, y = frame.top + visual.y * frame.width;
  const scale = 1 + .06 * Math.sin(visual.progress * Math.PI) + .1 * visual.progress ** 4;
  const effectScale = visual.width * frame.width / 70;
  const offset = visual.phase === 'miss' ? tail * 38 * effectScale : 0;
  entry.sprite.setPosition(x + Math.cos(visual.angle) * offset, y + Math.sin(visual.angle) * offset)
    .setDisplaySize(visual.width * frame.width * scale, visual.height * frame.width * scale)
    .setAlpha(alpha).setTint(visual.phase === 'cancelled' ? 0xff4545 : 0xffffff);
  const graphic = entry.graphic;
  graphic.clear().setPosition(x, y).setRotation(visual.angle).setScale(effectScale).setAlpha(alpha);
  if (visual.phase === 'cancelled') {
    if (elapsed < 1000) entry.sprite.setPosition(x + Math.sin(elapsed * .15) * 2 * effectScale, y);
    else {
      entry.sprite.setAlpha(0);
      drawProjectileSprite(entry, 'impactSprite', entry.scene, MELEE_DEATH_ASSET, elapsed - 1000,
        x, y, 0, 1, visual.width * frame.width / MELEE_DEATH_ASSET.width);
    }
    return;
  }
  if (visual.isAmbidextry) {
    graphic.lineStyle(7, 0xedff00, .2).strokeCircle(0, 0, 28);
    graphic.lineStyle(2, 0xedff00, .7).strokeCircle(0, 0, 30);
  }
  if (!visual.closeRange && visual.phase !== 'cancelled') {
    graphic.lineStyle(12, visual.color, .12).lineBetween(-65, 0, -10, 0);
    graphic.lineStyle(3, visual.color, .6).lineBetween(-50, 0, -8, 0);
  }
  if (visual.phase === 'hit') {
    graphic.lineStyle(3, visual.color, 1 - tail).strokeCircle(0, 0, 8 + 30 * tail);
    graphic.lineStyle(2, 0xffffff, 1 - tail);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3, distance = 12 + tail * 40;
      graphic.lineBetween(Math.cos(angle) * distance, Math.sin(angle) * distance,
        Math.cos(angle) * (distance + 12), Math.sin(angle) * (distance + 12));
    }
  }
}
export function animationMelee(attacker, target, isAmbidextry = false, options = {}) {
  if (globalThis.__combatSimulation) return null;
  const saved = options.resume;
  const source = document.getElementById(`spriteCanvas_${attacker.id}`);
  const body = document.getElementById(`DragSprite_${attacker.id}`);
  const root = source?.closest('#game-container');
  const frame = meleeViewFrame(root);
  const from = saved?.from || meleeViewCenter(source, frame);
  const to = saved?.to || meleeViewCenter(meleeTargetView(target), frame);
  if (!source || !body || !from || !to) return null;
  if (!isAmbidextry && !saved) cancelActiveMeleeAnimations(attacker.id);
  if (!saved && !isAmbidextry) {
    cancelMeleeOriginalRecovery(attacker.id, true);
    unlockMeleePostRecoveryOpacity(attacker.id, body);
  }
  const rect = source.getBoundingClientRect();
  const distance = Math.hypot(to.x - from.x, to.y - from.y) * frame.width;
  const duration = Math.max(isAmbidextry ? 120 : 200,
    Number(options.duration) || Number(attacker.executionTime) || Number(attacker.currentAttack?.executionTime) || 1000);
  const attack = options.flight?.attack || options.attack || attacker.currentAttack || {};
  const profile = projectileProfile(attacker, { ...attack, effectProjectileClasses: options.effectClasses,
    aura: isAmbidextry ? 'ambidextry' : null });
  // Keep the exact neutral pixels for rendering; encode PNG only when saving.
  // A static image texture avoids CanvasTexture's unused CPU pixel readback.
  // The original stays visible until the Phaser texture is actually ready.
  if (!saved && !activeSnapshotDamageImpacts.has(source)) ensureOriginalCanvasImage(source);
  const neutral = saved ? null : getNeutralMeleeCloneSource(source);
  if (!saved && !neutral) return null;
  const visual = saved || {
    renderer: 'phaser', phase: 'flight', phaseAt: clockNow(), startedAt: clockNow(), duration,
    from, to, x: from.x, y: from.y, angle: 0, progress: 0, travel: 0,
    width: rect.width / frame.width, height: rect.height / frame.width,
    isAmbidextry, profile, impactOutcome: null,
    longTravel: Math.min(1, Math.max(0, (distance - 220) / 520)),
    closeRange: distance <= Math.min(64, Math.max(28, rect.width * .42)),
    flipX: String(attacker.side).toUpperCase() === 'B',
    previousOpacity: meleeOriginalVisibilityLocks.get(String(attacker.id))?.originalOpacity ?? body.style.getPropertyValue('opacity'),
    previousPriority: body.style.getPropertyPriority('opacity'),
    released: false, color: isAmbidextry ? 0xedff00 : profile.mysticism ? 0xd2ebff : profile.glow,
  };
  if (saved && !visual.released) {
    if (visual.previousOpacity) body.style.setProperty('opacity', visual.previousOpacity, visual.previousPriority);
    else body.style.removeProperty('opacity');
  }
  const entry = { id: options.flightId || `melee-${crypto.randomUUID()}`, root, attacker, target, flight: options.flight, visual,
    motion: MELEE_CHARGE_MOTION_SAMPLES.map(([at, short, long]) => [at, short + (long - short) * visual.longTravel]) };
  const controller = entry.controller = {
    flightId: entry.id, renderer: 'phaser', get ready() { return Boolean(entry.sprite); },
    bindFlight(flight) { entry.flight = flight; },
    snapshot: () => {
      visual.pixels ??= neutral.toDataURL();
      return { renderer: 'phaser', attacker: attacker.id, target: combatReference(target), isAmbidextry,
        options: { duration: visual.duration, flightId: entry.id }, resume: visual };
    },
    cancel: () => removePhaserMelee(entry), abortOnDeath: () => abortPhaserMelee(entry),
    showOriginalForImpact() { returnPhaserMeleeOriginal(entry); return true; },
    resolveImpact(didHit) {
      if (phaserMelees.get(entry.id) !== entry || visual.phase !== 'flight') return;
      visual.impactOutcome = Boolean(didHit);
      settlePhaserMeleeImpact(entry);
    },
  };
  phaserMelees.set(entry.id, entry);
  registerActiveMeleeAnimation(attacker.id, controller);
  if (!visual.released) entry.returnTimer = setTimeout(() => returnPhaserMeleeOriginal(entry),
    Math.max(0, visual.startedAt + visual.duration * (visual.isAmbidextry ? .18 : .35) - clockNow()));
  entry.endTimer = setTimeout(() => removePhaserMelee(entry), Math.max(0,
    (visual.phase === 'flight' ? visual.startedAt + visual.duration + 2000 : visual.phaseAt + (visual.phase === 'cancelled' ? 1700 : 180)) - clockNow()));
  if (visual.impactOutcome !== null) settlePhaserMeleeImpact(entry);
  void ensurePhaserLayer().then(async layer => {
    if (phaserMelees.get(entry.id) !== entry) return;
    let canvas = neutral;
    if (!canvas) {
      const bitmap = new Image(); bitmap.src = visual.pixels; await bitmap.decode();
      canvas = document.createElement('canvas'); canvas.width = bitmap.naturalWidth; canvas.height = bitmap.naturalHeight;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
    }
    if (phaserMelees.get(entry.id) !== entry) return;
    requestProjectileTexture(layer.scene, MELEE_DEATH_ASSET);
    entry.scene = layer.scene; entry.texture = acquireMeleeTexture(layer.scene, canvas);
    entry.textureKey = entry.texture.key;
    entry.graphic = layer.scene.add.graphics().setName(entry.id);
    entry.sprite = layer.scene.add.image(0, 0, entry.textureKey).setName(entry.id).setFlipX(visual.flipX);
    if (!visual.released && visual.phase === 'flight' && !attacker.isDEAD) {
      body.classList.remove('iddle');
      entry.visibilityToken = acquireMeleeOriginalVisibility(attacker.id, body);
    }
    hideIdlePhaser(); layer.game.loop.wake();
  }).catch(error => { removePhaserMelee(entry); console.warn('[PhaserMelee]', error); });
  return controller;
}

export function RunawayAnimation(entite) {
    const imgContainer = document.getElementById(`imgContainer_${entite.id}`);
    const sprite = document.getElementById(`DragSprite_${entite.id}`);
    let effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);

    if (!sprite || !imgContainer) {
        console.warn(`⚠️ Élément manquant pour ${entite.name} (${entite.id})`);
        return;
    }

    if (!effectsContainer) {
        console.warn(`⚠️ #effectsContainer_${entite.id} introuvable. Création.`);
        effectsContainer = document.createElement("div");
        effectsContainer.id = `effectsContainer_${entite.id}`;
        effectsContainer.className = "effects-container";
        sprite.parentNode?.appendChild(effectsContainer);
    }

    imgContainer.classList.add("flip-horizontal");

    sprite.classList.remove("iddle");
    sprite.classList.add("runaway");

    let recoveryGif = effectsContainer.querySelector(".recoveryGif");

    if (!recoveryGif) {
        recoveryGif = document.createElement("img");
        recoveryGif.className = "recoveryGif";
        recoveryGif.style.opacity = "1";
        effectsContainer.appendChild(recoveryGif);
    }

    playCachedGif(recoveryGif, `./media/assets/effects/recovery.gif`);

    sprite.classList.add("runaway-animate");
}

export function runawayInfosBulle(entite, type) {
    const effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);
    const statusBar = document.getElementById(`statusBar_${entite.id}`);

    if (!effectsContainer) {
        console.warn(`⚠️ effectsContainer introuvable pour ${entite.name}`);
        return;
    }

    if (!statusBar) {
        console.warn(`⚠️ statusBar introuvable pour ${entite.name}`);
        return;
    }

    // Supprime l'ancienne bulle si présente
    const existingInfo = effectsContainer.querySelector('.runaway-info');
    if (existingInfo) existingInfo.remove();

    // Supprime les anciens textes de fuite
    const existingText = statusBar.querySelector('.hudbattletexte.runaway');
    if (existingText) existingText.remove();

    const infoBulle = document.createElement("div");
    infoBulle.classList.add("runaway-info");

    if (['preparation', 'fail', 'success'].includes(type)) {
        infoBulle.classList.add(type);
    } else {
        console.warn(`⚠️ Type inconnu dans runawayInfosBulle : ${type}`);
    }

    effectsContainer.appendChild(infoBulle);

    // === Création du texte HUD ===
    const texteRunaway = document.createElement("div");
    texteRunaway.classList.add("hudbattletexte", "runaway");
    texteRunaway.innerText = {
        preparation: "Fuite en cours...",
        fail: "Fuite échouée !",
        success: "Fuite réussie !"
    }[type] || "";
    statusBar.appendChild(texteRunaway);

    // === Nettoyage ===
    if (type === 'fail') {
        setTimeout(() => {
            infoBulle.remove();
            texteRunaway.remove();
        }, 2500);
        removeCombatVisualAfter(infoBulle, 2500); removeCombatVisualAfter(texteRunaway, 2500);
    }

    if (type === 'success') {
        const duration = entite.runawayLoopRecuperation || Number(getSafe(entite, "speed", 1000)) || 1000;
        setTimeout(() => {
            infoBulle.remove();
            texteRunaway.remove();
        }, duration);
    }

    if (type === 'preparation' || type === 'success') {
        const checkInterval = setInterval(() => {
            if (entite.isDEAD || !infoBulle.isConnected || !texteRunaway.isConnected) {
                infoBulle.remove();
                texteRunaway.remove();
                clearInterval(checkInterval);
            }
        }, 200);
    }
}


export function playRunawaySuccessAnimation() {
    // 1. Afficher le message
    const message = document.createElement('div');
    message.textContent = 'Fuite réussie !';
    message.classList.add('IngameAlert', 'runaway-msg');
    document.body.appendChild(message);

    // 2. Attendre 2 secondes
    setTimeout(() => {
        // 3. Créer le fond noir
        const overlay = document.createElement('div');
        overlay.classList.add('fade-to-black');
        document.body.appendChild(overlay);

        // 4. Supprimer le message de fuite
        message.remove();

        // 5. Attendre que le fondu soit terminé (1s) avant de quitter le niveau
        setTimeout(() => {
            QuitCurrentLevel();

            // 6. Faire disparaître le fond noir avec fondu
            overlay.classList.add('fade-out');
           setTimeout(() => {
    overlay.remove();
}, 2000);
 }, 1000); // Fin du fondu noir (1s)
 }, 2000); // Délai après affichage du message (2s)
}

export function orderAnimation(entite, saved = null) {
    entite.stopOrderAnimation?.();
    const effects = document.getElementById(`effectsContainer_${entite.id}`);
    if (!effects) return;
    const run = beginCanvasRun('orderAnimation', entite.id, {}, saved);
    const endAt = saved?.state.endAt ?? clockNow() + (entite.orderDecisionTimer || 2000);
    let visible = saved?.state.visible ?? false;
    let exclamation = saved && effects.querySelector('.order-exclamation');
    if (!exclamation) {
        exclamation = document.createElement('div'); exclamation.className = 'order-exclamation';
        exclamation.textContent = '!'; effects.append(exclamation);
    }
    const canvas = document.getElementById(`spriteCanvas_${entite.id}`), ctx = canvas?.getContext('2d');
    if (canvas && !originalImages.has(canvas)) originalImages.set(canvas, createCanvasSnapshot(canvas));
    const interval = setIntervalFrom(() => {
        if (canvas && ctx) {
            if (visible) restoreCanvasSnapshot(canvas, ctx, originalImages.get(canvas));
            else entiteTinter(canvas, '255, 255, 255', 0.3);
            visible = !visible;
        }
    }, 80, saved?.pulseRemaining ?? 80);
    run.capture = () => ({ endAt, visible }); run.pulseRemaining = () => remainingCombatTimer(interval);
    const sprite = document.getElementById(`DragSprite_${entite.id}`);
    sprite?.classList.remove('iddle'); sprite?.classList.add('order');
    removeCombatVisualAfter(exclamation, Math.max(0, endAt - clockNow()));
    const timeout = setTimeout(() => stop(), Math.max(0, endAt - clockNow()));
    function stop() {
        clearTimeout(timeout);
        clearInterval(interval); finishCanvasRun(run);
        if (canvas && ctx) restoreCanvasSnapshot(canvas, ctx, originalImages.get(canvas));
        exclamation.remove();
        sprite?.classList.remove('order');
        if (entite.stopOrderAnimation === stop) delete entite.stopOrderAnimation;
    }
    entite.stopOrderAnimation = stop;
    return stop;
}
export function animateMysticism(targetId, tranceDuration, saved = null) {
  const visualRun = beginCanvasRun('animateMysticism', targetId, { tranceDuration }, saved);
  const safeTranceDuration = Number(tranceDuration) || 0;

  if (safeTranceDuration <= 0) {
    console.warn(`⚠️ Durée Mysticisme invalide pour ${targetId} : ${tranceDuration}`);
    return null;
  }

  const canvas = document.getElementById(`spriteCanvas_${targetId}`);

  if (!canvas) {
    console.warn(`⚠️ Canvas non trouvé pour Mysticisme : ${targetId}`);
    return null;
  }

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    console.error(`❌ Impossible d'obtenir le contexte 2D pour Mysticisme : ${targetId}`);
    return null;
  }

  if (!originalImages.has(canvas)) {
    originalImages.set(canvas, createCanvasSnapshot(canvas));
  }

  const sprite = document.getElementById(`DragSprite_${targetId}`);

  let effectsContainer = document.getElementById(`effectsContainer_${targetId}`);

  if (!effectsContainer) {
    if (!sprite || !sprite.parentNode) {
      console.warn(`⚠️ Impossible de créer effectsContainer pour Mysticisme : ${targetId}`);
      return null;
    }

    effectsContainer = document.createElement("div");
    effectsContainer.id = `effectsContainer_${targetId}`;
    effectsContainer.className = "effects-container";
    sprite.parentNode.appendChild(effectsContainer);
  }

const entryDuration = 50;
const entryStartTime = saved?.state?.entryStartTime ?? (clockNow());
const maxEntryOpacity = 0.6;
const tranceTintMinOpacity = 0.16;
const tranceTintMaxOpacity = 0.34;
const fadeOutDuration = 50;

  let stopped = false;
  let mysticismVFX = null;
  let autoStopTimeout = null;
  let fadeOutTimeout = null;
  let entryFrame = null;
  let tranceFrame = null;

  const previousFilter = saved?.state?.previousFilter ?? (canvas.style.filter);
const previousTransition = saved?.state?.previousTransition ?? (canvas.style.transition);
const previousWillChange = saved?.state?.previousWillChange ?? (canvas.style.willChange);
const previousCanvasTransform = saved?.state?.previousCanvasTransform ?? (canvas.style.transform);
const previousCanvasOpacity = saved?.state?.previousCanvasOpacity ?? (canvas.style.opacity);

  canvas.style.transition = "filter 0.2s ease-in-out";
  canvas.style.willChange = "filter, transform";

function restoreCanvasEffects() {
  releaseEntityTint(canvas, "mysticism");

  canvas.style.filter = previousFilter || "";
  canvas.style.transition = previousTransition || "";
  canvas.style.willChange = previousWillChange || "";
  canvas.style.opacity = previousCanvasOpacity || "1";
}

  function restoreMysticismMotion() {
    canvas.style.transform = previousCanvasTransform || "";
  }

  function removeExistingMysticismVFX() {
    const existingMysticismVFX = effectsContainer.querySelector(".effect-vfx.mysticism");

    if (existingMysticismVFX) {
      clearTimeout(existingMysticismVFX._mysticismTO);
      existingMysticismVFX.remove();
    }
  }

  function stopMysticismVFX(withFade = true) {
    finishCanvasRun(visualRun);
    if (stopped) return;
    stopped = true;

    if (entryFrame) {
      cancelAnimationFrame(entryFrame);
      entryFrame = null;
    }

    if (tranceFrame) {
      cancelAnimationFrame(tranceFrame);
      tranceFrame = null;
    }

    clearTimeout(autoStopTimeout);
    clearTimeout(fadeOutTimeout);

    restoreCanvasEffects();
    restoreMysticismMotion();

    if (!mysticismVFX || !mysticismVFX.parentNode) return;

    if (!withFade) {
      mysticismVFX.remove();
      return;
    }

    mysticismVFX.classList.remove("mysticism-pop");
    mysticismVFX.classList.add("mysticism-fade-out");

    fadeOutTimeout = setTimeout(() => {
      if (mysticismVFX && mysticismVFX.parentNode) {
        mysticismVFX.remove();
      }
    }, fadeOutDuration);
  }

  function startMysticismVFX() {
    removeExistingMysticismVFX();

    mysticismVFX = document.createElement("img");
    playCachedGif(mysticismVFX, `./media/assets/effects/mysticism.gif`);
    mysticismVFX.className = "effect-vfx mysticism mysticism-pop";
    mysticismVFX.alt = "Transe mystique";
    mysticismVFX.style.position = "absolute";

    effectsContainer.appendChild(mysticismVFX);

mysticismVFX._mysticismTO = setTimeout(() => {
  stopMysticismVFX(false);
}, safeTranceDuration);
    autoStopTimeout = mysticismVFX._mysticismTO;

    console.log(
      `🔮 VFX Mysticisme lancé instantanément sur ${targetId} pendant ${safeTranceDuration}ms`
    );
  }

  function animateEntry(now) {
    if (stopped) return;

    const elapsed = now - entryStartTime;
    const progress = Math.min(elapsed / entryDuration, 1);

    const opacity = Math.sin(progress * Math.PI) * maxEntryOpacity;

    applyEntityTint(canvas, "mysticism", opacity);

    canvas.style.filter = `
      drop-shadow(0 0 ${8 + opacity * 12}px rgba(79, 112, 179, ${0.35 + opacity}))
      brightness(${1 + opacity * 0.35})
    `;

    if (progress < 1) {
      entryFrame = requestAnimationFrame(animateEntry);
      return;
    }
  }

  function animateTrance(now) {
    if (stopped) return;

    const elapsed = now - entryStartTime;

    if (elapsed >= safeTranceDuration) {
      return;
    }

    const blinkSpeed = 0.004;
    const pulseSpeed = 0.0035;

    const blink = (Math.sin(elapsed * blinkSpeed * Math.PI * 2) + 1) / 2;
    const pulse = (Math.sin(elapsed * pulseSpeed * Math.PI * 2) + 1) / 2;

    const opacity =
      tranceTintMinOpacity +
      blink * (tranceTintMaxOpacity - tranceTintMinOpacity);

    const scale = 1 - pulse * 0.1;

    applyEntityTint(canvas, "mysticism", opacity);

    canvas.style.filter = `
      drop-shadow(0 0 ${6 + opacity * 10}px rgba(79, 112, 179, ${0.25 + opacity}))
      brightness(${1 + opacity * 0.25})
    `;

    canvas.style.transform = `scale(${scale.toFixed(3)})`;

    tranceFrame = requestAnimationFrame(animateTrance);
  }

  if (saved) {
    mysticismVFX = effectsContainer.querySelector('.effect-vfx.mysticism');
    autoStopTimeout = setTimeout(() => stopMysticismVFX(false), Math.max(0, entryStartTime + safeTranceDuration - clockNow()));
  } else startMysticismVFX();
  visualRun.capture = () => ({ entryStartTime, previousFilter, previousTransition, previousWillChange, previousCanvasTransform, previousCanvasOpacity });
  entryFrame = requestAnimationFrame(animateEntry);
  tranceFrame = requestAnimationFrame(animateTrance);

  return stopMysticismVFX;
}
export function mysticismAttackGif(attackerId) {
  const sprite = document.getElementById(`DragSprite_${attackerId}`);

  if (!sprite) {
    console.warn(`⚠️ Sprite non trouvé pour mysticismAttackGif attackerId: ${attackerId}`);
    return;
  }

  let effectsContainer = document.getElementById(`effectsContainer_${attackerId}`);

  if (!effectsContainer) {
    if (!sprite.parentNode) {
      console.warn(`⚠️ Impossible de créer effectsContainer pour mysticismAttackGif : ${attackerId}`);
      return;
    }

    effectsContainer = document.createElement("div");
    effectsContainer.id = `effectsContainer_${attackerId}`;
    effectsContainer.className = "effects-container";
    sprite.parentNode.appendChild(effectsContainer);
  }

  const existingGif = effectsContainer.querySelector(".effect-vfx.mysticism-attack");

  if (existingGif) {
    existingGif.remove();
  }

  const isSideB =
    sprite.classList.contains("side-B") ||
    sprite.classList.contains("B") ||
    sprite.classList.contains("sideB");

  const gif = document.createElement("img");
  playCachedGif(gif, `./media/assets/effects/mysticism-attack.gif`);
  gif.className = "effect-vfx mysticism-attack";
  gif.alt = "";

  gif.style.position = "absolute";
  gif.style.pointerEvents = "none";

  if (isSideB) {
    gif.classList.add("side-b");
  }

  effectsContainer.appendChild(gif);

  setTimeout(() => {
    if (gif && gif.parentNode) {
      gif.remove();
    }
  }, 1500);
}
export function animateOccultism(targetId, saved = null) {
  const run = beginCanvasRun('animateOccultism', targetId, {}, saved);
  const canvas = document.getElementById(`spriteCanvas_${targetId}`);
  const sprite = document.getElementById(`DragSprite_${targetId}`);

  if (!canvas && !sprite) {
    console.warn(`⚠️ Aucun élément trouvé pour Occultisme : ${targetId}`);
    return null;
  }

  const previousSpriteFilter = saved?.state.previousSpriteFilter ?? (sprite?.style.filter || "");
  const previousSpriteTransition = saved?.state.previousSpriteTransition ?? (sprite?.style.transition || "");
  const previousSpriteWillChange = saved?.state.previousSpriteWillChange ?? (sprite?.style.willChange || "");

  let stopped = false;
  run.capture = () => ({ previousSpriteFilter, previousSpriteTransition, previousSpriteWillChange });

  if (sprite && !saved) {
    sprite.classList.add("occultism-invisible-visual");
    sprite.style.transition = "filter 0.15s ease-in-out, opacity 0.15s ease-in-out";
    sprite.style.willChange = "filter, opacity";
    sprite.style.filter = `${previousSpriteFilter} grayscale(1) saturate(0.25) brightness(0.75)`.trim();
  }

  if (canvas && !saved) {
    canvas.classList.add("occultism-invisible-visual");
    applyEntityTint(canvas, "occultism", 0.22);
  }

  return function stopOccultismAnimation() {
    if (stopped) return;
    stopped = true; finishCanvasRun(run);

    if (canvas) {
      releaseEntityTint(canvas, "occultism");
      canvas.classList.remove("occultism-invisible-visual");
    }

    if (sprite) {
      sprite.classList.remove("occultism-invisible-visual");
      sprite.style.filter = previousSpriteFilter;
      sprite.style.transition = previousSpriteTransition;
      sprite.style.willChange = previousSpriteWillChange;
    }
  };
}

export async function destructionItemAnimation({
  canvas = null,
  shakeTarget = null,
  impactDuration = 1000,
  tintName = 'damageImpact',
  tintOpacity = 0.6
} = {}) {
  const safeImpactDuration = Math.max(0, Number(impactDuration) || 0);
  const target = shakeTarget || canvas;
  let shakeAnimation = null;
  if (target?.animate && safeImpactDuration > 0) {
    const computedTransform = getComputedStyle(target).transform;
    const baseTransform = computedTransform === 'none' ? '' : computedTransform;
    const transformAt = (x = 0, y = 0, rotation = 0) => {
      const impactTransform = `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg)`;
      return baseTransform ? `${impactTransform} ${baseTransform}` : impactTransform;
    };
    shakeAnimation = target.animate([
      { transform: transformAt(0, 0, 0) },
      { transform: transformAt(-3, -1, -1.2) },
      { transform: transformAt(3, 1, 1.2) },
      { transform: transformAt(-4, 0, -1.5) },
      { transform: transformAt(4, -1, 1.5) },
      { transform: transformAt(-2, 1, -0.8) },
      { transform: transformAt(2, 0, 0.8) },
      { transform: transformAt(0, 0, 0) }
    ], {
      duration: safeImpactDuration,
      easing: 'linear',
      iterations: 1
    });
  }
  if (canvas && safeImpactDuration > 0) applyEntityTint(canvas, tintName, tintOpacity);
  await Promise.allSettled([
    shakeAnimation?.finished ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, safeImpactDuration))
  ]);
  if (canvas) releaseEntityTint(canvas, tintName);
  return { completed: true, canvas, shakeTarget: target };
}

export function getMeleeFlightVisual(flightId) {
    return [...activeMeleeAnimations.values()].flatMap(set => [...set]).find(c => c.flightId === flightId);
}
registerCombatState('melee', () => ({
    active: [...activeMeleeAnimations.values()].flatMap(set => [...set]).map(c => c.snapshot()),
    recoveries: [...meleeOriginalRecoveryAnimations].map(([id, r]) => ({ id, startTime: r.startTime,
        duration: r.duration, previousTransition: r.previousTransition, previousTransitionPriority: r.previousTransitionPriority })),
}), (saved, { entities }) => {
    for (const entry of [...phaserMelees.values()]) removePhaserMelee(entry);
    activeMeleeAnimations.clear(); meleeOriginalRecoveryAnimations.clear();
    for (const entry of saved.active) {
        const attacker = entities.find(e => e.id === entry.attacker), target = combatTarget(entry.target, entities);
        if (attacker && target) animationMelee(attacker, target, entry.isAmbidextry, { ...entry.options, resume: entry.resume });
    }
    for (const entry of saved.recoveries) {
        const sprite = document.getElementById(`DragSprite_${entry.id}`);
        if (sprite) startMeleeOriginalRecovery(entry.id, sprite, entry.duration, entry);
    }
});

registerCombatState('canvas-visuals', () => ({
    originals: [...document.querySelectorAll('canvas')].filter(c => c.id && originalImages.has(c)).map(c => ({
        id: c.id, image: originalImages.get(c).toDataURL(), tints: [...(activeEntityTints.get(c) || [])],
    })),
    runs: [...canvasRuns.values()].filter(r => r.capture && document.getElementById(`Box_Entite_${r.entityId}`)).map(r => ({ key: r.key, name: r.name,
        entityId: r.entityId, options: r.options, state: r.capture(), nextAt: r.nextAt, pulseRemaining: r.pulseRemaining?.() })),
}), async saved => {
    canvasRuns.clear();
    await Promise.all(saved.originals.map(async entry => {
        const canvas = document.getElementById(entry.id); if (!canvas) return;
        const image = new Image(); image.src = entry.image; await image.decode();
        const original = document.createElement('canvas'); original.width = image.naturalWidth; original.height = image.naturalHeight;
        original.getContext('2d').drawImage(image, 0, 0);
        originalImages.set(canvas, original); activeEntityTints.set(canvas, new Map(entry.tints));
    }));
    const functions = { damageImpact, brokenMagicImpact, mysticismBoostedAttackAnimation, damageArmorImpact,
        animateAmbidextry, shakeImpact, animateIndestructibility, animateEsoterism, animateAstrality, animateDodge };
    for (const run of saved.runs) {
        if (run.name === 'orderAnimation') orderAnimation({ id: run.entityId }, run);
        else if (run.name === 'animateOccultism') {
            const stop = animateOccultism(run.entityId, run);
            window.dispatchEvent(new CustomEvent('restoredOccultismAnimation', { detail: { entityId: run.entityId, stop } }));
        }
        else if (run.name === 'animateMysticism') {
            const stop = animateMysticism(run.entityId, run.options.tranceDuration, run);
            window.dispatchEvent(new CustomEvent('restoredMysticismAnimation', { detail: { entityId: run.entityId, stop } }));
        }
        else if (run.name === 'damageImpact') damageImpact(run.entityId, run.options, run);
        else functions[run.name]?.(run.entityId, run);
    }
});

for (const type of ['battleStopped', 'stageInterfaceClosing']) window.addEventListener(type, () => {
    for (const run of [...canvasRuns.values()]) run.stop?.();
    canvasRuns.clear();
});


// Presentation de la progression : ame, graphe et effets d'eveil.
// Ces effets d'interface utilisent globalThis pour rester independants de la pause du combat.
export function soulScaling(level) {
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
  globalThis.setTimeout(() => {
    pulse.remove();
  }, 650); // légèrement > durée de l’animation
}


export function updategraph(state, nodes) {
  const { strength, agility, intelligence } = state.stats;
  drawRealtimegraph(nodes.graphCtx, strength, agility, intelligence);

}


const extasisTimeoutsByEntity = new Map();


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
  timeouts.forEach(id => globalThis.clearTimeout(id));
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
    timeouts.push(globalThis.setTimeout(() => {
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
  const timeoutSecondGif = globalThis.setTimeout(() => {
    if (!wrapper.isConnected) return;

    const gif2 = document.createElement('img');
    gif2.src = noCacheSrc('./media/assets/effects/extase-02.gif');
    gif2.className = 'extasis end';
    wrapper.appendChild(gif2);
  }, 1);
  timeouts.push(timeoutSecondGif);

  // 3) Fin de l’animation : on enlève UNIQUEMENT le wrapper
  const timeoutRemoveAll = globalThis.setTimeout(() => {
    clearExtasisForEntity(entite);
  }, 7000); // 7 s au total
  timeouts.push(timeoutRemoveAll);

  extasisTimeoutsByEntity.set(entite.id, timeouts);
}
