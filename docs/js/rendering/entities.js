import { createCanvasBoard, readBoardScreenGeometry, compileBoardProjection } from './boardAdapter.js';
import {
  updateRoleInDOM, getBattleTargetAttack, updateEntityAttackTargetDisplay, applyCombatProfileView,
  IngameListingFocus, renderMovementCounter, getLevelBattleStats,
} from "./hud.js";
import { attachPhaserBoard, attachPhaserMonster, wakePhaserMonsters, renderEntityTint, getMonsterPlacementOffset, readCombatAnimations, queueCombatPresentationUpdate, positionPhaserLayer, ENTITY_TINTS } from "./animations.js";
import { persistentMediaMarkup, loadResource, loadSpriteAtlas, getAnimatedImageState, loadEffectAtlas } from "../data/loaderList.js";
import { updateHealthBar } from "./vitalFeedback.js";
import { entitySizeInCells, applyEntitySizeVisual } from "../board/controller.js";
import { calibrateEntityVisuals, fountainFrames, POPUP_LIMITS } from "./popups.js";
import { setTimeout, requestAnimationFrame, clockNow } from "../combat/clock.js";
import { cachedResourceImage, cachedResourceUrl, playCachedGif } from "../data/loaderList.js";
import { determineClasse } from "../board/deployment.js";
import { AttackerSbireTargetPriority, AllySbireTargetPriority } from "../combat/roles.js";
import { createUmbraBlock } from "../ui/statistics/components.js";
import { createEntityAttackDisplay } from "../ui/attacks.js";
import { createStuffDom } from "../ui/codex/profile.js";
import { entites } from "../entities/runtime.js";
import { attackDetails } from "../data/attackList.js";
import { resolveAttackDefinitionForEntity, resolveEntityAttackDisplayName } from "../combat/attackResolution.js";
import { adjustFontSize } from "../ui/display.js";
import { syncEntityAuras, cleanupEntityAuras, getAuraPoolCurrent } from "./auras.js";
import {
  getSafe,
  assertEntityType,
  getBattleEntityDomId,
  getBattleEntityElement,
  isLord,
} from "../entities/rules.js";

export function createHPCounter(entite) {
  if (!entite?.stats?.HP) return null;

  const currentHP = entite.stats.HP?.current ?? 0;
  const maxHP = entite.stats.HP?.max ?? 0;

  const HPCounter = document.createElement("div");
  HPCounter.className = "HP-counter hu";
  HPCounter.dataset.stat = "HP";
  HPCounter.dataset.entityId = entite.id;
  HPCounter.textContent = `HP : ${currentHP} / ${maxHP}`;

  return HPCounter;
}

export function createMovementCounter(entite) {
  const shift = entite?.stats?.shift;
  if (!shift) return null;

  const movementCounter = document.createElement("div");
  movementCounter.className = "movement-counter hu";
  movementCounter.dataset.stat = "shift";
  movementCounter.dataset.entityId = entite.id;
  movementCounter.dataset.movementEntityId = entite.id;

  const movementPicto = document.createElement("div");
  movementPicto.className = "picto-stat shift";

  movementCounter.appendChild(movementPicto);
  renderMovementCounter(movementCounter, entite);

  return movementCounter;
}
export function createArmorCounter(entite) {
  const currentArmor = entite?.stats?.armor?.current ?? 0;

  // Affichage uniquement si l’armure existe réellement et est > 0
  if (!(currentArmor > 0)) return null;

  const node = document.createElement("div");
  node.className = "armor-counter hu"; // "hu" si tu veux la même typo que tes autres compteurs
  node.dataset.stat = "armor";
  node.dataset.entityId = entite.id;

  node.textContent = `🛡️ : ${currentArmor}`; // conforme à ton exemple
  return node;
}

export function createFadedLifeCounter(entite) {
  const raw = entite?.stats?.fadedLife;

  const value = Math.max(
    0,
    Number(typeof raw === "object" ? (raw?.current ?? 0) : (raw ?? 0)) || 0
  );

  if (value <= 0) return null;

  const fadedLifeCounterContainer = document.createElement("div");
  fadedLifeCounterContainer.className = "fadedLife-counter";
  fadedLifeCounterContainer.dataset.stat = "fadedLife";
  fadedLifeCounterContainer.dataset.entityId = entite.id;

  const pictoFadedDiv = document.createElement("div");
  pictoFadedDiv.className = "picto-stat fadedLife";

  const fadedLifeValueDiv = document.createElement("div");
  fadedLifeValueDiv.className = "fadedLife-value hu";
  fadedLifeValueDiv.dataset.stat = "fadedLife-value";
  fadedLifeValueDiv.dataset.entityId = entite.id;
  fadedLifeValueDiv.textContent = `: ${value}`;

  fadedLifeCounterContainer.appendChild(pictoFadedDiv);
  fadedLifeCounterContainer.appendChild(fadedLifeValueDiv);

  return fadedLifeCounterContainer;
}

export function createExtraLifeCounter(entite) {
  const ex = entite?.stats?.extraLife;

  const exCurrent =
    ex && typeof ex === "object"
      ? (ex.current ?? 0)
      : (typeof ex === "number" ? ex : 0);

  const exMax =
    ex && typeof ex === "object"
      ? (ex.max ?? 0)
      : 0;

  const hasCurrent = typeof exCurrent === "number" && exCurrent > 0;
  const hasMax = typeof exMax === "number" && exMax > 0;

  // - current/max si max valide
  // - current seul si max invalide
  // - rien si aucun des deux
  if (!(hasCurrent || hasMax)) return null;

  const extraLifeCounterContainer = document.createElement("div");
  extraLifeCounterContainer.className = "extraLife-counter";
  extraLifeCounterContainer.dataset.stat = "extraLife";
  extraLifeCounterContainer.dataset.entityId = entite.id;

  // ✅ même convention que tes stats
  const pictoExDiv = document.createElement("div");
  pictoExDiv.className = "picto-stat extraLife";

  const exValueDiv = document.createElement("div");
  exValueDiv.className = "extraLife-value hu";
  exValueDiv.dataset.stat = "extraLife-value";
  exValueDiv.dataset.entityId = entite.id;

  if (hasMax) exValueDiv.textContent = `: ${exCurrent}/${exMax}`;
  else if (hasCurrent) exValueDiv.textContent = `: ${exCurrent}`;
  else exValueDiv.textContent = `: ${exMax}`; // optionnel

  extraLifeCounterContainer.appendChild(pictoExDiv);
  extraLifeCounterContainer.appendChild(exValueDiv);

  return extraLifeCounterContainer;
}

export function createEternalLifeCounter(entite) {
  const et = entite?.stats?.eternalLife;

  // Keep depleted rechargeable lives visible.
  const etMax =
    et && typeof et === "object" ? (Number(et.max ?? 0) || 0) : 0;

  if (!(etMax > 0)) return null;

  const etCurrent =
    et && typeof et === "object" ? (Number(et.current ?? 0) || 0) : 0;

  const max = Math.max(0, Math.floor(etMax));
  const cur = Math.min(max, Math.max(0, Math.floor(etCurrent)));

  const eternalLifeCounterContainer = document.createElement("div");
  eternalLifeCounterContainer.className = "eternalLife-counter";
  eternalLifeCounterContainer.dataset.stat = "eternalLife";
  eternalLifeCounterContainer.dataset.entityId = entite.id;

  const pictoEtDiv = document.createElement("div");
  pictoEtDiv.className = "picto-stat eternalLife";

  const etValueDiv = document.createElement("div");
  etValueDiv.className = "eternalLife-value hu";
  etValueDiv.dataset.stat = "eternalLife-value";
  etValueDiv.dataset.entityId = entite.id;

  etValueDiv.textContent = `: ${cur}/${max}`;

  eternalLifeCounterContainer.appendChild(pictoEtDiv);
  eternalLifeCounterContainer.appendChild(etValueDiv);

  return eternalLifeCounterContainer;
}

export function createLifeCounter(entite) {
  if (!entite?.stats?.HP) return null;

  const lifeCounterContainer = document.createElement("div");
  lifeCounterContainer.className = "life-bar-counter";
  lifeCounterContainer.dataset.entityId = entite.id;

  // const hp = createHPCounter(entite);
  // if (hp) lifeCounterContainer.appendChild(hp);

  const fadedLife = createFadedLifeCounter(entite);
  if (fadedLife) lifeCounterContainer.appendChild(fadedLife);

  const extraLife = createExtraLifeCounter(entite);
  if (extraLife) lifeCounterContainer.appendChild(extraLife);

  const eternalLife = createEternalLifeCounter(entite);
  if (eternalLife) lifeCounterContainer.appendChild(eternalLife);


  return lifeCounterContainer;
}

// Track the few open bar views without searching the entire combat DOM on hits.
// Weak references do not retain inspectors or fighters after their removal.
const lifeBarViews = new Map();
export function hasExternalLifeBars(entityId) {
  const views = lifeBarViews.get(String(entityId));
  if (!views) return false;
  let external = false;
  for (const reference of views) {
    const node = reference.deref();
    if (!node) views.delete(reference);
    else if (node.isConnected && !node.closest('[data-monster-webgl="ready"]')) external = true;
  }
  if (!views.size) lifeBarViews.delete(String(entityId));
  return external;
}

export function createLifeBars(entite, { context = null } = {}) {
  if (!entite?.stats?.HP) return null;

  const HPcurrent = entite.stats.HP.current ?? 0;
  const HPmax = entite.stats.HP.max ?? 1;
  const ArmorCurrent = entite.stats.armor?.current ?? 0;
  const ArmorMax = entite.stats.armor?.max ?? 0;

  const validHP = Math.max(0, Math.min(HPcurrent, HPmax));
  const validArmor = Math.max(0, Number(ArmorCurrent) || 0);

  const total = HPmax + validArmor;
  const hpPortion = total > 0 ? (validHP / total) * 100 : 0;
  const armorPortion = total > 0 ? (validArmor / total) * 100 : 0;

  const container = document.createElement('div');
  container.className = 'life-bars-container';
  const viewKey = String(entite.id);
  if (!lifeBarViews.has(viewKey)) lifeBarViews.set(viewKey, new Set());
  lifeBarViews.get(viewKey).add(new WeakRef(container));
  if (context) container.classList.add(context);

  container.style.display = 'flex';
  container.style.position = 'relative';
  container.style.width = '100%';

  // ✅ HP COUNTER DANS LE CONTAINER (comme ton exemple)
  const hpText = createHPCounter(entite);
  if (hpText) container.appendChild(hpText);

  // HEALTH BAR
  const healthBar = document.createElement('div');
  healthBar.className = `health-bar ${entite.side}`;
  healthBar.dataset.stat = 'hp-bar';
  healthBar.dataset.entityId = entite.id;
  healthBar.style.flex = `0 0 ${hpPortion}%`;
  healthBar.style.width = `${hpPortion}%`;

  const healthFill = document.createElement('div');
  healthFill.className = 'health-fill';
  healthFill.style.width = '100%';

  healthBar.appendChild(healthFill);
  container.appendChild(healthBar);

  // ARMOR BAR
  {
    const armorBar = document.createElement('div');
    armorBar.className = `armor-bar ${entite.side}`;
    armorBar.dataset.stat = 'armor-bar';
    armorBar.dataset.entityId = entite.id;
    armorBar.style.flex = `0 0 ${armorPortion}%`;
    armorBar.style.width = `${armorPortion}%`;

    const armorFill = document.createElement('div');
    armorFill.className = 'armor-fill';
    armorFill.style.width = '100%';

    armorBar.appendChild(armorFill);
    container.appendChild(armorBar);
  }

  queueMicrotask(() => {
    updateHealthBar(HPcurrent, HPmax, ArmorCurrent, ArmorMax, entite.id, 0);
  });

  return container;
}

function stopDeadEntityAnimations(entite) {
  const entityBox = document.getElementById(`Box_Entite_${entite.id}`);
  if (!entityBox) return;

  cleanupEntityAuras(entite);

  entityBox.querySelectorAll('[id^="auraContainer_"], .aura-container').forEach((aura) => {
    aura.replaceChildren();
    aura.setAttribute('aria-hidden', 'true');
  });

  if (typeof entityBox.getAnimations === 'function') {
    entityBox.getAnimations({ subtree: true }).forEach((animation) => {
      const target = animation.effect?.target;
      if (target?.closest?.('.effects-container')) return;
      animation.cancel();
      if (target?.style) {
        target.style.setProperty('animation', 'none', 'important');
        target.style.setProperty('transition', 'none', 'important');
      }
    });
  }

  entityBox.querySelectorAll(
    `[id^="Animationsprite_${entite.id}"], #DragSprite_${entite.id}, #spriteCanvas_${entite.id}`
  ).forEach((element) => {
    element.style.setProperty('animation', 'none', 'important');
    element.style.setProperty('transition', 'none', 'important');
  });
}

function forceDeadEntityOpacity(entite, entityBox, container, canvas = null) {
  const animationSprite = document.getElementById(`Animationsprite_${entite.id}`);
  const spriteContainer = document.getElementById(`spriteContainer_${entite.id}`);

  [entityBox, spriteContainer, animationSprite, container, canvas]
    .filter(Boolean)
    .forEach((element) => {
      element.style.setProperty('opacity', '1', 'important');
      element.style.setProperty('visibility', 'visible', 'important');
    });
}

export function stabilizeDeadEntityVisual(entite, { playDeathBlood = false } = {}) {
  if (!entite) return null;

  entite.isDEAD = true;
  entite.statut = ['dead'];
  if (entite?.stats?.HP) entite.stats.HP.current = 0;

  const entityBox = document.getElementById(`Box_Entite_${entite.id}`);
  const container = document.getElementById(`DragSprite_${entite.id}`);
  if (!container) {
    console.warn(`⚠️ Aucun conteneur trouvé pour l'entité ${entite.id}`);
    return null;
  }

  // Une fois le canvas du cadavre créé, il devient immuable. Les mises à jour
  // du loot et du glitter ne doivent plus toucher à son DOM ni à ses animations.
  let canvas = document.getElementById(`spriteCanvas_${entite.id}`);
  const alreadyCanonical = canvas?.classList.contains('dead-sprite')
    && canvas.width === 603
    && canvas.height === 328;

  if (alreadyCanonical) {
    forceDeadEntityOpacity(entite, entityBox, container, canvas);
    return canvas;
  }

  stopDeadEntityAnimations(entite);

  entityBox?.classList.remove('dead', 'corpse', 'no-animation');
  if (entityBox) entityBox.style.pointerEvents = '';

  container.classList.remove('hb', 'dead', 'hbox');
  const spriteImg = document.getElementById(`sprite_${entite.id}`);
  spriteImg?.remove();

  canvas?.remove();
  canvas = document.createElement('canvas');
  canvas.id = `spriteCanvas_${entite.id}`;
  canvas.className = `dead-sprite ${entite.class} side-${entite.side} dead hbox`;
  canvas.width = 603;
  canvas.height = 328;
  container.appendChild(canvas);

  const context = canvas.getContext('2d');
  const deadSprite = new Image();
  deadSprite.onload = () => {
    if (!canvas.isConnected || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(deadSprite, 0, 0, canvas.width, canvas.height);
    forceDeadEntityOpacity(entite, entityBox, container, canvas);
  };
  deadSprite.src = cachedResourceUrl(entite.deadsprite || entite.DeadSprite || './media/sprites/0-dead.png');

  forceDeadEntityOpacity(entite, entityBox, container, canvas);

  const animationSprite = document.getElementById(`Animationsprite_${entite.id}`);
  animationSprite?.classList.add('dead');
  animationSprite?.classList.remove('no-animation');

  const spriteContainer = document.getElementById(`spriteContainer_${entite.id}`);
  if (entite.side === 'B' && spriteContainer && !spriteContainer.style.transform) {
    spriteContainer.style.transform = 'scaleX(-1)';
  }

  getBattleEntityElement(entite)?.classList.remove('dead', 'hbox');

  let effectsContainer = document.getElementById(`effectsContainer_${entite.id}`);
  if (!effectsContainer) {
    const effectsHost = entityBox?.querySelector(':scope > .drag-box') || container;
    effectsContainer = document.createElement('div');
    effectsContainer.id = `effectsContainer_${entite.id}`;
    effectsContainer.className = 'effects-container';
    effectsHost.appendChild(effectsContainer);
  }

  if (playDeathBlood) {
    document.getElementById(`bloodEffect_${entite.id}`)?.remove();
    const bloodGif = document.createElement('img');
    playCachedGif(bloodGif, './media/assets/effects/death-blood.gif');
    bloodGif.className = 'effect-vfx blood';
    bloodGif.id = `bloodEffect_${entite.id}`;
    effectsContainer.appendChild(bloodGif);
    setTimeout(() => bloodGif.remove(), 1000);
  }

  return canvas;
}

export function getEntitySpriteSource(entite) {
    const dead = entite?.isDEAD === true || entite?.statut?.includes?.('dead')
      || Number(entite?.stats?.HP?.current ?? 0) <= 0;
    return dead ? entite.deadsprite || entite.DeadSprite || './media/sprites/0-dead.png' : entite.sprite;
}

export function createEntiteInDOM(entite, { spriteImage = null } = {}) {
    entite.sizeInCells = entitySizeInCells(entite);
    // console.log('// EXEC createEntiteInDOM');

    assertEntityType(entite);
    determineClasse(entite);

    const entityStartsDead =
      entite?.isDEAD === true ||
      entite?.statut?.includes?.("dead") ||
      Number(entite?.stats?.HP?.current ?? 0) <= 0;

    if (entityStartsDead) {
      entite.isDEAD = true;
      entite.isSurprised = false;
      entite.statut = ["dead"];
      if (entite?.stats?.HP) entite.stats.HP.current = 0;
      cleanupEntityAuras(entite);
    }

    const entiteBox = document.createElement('div');
    entiteBox.id = `Box_Entite_${entite.id}`;
    entiteBox.className = `entite-box side-${entite.side} role-${entite.role}`;
    if (entityStartsDead) {
      entiteBox.dataset.dead = 'true';
    }
    entiteBox.setAttribute( "data-position", entite.position || `hex_${15 + entite.id - 2}`);
    // entiteBox.draggable = !entityStartsDead;
    if (!entityStartsDead) {
      entiteBox.addEventListener('dragstart', event => event.dataTransfer.setData('text', entiteBox.id));
    }
    updateRoleInDOM(entite, entiteBox);

	const castAnimation = document.createElement('div');
    castAnimation.id = `Cast_Animation_${entite.id}`;
    castAnimation.className = `cast-animation-container`;
	entiteBox.appendChild(castAnimation);

    const dragBox = document.createElement('div');
    dragBox.className = 'drag-box';
    dragBox.draggable = !entityStartsDead;
    if (!entityStartsDead) {
      dragBox.addEventListener('dragstart', event => {
          event.dataTransfer.setData('text', entiteBox.id);
          console.log('Started dragging:', entiteBox.id);
      });
    }

   
    let entityDiv = document.createElement('div');
    entityDiv.id = getBattleEntityDomId(entite);
    entityDiv.dataset.entityId = entite.id;
    entityDiv.className = `entitesContainer ${entite.type} ${entite.side}`;
	entityDiv.dataset.entityclasse = `${entite.classe}`;
    applyCombatProfileView(entityDiv, entite);
	entityDiv.dataset.entityType = entite.type;
    const initialAttack = getBattleTargetAttack(entite);
    if (initialAttack) {
        entityDiv.dataset.attackFunction = initialAttack.combatFunction;
        entityDiv.dataset.attackDomain = initialAttack.attackTarget[0] === 'hexa' ? 'invocateur'
            : initialAttack.deadTarget?.includes('yes') ? 'necro' : 'combattant';
    }

    let spriteContainer = document.createElement('div');
    spriteContainer.id = `spriteContainer_${entite.id}`;
    spriteContainer.className = `sprite-container ${entite.side}`;
    spriteContainer.dataset.dropable = 'true';
    spriteContainer.dataset.entityId = entite.id;


    let effectsContainer = document.createElement('div');
    effectsContainer.id = `effectsContainer_${entite.id}`;
    effectsContainer.className = 'effects-container';
    dragBox.appendChild(effectsContainer);


    let imgSide = document.createElement('div');
    imgSide.id = `imgContainer_${entite.id}`
    imgSide.className = `img-container img-side-${entite.side} ${entite.type}`;
    if (!entityStartsDead && entite.isSurprised === true) {
      imgSide.classList.add('surprised');
    }
    spriteContainer.appendChild(imgSide);


// SPRITE ENTITE - Conteneur d'animation
let spriteAnimation = document.createElement('div');
spriteAnimation.id = `Animationsprite_${entite.id}`;
spriteAnimation.className = entityStartsDead
  ? `animation-sprite ${entite.class} side-${entite.side} dead`
  : `animation-sprite ${entite.class} side-${entite.side}`;
imgSide.appendChild(spriteAnimation);

// Création de la div .sprite
let spriteDiv = document.createElement('div');
spriteDiv.className = `sprite side-${entite.side} ${entite.class} hb iddle`;
spriteDiv.id = `DragSprite_${entite.id}`;
spriteDiv.dataset.dropable = 'true';
spriteDiv.dataset.entityId = entite.id;
spriteDiv.setAttribute('draggable', entityStartsDead ? 'false' : 'true');
if (entityStartsDead) spriteDiv.classList.remove('hb');

// Aura Conteneur 
let AuraContainer = document.createElement('div');
AuraContainer.id = `auraContainer_${entite.id}`;
AuraContainer.className = `aura-container side-${entite.side} ${entite.class}`;
spriteAnimation.appendChild(AuraContainer);


// Création du canvas
let canvas = document.createElement('canvas');
canvas.id = `spriteCanvas_${entite.id}`;
canvas.width = entityStartsDead ? 603 : 500;
canvas.height = entityStartsDead ? 328 : 500;
canvas.className = entityStartsDead
  ? `dead-sprite ${entite.class} side-${entite.side} dead hbox`
  : `sprite-canvas side-${entite.side} ${entite.class}`;

// Ajout du canvas dans la div .sprite
spriteDiv.appendChild(canvas);

// Le canvas rejoint immédiatement l'arbre de l'entité. Aucun timer n'est
// nécessaire : l'arbre complet sera connecté lorsque entiteBox rejoindra body.
spriteAnimation.appendChild(spriteDiv);

// Récupération du contexte du canvas
let ctx = canvas.getContext('2d');

if (!ctx) {
    console.error("❌ Impossible d'obtenir le contexte 2D !");
}


// Chargement du sprite et dessin
const spriteSource = getEntitySpriteSource(entite);
spriteImage ||= cachedResourceImage(spriteSource);
const spriteEntite = spriteImage?.complete && spriteImage.naturalWidth > 0
  && spriteImage.src === new URL(cachedResourceUrl(spriteSource), document.baseURI).href ? spriteImage : new Image();
spriteEntite.fetchPriority = 'high';
let resolveSpriteReady;
const spriteReady = new Promise((resolve) => {
  resolveSpriteReady = resolve;
});

/*
 * IMPORTANT :
 * on installe les événements AVANT d'affecter src.
 * Sinon une image déjà en cache peut charger
 * avant l'enregistrement du onload.
 */
spriteEntite.onload = function () {
  if (!ctx) {
    resolveSpriteReady({ loaded: false, canvas, error: 'Contexte 2D indisponible' });
    return;
  }

  try {
    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    ctx.drawImage(
        spriteEntite,
        0,
        0,
        canvas.width,
        canvas.height
    );
  } catch (error) {
    console.error(`❌ Dessin du sprite impossible pour ${entite.id}`, error);
    resolveSpriteReady({ loaded: false, canvas, error: error.message });
    return;
  }

    /*
     * La synchronisation des effets arrive uniquement
     * après que le sprite réel a été dessiné.
     */
    if (!entityStartsDead) {
      const syncAuras = () => {
        if (!AuraContainer.isConnected) return;
        try {
          syncEntityAuras(entite, AuraContainer);
        } catch (error) {
          // Une aura défaillante ne doit jamais annuler le dessin du sprite.
          console.error(`❌ Synchronisation des auras impossible pour ${entite.id}`, error);
        }
      };
      if (AuraContainer.isConnected) syncAuras();
      else queueMicrotask(syncAuras);
    }

    resolveSpriteReady({ loaded: true, canvas, image: spriteEntite });
};

spriteEntite.onerror = function () {
    console.error(
        "❌ Erreur chargement image :",
        spriteEntite.src
    );
    resolveSpriteReady({
      loaded: false,
      canvas,
      error: `Image inaccessible : ${spriteEntite.src}`
    });
};

/*
 * Détermination du sprite après installation du onload.
 */
const isDead = entityStartsDead;

if (!isDead) {
    canvas.classList.remove(
        "dead",
        "hbox"
    );

    spriteDiv.classList.remove(
        "dead",
        "hbox"
    );

}
if (!spriteSource) {
    console.error(`Sprite non defini pour l'entite ${entite.id}`);
    resolveSpriteReady({ loaded: false, canvas, error: 'Sprite non defini' });
} else if (spriteEntite.complete && spriteEntite.naturalWidth > 0) {
    spriteEntite.onload();
} else {
    spriteEntite.src = cachedResourceUrl(spriteSource);
}
// SPRITE TARGET INFOS
 let TargetInfos = document.createElement('div');
 TargetInfos.id = `TargetInfos_${entite.id}`; 
 TargetInfos.className = `TargetInfos ${entite.classe}`;
  imgSide.appendChild(TargetInfos);

    entityDiv.appendChild(spriteContainer);

    let hudIngame = document.createElement('div');
    hudIngame.id = `hudIngame_${entite.id}`;
    hudIngame.className = `hud-ingame ${entite.side}`;

// ROLE HUD
	const roleTypeClasses = entite.type;
	let roleContainer = document.createElement('div');
    roleContainer.id = `roleContainer_${entite.id}`;
    roleContainer.className = `role-img-container ${roleTypeClasses} ${entite.side}`;
    hudIngame.appendChild(roleContainer);
		
    let roleImg = document.createElement('div');
    roleImg.id = `role-img_${entite.id}`; 
    roleImg.alt =`${entite.name} est un ${entite.role}`; 
    roleImg.className = `role-img role-${entite.role} ${roleTypeClasses}`;
    roleContainer.appendChild(roleImg);

    let roleImgHud = document.createElement('div');
    roleImgHud.className = `role-img-hud ${roleTypeClasses}`;
   	roleContainer.appendChild(roleImgHud);
	
const levelDiv = document.createElement("div");
levelDiv.className = "entity-level hu";
levelDiv.dataset.entityId = entite.id;
levelDiv.textContent = `${entite.level?.current ?? entite.level ?? 1}`;

hudIngame.appendChild(levelDiv);
	
// TARGET HUD	
	let TargetroleContainer = document.createElement('div');
    TargetroleContainer.id = `TargetroleContainer_${entite.id}`;
    TargetroleContainer.className = `target-role-img-container ${entite.type} ${entite.side} ${entite.classe}`;
    hudIngame.appendChild(TargetroleContainer);
	
	let TargetImg = document.createElement('div');
	TargetImg.className = `target-picto-hud ${entite.classe}`;
    TargetroleContainer.appendChild(TargetImg);
	
    let TargetroleImg = document.createElement('div');
    TargetroleImg.id = `Targetrole-img_${entite.id}`; 
    TargetroleImg.alt =`${entite.name} est un ${entite.role}`; 
    TargetroleImg.className = `role-img role-${entite.role} ${entite.type}`;
    TargetroleContainer.appendChild(TargetroleImg);

	let TargetRoleImgHud = document.createElement('div');
	TargetRoleImgHud.className = `targetrole-img-hud ${entite.type}`;
	TargetroleContainer.appendChild(TargetRoleImgHud);


// 🩸🛡️ Création du conteneur principal
const healthBarContainer = document.createElement('div');
healthBarContainer.className = 'health-bar-container';

// Création de la barre de vie + d’armure combinée
const lifeBarsContainer = createLifeBars(entite);
if (lifeBarsContainer) {
  healthBarContainer.appendChild(lifeBarsContainer);
}


    let entityPopUpTop = document.createElement('div');
    entityPopUpTop.id = `PopUp_${entite.id}`;
    entityPopUpTop.className = 'pop-up-txt';
    entityDiv.appendChild(entityPopUpTop);
	  let entityPopDown = document.createElement('div');
    entityPopDown.id = `PopDow_${entite.id}`;
    entityPopDown.className = 'pop-down-txt';
    entityDiv.appendChild(entityPopDown);
		
    let statusBar = document.createElement('div');
    statusBar.id = `statusBar_${entite.id}`;
    statusBar.className = `status-bar ${entite.type}`;
    hudIngame.appendChild(statusBar);
	
const movementCounter = createMovementCounter(entite);
if (movementCounter) {
  statusBar.appendChild(movementCounter);
}

statusBar.appendChild(healthBarContainer);
	const atbUI = CreateATBEntity(entite);
	statusBar.appendChild(atbUI);
	
	currentAttackTimers(entite, hudIngame);
	
    entiteBox.appendChild(hudIngame);
    entiteBox.appendChild(dragBox);
    dragBox.appendChild(entityDiv);
    updateEntityAttackTargetDisplay(entite);
    document.body.appendChild(entiteBox);
    applyEntitySizeVisual(entite);
    calibrateEntityVisuals(spriteDiv, spriteContainer.parentElement, entityPopUpTop, entityPopDown,
      { auraHost: AuraContainer, effectsHost: effectsContainer });
    if (entityStartsDead) {
      setTimeout(() => {
        if (entiteBox.isConnected && (entite.isDEAD || entite.statut?.includes('dead')
            || Number(entite.stats?.HP?.current) <= 0)) {
          stabilizeDeadEntityVisual(entite, { playDeathBlood: false });
        }
      }, 60);
    }

    if (monsterWebGLRequested()) spriteReady.then(() => {
      globalThis.requestAnimationFrame(() => mountWebGLMonster(entite, entiteBox));
    });
    return { element: entiteBox, canvas, spriteReady };
}

export function createHeadUpInDom(entityId) {
	  // Recherche de l'entité correspondant à l'ID fourni
   const entite = entites.find(e => e.id === Number(entityId));
    
    // Si aucune entité ne correspond à cet ID, on quitte la fonction
    if (!entite) {
        console.error(`Entité avec l'ID ${entityId} non trouvée.`);
        return;
    }
// Vérifier si gameContainer est bien défini
const gameContainer = document.getElementById('game-container'); 

// Vérifier si .AllEntitiesHud existe déjà dans #game-container
let allEntitiesHud = gameContainer.querySelector('.AllEntitiesHud');

if (!allEntitiesHud) {
    allEntitiesHud = document.createElement('div');
    allEntitiesHud.className = 'AllEntitiesHud';
    gameContainer.appendChild(allEntitiesHud);
}

// Vérifier si le HUD global existe déjà dans AllEntitiesHud
let HeadsupGlobal = allEntitiesHud.querySelector('.headsup-hud.global');
if (!HeadsupGlobal) {
    HeadsupGlobal = document.createElement('div');
    HeadsupGlobal.classList.add('headsup-hud', 'global');
    
    // Créer les conteneurs pour chaque côté du HUD
    const sideAHeadsup = document.createElement('div');
    sideAHeadsup.classList.add('headsup-hud-side', 'side-A');
    
    const sideBHeadsup = document.createElement('div');
    sideBHeadsup.classList.add('headsup-hud-side', 'side-B');

    // Ajouter les côtés au conteneur principal
    HeadsupGlobal.appendChild(sideAHeadsup);
    HeadsupGlobal.appendChild(sideBHeadsup);

    // Ajouter le HUD global au conteneur AllEntitiesHud
    allEntitiesHud.appendChild(HeadsupGlobal);
}


// Reference the side containers
let sideA = document.querySelector('.headsup-hud-side.side-A');
let sideB = document.querySelector('.headsup-hud-side.side-B');

// Create the HUD container for the entity
let HUContainer = document.createElement('div');
HUContainer.className = `headsup-container ${entite.side}`;
HUContainer.id = `headsup-container_${entite.id}`;

let PortraitContainer = document.createElement('div');
PortraitContainer.className = `portrait-container ${entite.type}`;
PortraitContainer.id = `portrait-container_${entite.id}`;
PortraitContainer.dataset.dropable = 'true';
PortraitContainer.dataset.entityId = entite.id;

let PortraitCadre = document.createElement('div');
PortraitCadre.alt = `Cadre du portrait du ${entite.name}`; 
PortraitCadre.className = `portrait-cadre ${entite.side} ${entite.type}`;

let PortraitRole = document.createElement('div');
PortraitRole.id = `rolePortrait_${entite.id}`;
PortraitRole.alt = `Role du ${entite.name}`; 
PortraitRole.className = `hud-portrait-role role-${entite.role} ${entite.type}`;

let PortraitEntite = document.createElement('img');
PortraitEntite.id = `portrait_${entite.id}`; 
PortraitEntite.alt = `Portrait du ${entite.name}`; 
PortraitEntite.className = `portrait-sprite side-${entite.side}`;
PortraitEntite.dataset.dropable = 'true';
PortraitEntite.dataset.entityId = entite.id;
PortraitEntite.src = cachedResourceUrl(`${entite.portrait}`);

PortraitContainer.appendChild(PortraitCadre);
PortraitContainer.appendChild(PortraitRole);
PortraitContainer.appendChild(PortraitEntite);
HUContainer.appendChild(PortraitContainer);

let HUInfos = document.createElement('div');
HUInfos.className = `HUInfos`;
HUContainer.appendChild(HUInfos);

let name = document.createElement('div');
name.id = `name_${entite.id}`;
name.className = `name name-${entite.type} auto-resize-text`; // Ajout de la classe pour resize

// Affichage : id > Nom/Pseudo : nickname > name > 'Entité inconnue'
name.textContent = `${entite.id} - ` + (entite.nickname ?? entite.name ?? 'Entité inconnue');

HUInfos.appendChild(name);
adjustFontSize(name);

let HUhealthBarContainer = document.createElement('div');
HUhealthBarContainer.className = `headsup-HP-container ${entite.side} ${entite.type}`;
HUhealthBarContainer.id = `headsup-HP-container_${entite.id}`;
HUInfos.appendChild(HUhealthBarContainer);

// ATB HUD
// Clonage visuel de la vraie jauge ATB
const realATBFill = document.getElementById(`atbFill_${entite.id}`);

if (realATBFill) {
    const atbHudBarContainer = document.createElement('div');
    atbHudBarContainer.id = `HUATB_${entite.id}`;
    atbHudBarContainer.className = 'headsup-atb-container';

    // Clone sans les événements
    const atbHudFill = realATBFill.cloneNode(false);
    atbHudFill.id = `HUATBfill_${entite.id}`;
    atbHudFill.className = 'headsup-atb-fill';

    atbHudBarContainer.appendChild(atbHudFill);
    HUInfos.appendChild(atbHudBarContainer);

    // Synchronisation dynamique (option 1)
    const syncATB = () => {
        if (!atbHudFill.isConnected || !realATBFill.isConnected) return;
        atbHudFill.style.width = realATBFill.style.width;
        requestAnimationFrame(syncATB);
    };
    requestAnimationFrame(syncATB);
}


// const lifeCounter = createLifeCounter(entite);
// if (lifeCounter) {
  // HUhealthBarContainer.appendChild(lifeCounter);
// }

// let vitalCounter = document.createElement('div');
// vitalCounter.id = `vitalCounter_${entite.id}`;
// vitalCounter.className = 'vital-counter';

// if (entite.stats?.extraLife && typeof entite.stats.extraLife === 'object') {
    // let extraLife = document.createElement('div');
    // extraLife.id = `extraLife_${entite.id}`;
    // extraLife.className = 'extraLife';
    // extraLife.textContent = `Vie : ${entite.stats.extraLife.current} / ${entite.stats.extraLife.max}`;
    // vitalCounter.appendChild(extraLife);
    // HUInfos.appendChild(vitalCounter);
// }

const lifeBarsHUD = createLifeBars(entite, { context: 'headsup' });
if (lifeBarsHUD) {
  lifeBarsHUD.id = `HeadsupLifeBars_${entite.id}`;
  HUhealthBarContainer.appendChild(lifeBarsHUD);
}

// Append the entity HUD container to the appropriate side
if (entite.side === 'B') {
    sideB.appendChild(HUContainer);
} else if (entite.side === 'A') {
    sideA.appendChild(HUContainer);
}}

export function createEntiteScanInDOM(entityId) {
    // Recherche de l'entité correspondant à l'ID fourni
    const entite = entites.find(e => e.id === entityId);
    
    // Si aucune entité ne correspond à cet ID, on quitte la fonction
    if (!entite) {
        console.error(`Entité avec l'ID ${entityId} non trouvée.`);
        return;
    }
  function getEncodedURL(url) {
        return url.split('/').map(encodeURIComponent).join('/');
    }
    const encodedURL = getEncodedURL(entite.sprite);

    let entityScan = document.createElement('div');
    entityScan.id = `ScanEntity_${entite.id}`;
    entityScan.className = `entite-details`;
    entite.kills = entite.kills || 0;
    entite.totalDamage = entite.totalDamage || 0;
    entite.totalHeal = entite.totalHeal || 0;

const shownAttack = getBattleTargetAttack(entite);
const isHexAttack = shownAttack?.attackTarget?.includes('hexa');
const listingFocusContent = isHexAttack ? '' : IngameListingFocus(entite.role,
    shownAttack?.attackTarget?.includes('enemy') ? AttackerSbireTargetPriority : AllySbireTargetPriority);
const combatProfile = applyCombatProfileView(entityScan, entite);

// ENTITY SCAN
// Image details
let detailsImageDiv = document.createElement('div');
detailsImageDiv.className = 'details-image';
detailsImageDiv.style.position = "relative"; // ✅ pour overlay aura

let entiteDetailsImageDiv = document.createElement('div');
entiteDetailsImageDiv.className = 'entite-details-image';
entiteDetailsImageDiv.dataset.dropable = 'true';
entiteDetailsImageDiv.dataset.entityId = entite.id;
entiteDetailsImageDiv.style.backgroundImage = `url('${encodedURL}')`;
detailsImageDiv.appendChild(entiteDetailsImageDiv);

// Entity side info
let entityCampP = document.createElement('p');
entityCampP.className = `entity-type-info entity-camp ${entite.side}`;
entityCampP.textContent = `Camp ${entite.side}`;
entityScan.appendChild(entityCampP);

// Close button
let closeScanSpan = document.createElement('span');
closeScanSpan.id = `closeScan_${entite.id}`;
closeScanSpan.className = 'close-scanentity';
closeScanSpan.textContent = 'X';
entityScan.appendChild(closeScanSpan);

// Créer le conteneur principal
let entitePrioPhraseDiv = document.createElement('div');
entitePrioPhraseDiv.id = `entitePrioPhrase_${entite.id}`;
entitePrioPhraseDiv.className = 'entite-prio-phrase';


// Créer le texte principal
let entitePrioPhraseStrong = document.createElement('div');
entitePrioPhraseStrong.className = 'entite-prio-phrase-help';

if (isHexAttack) {
    entitePrioPhraseStrong.innerHTML = `Cases disponibles au ciblage de l'<div class="Invocateur-txt-color">Invocateur</div> :`;
}

// Ajouter le texte principal à la div
entitePrioPhraseDiv.appendChild(entitePrioPhraseStrong);

// 🎯 Créer et remplir la div de zone cible
const targetZoneDiv = document.createElement('div');
targetZoneDiv.className = 'target-zone-role-display';
const targetZoneName = entite.targetZone || 'aucune';
targetZoneDiv.innerHTML = `<span class="target-zone-name">${targetZoneName}</span> ciblé en priorité.`;

// Ajouter à la div principale
entitePrioPhraseDiv.appendChild(targetZoneDiv);

// Injecter dans le DOM
// entityScan.appendChild(entitePrioPhraseDiv);

// Create the parent div
let scanControlDiv = document.createElement('div');
scanControlDiv.id = `scan-control_${entite.id}`;
scanControlDiv.className = 'scan-control';
entityScan.appendChild(scanControlDiv);

// Info button
let detailScanSpan = document.createElement('span');
detailScanSpan.id = `detailScan_${entite.id}`;
detailScanSpan.className = 'detail-scanentity';
scanControlDiv.appendChild(detailScanSpan);

let loreScanSpan = document.createElement('span');
loreScanSpan.id = `loreScan_${entite.id}`;
loreScanSpan.className = 'lore-scanentity';
scanControlDiv.appendChild(loreScanSpan);

let targetScanSpan = document.createElement('span');
targetScanSpan.id = `targetScan_${entite.id}`;
targetScanSpan.className = 'target-scanentity';
scanControlDiv.appendChild(targetScanSpan);

// Entity name info
let entityNameH2 = document.createElement('h2');
entityNameH2.className = 'entity-name-info';
entityNameH2.innerHTML = `lvl. ${entite.level.current} - ${entite.name}`;

// // Entity level info
// let entityLevelH2 = document.createElement('h2');
// entityLevelH2.className = 'entity-name-info';
// entityLevelH2.textContent = `lvl. ${entite.level.current}`;

let entityNickNameH2 = document.createElement('h2');
entityNickNameH2.className = 'entity-nickname-info';
if (entite.nickname) {
    entityNickNameH2.textContent = `${entite.nickname}`;
}

// Health bar container
let healthBarContainerDiv = document.createElement('div');
healthBarContainerDiv.className = 'health-bar-container details';


// (Optionnel) Ajoute aussi les compteurs HP + Armure à côté
const lifeCounter = createLifeCounter(entite);
if (lifeCounter) {
  healthBarContainerDiv.appendChild(lifeCounter);
}

// 🧩 Création et ajout des barres de vie + armure
const lifeBars = createLifeBars(entite);
if (lifeBars) {
  healthBarContainerDiv.appendChild(lifeBars);
}



// CLONE VISUEL DE LA JAUGE ATB POUR LE SCAN
const realATB = document.getElementById(`atbFill_${entite.id}`);

const atbTimer = document.createElement('div');
atbTimer.id = `speedTimer_${entite.id}`;
atbTimer.className = 'atb-scan-counter';
atbTimer.innerHTML = 'ATB :<br>0.0 / 0.0s';

    const atbScanContainer = document.createElement('div');
    atbScanContainer.id = `scanATB_${entite.id}`;
    atbScanContainer.className = 'atb-scan-container';

    const atbScanFill = realATB.cloneNode(false); // clone visuel
    atbScanFill.id = `scanATBFill_${entite.id}`;
    atbScanFill.className = 'atb-scan-fill';

	atbScanContainer.appendChild(atbTimer);
    atbScanContainer.appendChild(atbScanFill);
    
    // Animation continue en sync
    const syncScanATB = () => {
        if (!atbScanFill.isConnected || !realATB.isConnected) return;
        atbScanFill.style.width = realATB.style.width;
        requestAnimationFrame(syncScanATB);
    };
    requestAnimationFrame(syncScanATB);
	

// Focus listing
let focusListingDiv = document.createElement('div');
focusListingDiv.className = `flisting-${entite.type} focus-${entite.type} focus-listing ${entite.classe}`;
focusListingDiv.id = `listing_${entite.id}`;

// Si l'entité est de type 'lord', ajoute la structure de base pour les cibles
if (isLord(entite)) {
    // Créer la div pour les cibles "no-target"
    const noTargetContainer = document.createElement('div');
    noTargetContainer.className = 'listing-focus-lord-no-target';

    // Créer la div intérieure avec les classes spécifiées
    const innerDiv = document.createElement('div');
    innerDiv.className = 'lord-target-pic no-target';

    // Ajouter la div intérieure au conteneur "no-target"
    noTargetContainer.appendChild(innerDiv);

    // Créer le message "Pas de cible pour le moment"
    const noTargetMessage = document.createElement('div');
    noTargetMessage.className = 'no-target-message';
    noTargetMessage.textContent = 'Pas de cible pour le moment';

    // Ajouter le message "Pas de cible pour le moment" au conteneur "no-target"
    noTargetContainer.appendChild(noTargetMessage);

    // Ajouter le conteneur "no-target" au focusListingDiv
    focusListingDiv.appendChild(noTargetContainer);
}

// Insérer le contenu généré, si applicable
focusListingDiv.innerHTML += `${listingFocusContent}`;

// Ajouter le focusListingDiv au parent spécifié
entityScan.appendChild(focusListingDiv);
// END FOCUS LISTING

// Entity type info
let entityTypeStrong = document.createElement('strong');
entityTypeStrong.className = 'entity-type-info';
entityTypeStrong.textContent = `${entite.type}`;
entityScan.appendChild(entityTypeStrong);

// Entity role container
let entityRoleContainerDiv = document.createElement('div');
entityRoleContainerDiv.className = `entity-role-container ${entite.classe}`;
let entityRolePictoDiv = document.createElement('div');
entityRolePictoDiv.className = `entity-role-picto role-${entite.role}`;
if (combatProfile.domains.includes('necro')) {
    let entityNecroPictoDiv = document.createElement('div');
    entityNecroPictoDiv.className = `entity-Necro-picto`;
    entityRoleContainerDiv.appendChild(entityNecroPictoDiv);
}
let entityRoleHexastone = document.createElement('div');
entityRoleHexastone.className = `RoleHexastone ${entite.classe}`;
entityRoleContainerDiv.appendChild(entityRolePictoDiv);

let entityRoleTitleStrong = document.createElement('strong');
let entityRoleTitleDiv = document.createElement('div');
entityRoleTitleDiv.className = 'entity-role-title';
entityRoleTitleDiv.textContent = `${entite.role} `;

let entityClassP = document.createElement('p');
entityClassP.className = `entity-type-info entity-class ${entite.classe}`;
applyCombatProfileView(entityClassP, entite, { text: true, helper: true });

let entityRoleBadgeContainerDiv = document.createElement('div');
entityRoleBadgeContainerDiv.className = `entity-role-BadgeContainer ${entite.classe}`;
applyCombatProfileView(entityRoleBadgeContainerDiv, entite);
applyCombatProfileView(entityRoleContainerDiv, entite);
applyCombatProfileView(entityRoleHexastone, entite);

entityRoleContainerDiv.appendChild(entityRolePictoDiv);
entityRoleTitleStrong.appendChild(entityRoleTitleDiv);
entityRoleContainerDiv.appendChild(entityClassP);
entityRoleContainerDiv.appendChild(entityRoleTitleStrong);
entityRoleBadgeContainerDiv.appendChild(entityRoleContainerDiv);
entityRoleBadgeContainerDiv.appendChild(entityRoleHexastone);

// Entity detail columns
let entiteDetailColumnsDiv = document.createElement('div');
entiteDetailColumnsDiv.className = 'entite-detail-colomns';

// ENTITY STATS
let entiteDetailColomn2Div = document.createElement('div');
entiteDetailColomn2Div.className = 'entite-detail-colomn-2';

let entiteStatColomnDiv = document.createElement('div');
entiteStatColomnDiv.className = 'entite-stat-colomn';

let basicAttributesStrong = document.createElement('strong');
basicAttributesStrong.textContent = 'Attributs de base';
basicAttributesStrong.className = 'entite-stat-title';


// Vérification des types d'attaques
const hasHybridAttack = entite.attacks.some(attackName => {
    const attack = resolveAttackDefinitionForEntity(entite, attackName, attackDetails);
    return attack && attack.attacknature.includes('hybridalDamage');
});

const piercingDamageValue = Math.max(0, Number(getSafe(entite, "piercingDamage", 0)) || 0);
const haspiercingDamageAttack = piercingDamageValue > 0;


// Ajout des dégâts physiques et magiques
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "physicalDamage", 0), entite, "physicalDamage");
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "magicalDamage", 0), entite, "magicalDamage");
if (hasHybridAttack) {
    createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "magicalDamage", 0) + getSafe(entite, "physicalDamage", 0), entite, "hybridalDamage");
}
if (piercingDamageValue > 0 && haspiercingDamageAttack) {
    createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "piercingDamage", 0), entite, "piercingDamage");
}
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "physicalResistance", 0), entite, "physicalResistance");
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "magicalResistance", 0), entite, "magicalResistance");
if (entite.stats?.extraLife?.current > 0) {
    createUmbraBlock(entiteStatColomnDiv, "", () => entite.stats.extraLife.current, entite);
}
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "vitality", 0), entite, "vitality");
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "dodge", 0), entite, "dodge");
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "vision", 0), entite, "vision");
createUmbraBlock(entiteStatColomnDiv, "", () => getSafe(entite, "velocity", 0), entite, "velocity");

// Suppression des divs vides
[...entiteStatColomnDiv.children].forEach(child => {
    if (child.innerHTML.trim() === '') {
        console.log('Suppression de la div vide:', child);
        child.remove();
    }
});

// Ajout des éléments dans la structure principale
entiteDetailColomn2Div.appendChild(basicAttributesStrong);
entiteDetailColomn2Div.appendChild(entiteStatColomnDiv);


let entiteDetailColomn1Div = document.createElement('div');
entiteDetailColomn1Div.className = 'entite-detail-colomn-1';
let combatDataStrong = document.createElement('strong');
combatDataStrong.textContent = 'Combat du niveau';
const levelBattleStats = getLevelBattleStats(entite);
let killsDiv = document.createElement('div');
killsDiv.id = `Kills_${entite.id}`;
killsDiv.textContent = `Kills : ${levelBattleStats.kills}`;
let totalDamageDiv = document.createElement('div');
totalDamageDiv.id = `TotalDamages_${entite.id}`;
totalDamageDiv.textContent = `Dégâts : ${levelBattleStats.totalDamage}`;
let totalHealDiv = document.createElement('div');
totalHealDiv.id = `TotalHeal_${entite.id}`;
totalHealDiv.textContent = `Soins : ${levelBattleStats.totalHeal}`;
entiteDetailColomn1Div.appendChild(combatDataStrong);
entiteDetailColomn1Div.appendChild(killsDiv);
entiteDetailColomn1Div.appendChild(totalDamageDiv);
entiteDetailColomn1Div.appendChild(totalHealDiv);
for (const [key, label] of [
    ['deaths', 'Morts'],
    ['resurrections', 'Résurrections'],
    ['overkills', 'Overkills'],
    ['battlesFought', 'Combats menés'],
    ['extraLivesUsed', 'Vies supplémentaires consommées'],
]) {
    const row = document.createElement('div');
    row.textContent = `${label} : `;
    const value = document.createElement('span');
    value.dataset.levelBattleStat = key;
    value.dataset.entityId = entite.id;
    value.textContent = levelBattleStats[key];
    row.appendChild(value);
    entiteDetailColomn1Div.appendChild(row);
}

entiteDetailColumnsDiv.appendChild(entiteDetailColomn2Div);
entiteDetailColumnsDiv.appendChild(entiteDetailColomn1Div);
entityScan.appendChild(entiteDetailColumnsDiv);

// Attack details
let attackDetailsDiv = document.createElement('div');
attackDetailsDiv.className = `attack-details-activetimers`;
attackDetailsDiv.id = `attackTimers_${entite.id}`;  

// Conteneur des attaques
const attackContainer = document.createElement('div');
attackContainer.className = 'entite-attack-container';

attackContainer.appendChild(createEntityAttackDisplay(entite, { presentation: 'combat' }));

// Sélectionner ou créer la div AllEntitiesHud
var allEntitiesHud = document.querySelector('.AllEntitiesHud');

// Créer ou sélectionner la div .AllEntitiesScan à l'intérieur de AllEntitiesHud
var allEntitiesScan = document.querySelector('.AllEntitiesHud .AllEntitiesScan');

if (!allEntitiesScan) {
    allEntitiesScan = document.createElement('div');
    allEntitiesScan.className = 'AllEntitiesScan';
    allEntitiesHud.appendChild(allEntitiesScan);
}

let activAttackInfos = document.createElement('div');
activAttackInfos.className = `active-attack-infos`;
activAttackInfos.id = `ActiveAttackInfos_${entite.id}`;  

activAttackInfos.appendChild(entitePrioPhraseDiv);
// currentAttackTimers(entite, activAttackInfos);


// Ajouter les entityScan directement à .AllEntitiesScan
allEntitiesScan.appendChild(entityScan);
updateEntityAttackTargetDisplay(entite);
// Créer le conteneur principal pour les détails de l'entité
let entityScanContainer = document.createElement('div');
entityScanContainer.className = 'entite-details-Container';
entityScanContainer.id = `entiteDetailsContainer_${entite.id}`;


let entityLoreContainer = document.createElement('div');
entityLoreContainer.className = 'entite-lore-Container';
entityLoreContainer.id = `entiteLoreContainer_${entite.id}`;

// Ajouter tous les éléments déjà créés dans ce conteneur
entityScanContainer.appendChild(detailsImageDiv);
entityScanContainer.appendChild(entityCampP);
entityScanContainer.appendChild(entityNickNameH2);
entityScanContainer.appendChild(entityNameH2);
healthBarContainerDiv.appendChild(lifeBars);
entityScanContainer.appendChild(atbScanContainer);
entityScanContainer.appendChild(healthBarContainerDiv);
entityScanContainer.appendChild(atbScanContainer);
entityScanContainer.appendChild(activAttackInfos);
entityScanContainer.appendChild(entityTypeStrong);
entityScanContainer.appendChild(entityRoleBadgeContainerDiv);
entityScanContainer.appendChild(entiteDetailColumnsDiv);
entityScanContainer.appendChild(attackDetailsDiv);
entityScanContainer.appendChild(attackContainer);

// 🧰 Injection des stuffs
let codexColumn1 = document.createElement('div');
codexColumn1.className = 'stuff-battle';
codexColumn1.id = `stuffBattle_${entite.id}`;
createStuffDom(entite, codexColumn1);
entityScan.appendChild(codexColumn1);


// LORE
let clonedEntityNameH2 = entityNameH2.cloneNode(true);
clonedEntityNameH2.classList.add('lore');
entityLoreContainer.appendChild(clonedEntityNameH2);

let loreText = document.createElement('span');
loreText.className = 'lore-entite';

if (entite && entite.lore) {
    loreText.innerHTML = `<span class="lettrine">${entite.lore.charAt(0)}</span>${entite.lore.slice(1)}`;
} else {
    loreText.innerHTML = 'Données insuffisantes sur l\'Entité. Pour le moment...';
}

entityLoreContainer.appendChild(loreText);
entityScan.appendChild(entityScanContainer);
entityScan.appendChild(entityLoreContainer);
entityScan.appendChild(closeScanSpan);
allEntitiesScan.appendChild(entityScan);
updateRoleInDOM(entite);
updateEntityAttackTargetDisplay(entite);

	}
	
function currentAttackTimers(entite, container) {
    const attackTimers = document.createElement('div');
    attackTimers.id = `attackTimers_${entite.id}`;
    attackTimers.className = 'attaque-timers';

    const visualGroup = document.createElement('div');
    visualGroup.className = `active-attack-visual ${entite.classe}`;

    const attack = resolveAttackDefinitionForEntity(
        entite,
        entite.currentAttackId || entite.attacks?.[0],
        attackDetails
    );
    const currentAttackImage = document.createElement('img');
    currentAttackImage.id = `currentAttackImage_${entite.id}`;
    currentAttackImage.className = 'attack-image';
    currentAttackImage.src = cachedResourceUrl(attack?.attackAsset
    ? `${attack.attackAsset}-ld.jpg`
    : '');
    currentAttackImage.alt = attack?.displayName || '';
    visualGroup.appendChild(currentAttackImage);

    const timingsWrapper = document.createElement('div');
    timingsWrapper.className = 'active-attack-timings';

    const attackBarContainer = document.createElement('div');
    attackBarContainer.className = 'attack-bar-container';

    const attackBarFill = document.createElement('div');
    attackBarFill.id = `currentAttackBar_${entite.id}`;
    attackBarFill.className = `attack-bar-fill empty ${entite.classe}`;
    attackBarFill.style.width = '0%';

    attackBarContainer.appendChild(attackBarFill);

    const timerGroup = document.createElement('div');
    timerGroup.className = 'active-attack-text';

    const makeTimerBlock = (idSuffix, label) => {
        const div = document.createElement('div');
        div.id = `${idSuffix}_${entite.id}`;
        div.className = 'attaque-timers-active';
        div.innerHTML = `${label} :<br>0.0 / 0.0s`;
        return div;
    };

    const timerBlocks = {
        cooldown: makeTimerBlock('cooldownDisplay', 'Cooldown'),
        preparation: makeTimerBlock('preparationTimer', 'Preparation'),
        execution: makeTimerBlock('executionTimer', 'Execution'),
        recovery: makeTimerBlock('recoveryTimer', 'Recovery'),
    };
	
const battlePreparationDiv = document.createElement('div');
battlePreparationDiv.classList.add('battle-timer-display');
battlePreparationDiv.id = `battlePreparation_${entite.id}`;
battlePreparationDiv.textContent = '...'; // contenu temporaire ou vide

timerBlocks.Battlepreparation = battlePreparationDiv;
    // timerGroup.appendChild(timerBlocks.cooldown);
timerGroup.appendChild(timerBlocks.Battlepreparation);
    // timerGroup.appendChild(timerBlocks.execution);
    // timerGroup.appendChild(timerBlocks.recovery);

    // 🔄 Changement ici : on ajoute timerGroup dans attackBarContainer
    attackBarContainer.appendChild(timerGroup);
    timingsWrapper.appendChild(attackBarContainer);
    visualGroup.appendChild(timingsWrapper);
    attackTimers.appendChild(visualGroup);
    container.appendChild(attackTimers);
}

export function CreateATBEntity(entite, { mirror = false } = {}) {
    const suffix = mirror ? `combat_${entite.id}` : entite.id;
    const SpeedInterface = document.createElement('div');
    SpeedInterface.id = `SpeedInterface_${suffix}`;
    SpeedInterface.className = 'speed-interface';

    const atbJauge = document.createElement('div');
    atbJauge.id = `atbJauge_${suffix}`;
    atbJauge.className = 'atb-container';

    const atbFill = document.createElement('div');
    atbFill.id = `atbFill_${suffix}`;
    atbFill.className = 'atb-fill';

    atbJauge.appendChild(atbFill);
    SpeedInterface.appendChild(atbJauge);

    if (mirror) {
        const source = document.getElementById(`SpeedInterface_${entite.id}`);
        const sourceFill = document.getElementById(`atbFill_${entite.id}`);
        const sourceBox = document.getElementById(`Box_Entite_${entite.id}`);
        // Reuse the board ATB's resolved state, including orders and search pulses.
        const observer = new MutationObserver(() => {
            SpeedInterface.className = source?.className || 'speed-interface';
            for (const state of ['entity-target-searching', 'entity-target-search-failed', 'entity-cooldown-waiting']) {
                SpeedInterface.classList.toggle(state, Boolean(sourceBox?.classList.contains(state)));
            }
            atbFill.className = sourceFill?.className || 'atb-fill';
            atbFill.style.cssText = sourceFill?.style.cssText || '';
        });
        SpeedInterface.className = source?.className || 'speed-interface';
        for (const state of ['entity-target-searching', 'entity-target-search-failed', 'entity-cooldown-waiting']) {
            SpeedInterface.classList.toggle(state, Boolean(sourceBox?.classList.contains(state)));
        }
        atbFill.className = sourceFill?.className || 'atb-fill';
        atbFill.style.cssText = sourceFill?.style.cssText || '';
        if (source) observer.observe(source, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
        if (sourceBox) observer.observe(sourceBox, { attributes: true, attributeFilter: ['class'] });
        SpeedInterface.dispose = () => observer.disconnect();
    }

    return SpeedInterface; // On retourne l'élément DOM complet
}

// Combat actors use a compiled presentation: layout is sampled on creation/resize,
// while frames consume combat data and timed presentation commands. The existing
// HTML remains the input and paused-scene adapter.
const monsterViews = new WeakSet(), monsterImages = new Map(), monsterResources = new Map();
const monsterClassStyles=new Map(),monsterClassAnimations=new Map();
let monsterTextureId = 0, activeMonsterViews = 0, monsterCacheEpoch = 0;
const monsterStyle = node => getComputedStyle(node);
// Only creation, presentation commands and layout events sample the HTML.
// Frames below read the compiled records and the combat clock exclusively.
const monsterClamp = value => Math.max(0, Math.min(1, value));
const monsterColorFilter = value => (String(value).match(/(?:grayscale|saturate|sepia|contrast|hue-rotate|invert)\([^)]+\)/g)||[]).join(' ');
function monsterEase(value, easing = 'linear') {
  if (easing === 'linear') return value;
  const presets = { ease: [.25,.1,.25,1], 'ease-in': [.42,0,1,1], 'ease-out': [0,0,.58,1], 'ease-in-out': [.42,0,.58,1] };
  const bezier = presets[easing] || easing.match(/cubic-bezier\(([^)]+)\)/)?.[1].split(',').map(Number);
  if (!bezier) return value;
  const [a,b,c,d] = bezier, cubic = (t,x,y) => 3*(1-t)**2*t*x+3*(1-t)*t*t*y+t**3;
  let low=0, high=1;
  for(let n=0;n<12;n++){const t=(low+high)/2;if(cubic(t,a,c)<value)low=t;else high=t;}
  return cubic((low+high)/2,b,d);
}
function monsterValue(key, value, size = {width: 1, height: 1}) {
  if (key === 'filter') {
    const matches = [...String(value).matchAll(/brightness\(([^)]+)\)/g)];
    return [matches.reduce((v, m) => v * parseFloat(m[1]) / (m[1].includes('%') ? 100 : 1), 1)];
  }
  if (key === 'transform') {
    // DOMMatrix cannot resolve percentages. Resolve against the cached local
    // box, including CSS calc() offsets, when compiling a command/keyframe.
    const transform = String(value || 'none').replace(/(translate(?:3d|X|Y)?)\(((?:[^()]|calc\([^)]*\))*)\)/gi, (_, name, args) => {
      const values = args.split(',').map((arg, i) => {
        const length = name.toLowerCase() === 'translatey' || i === 1 ? size.height : size.width;
        let result = arg.replace(/(-?[\d.]+)%/g, (_, n) => `${Number(n) * length / 100}px`);
        result = result.replace(/calc\(([^)]+)\)/g, (_, expression) => `${[...expression.matchAll(/[+-]?\s*[\d.]+/g)].reduce((sum, m) => sum + Number(m[0].replace(/\s/g, '')), 0)}px`);
        return result;
      });
      return `${name}(${values.join(',')})`;
    });
    const m = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  }
  if (key === 'scale') {
    const values = String(value || '1').split(' ').map(Number);
    const x = Number.isFinite(values[0]) ? values[0] : 1;
    return [x, Number.isFinite(values[1]) ? values[1] : x];
  }
  if (key === 'opacity') return [value === '' ? 1 : Number(value)];
  return [parseFloat(value) || 0];
}
const monsterLerp = (a,b,t) => a.map((v,i)=>v+(b[i]-v)*t);
function monsterAnimation(animation, binding) {
  const timing=animation.effect.getTiming(), now=clockNow(), keys=['transform','scale','opacity','left','top','filter'];
  const frames=animation.effect.getKeyframes(), tracks={};
  for(const key of keys) {
    const values=frames.filter(frame=>frame[key]!==undefined).map(frame=>({at:frame.computedOffset??frame.offset,value:monsterValue(key,frame[key],binding),easing:frame.easing}));
    if(values.length)tracks[key]=values;
  }
  const data={tracks,start:now-Number(animation.currentTime||0),duration:Number(timing.duration)||1,delay:Number(timing.delay)||0,
    iterations:timing.iterations,direction:timing.direction,easing:timing.easing,fill:timing.fill,rate:animation.playbackRate||1};
  animation.addEventListener('cancel',()=>{data.cancelled=true;},{once:true});
  return data;
}
function monsterAnimatedValues(binding, now) {
  if(!binding.tweens.size&&!binding.animations.length)return binding.values;
  const values={...binding.values};
  for(const [key,tween] of binding.tweens) {
    const t=monsterClamp((now-tween.start)/tween.duration);
    values[key]=monsterLerp(tween.from,tween.to,monsterEase(t,tween.easing));
    if(t===1)binding.tweens.delete(key);
  }
  for(let index=binding.animations.length-1;index>=0;index--){const a=binding.animations[index];
    if(a.cancelled||now>=a.start+a.delay+a.duration*a.iterations/a.rate&&!['forwards','both'].includes(a.fill))binding.animations.splice(index,1);
  }
  for(const animation of binding.animations) {
    if(animation.cancelled)continue;
    const elapsed=(now-animation.start)*animation.rate-animation.delay;
    if(elapsed<0)continue;
    const total=animation.duration*animation.iterations;
    if(elapsed>=total && !['forwards','both'].includes(animation.fill))continue;
    const iteration=Math.min(Math.floor(elapsed/animation.duration),Math.max(0,animation.iterations-1));
    let t=elapsed>=total?1:(elapsed%animation.duration)/animation.duration;
    if(animation.direction==='reverse'||animation.direction==='alternate'&&iteration%2||animation.direction==='alternate-reverse'&&!(iteration%2))t=1-t;
    t=monsterEase(t,animation.easing);
    for(const [key,frames] of Object.entries(animation.tracks)) {
      let a=frames[0],b=frames.at(-1);
      for(let i=1;i<frames.length;i++)if(t<=frames[i].at){a=frames[i-1];b=frames[i];break;}
      values[key]=monsterLerp(a.value,b.value,monsterEase(monsterClamp((t-a.at)/(b.at-a.at||1)),a.easing));
    }
  }
  return values;
}
const monsterPanels = new Map(), monsterTextTextures = new Map();
function releaseMonsterText(entry, scene) {
  if (!entry || --entry.users !== 0) return;
  if (monsterTextTextures.size > 512) {
    for (const [key, cached] of monsterTextTextures) {
      if (cached.users === 0) { scene.textures.remove(cached.texture); monsterTextTextures.delete(key); }
      if (monsterTextTextures.size <= 512) break;
    }
  }
}
function updateMonsterText(layer, scene, css, text) {
  if (layer.text === text && layer.color === css.color) return;
  layer.text = text; layer.color = css.color;
  const font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  const key = `${font}|${css.color}|${css.textShadow}|${css.webkitTextStrokeWidth}|${css.webkitTextStrokeColor}|${text}`;
  if (layer.textEntry?.key === key) return;
  let entry = monsterTextTextures.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.font = font;
    const metrics = ctx.measureText(text), size = parseFloat(css.fontSize);
    const width = Math.max(1, Math.ceil(metrics.width)), height = Math.max(1, Math.ceil(size * 1.3));
    const shadows=monsterCommaList(css.textShadow||'none').filter(value=>value!=='none').map(monsterShadow);
    const padding=Math.ceil(Math.max(4,...shadows.map(shadow=>Math.abs(shadow.x)+Math.abs(shadow.y)+shadow.blur*2)));
    canvas.width = (width + padding * 2) * 2; canvas.height = (height + padding * 2) * 2; ctx.scale(2, 2); ctx.font = font;
    ctx.fillStyle=css.color;ctx.textBaseline='alphabetic';
    const baseline=padding+(height+metrics.actualBoundingBoxAscent-metrics.actualBoundingBoxDescent)/2;
    // Draw shadow glyphs outside the surface, so their fill cannot cover earlier
    // shadows. Canvas shadow offsets use physical pixels (the surface is 2x).
    for(const shadow of shadows.reverse()){
      ctx.save();ctx.shadowColor=shadow.color;ctx.shadowOffsetX=(10000+shadow.x)*2;
      ctx.shadowOffsetY=shadow.y*2;ctx.shadowBlur=shadow.blur*2;
      ctx.fillText(text,padding-10000,baseline);ctx.restore();
    }
    const stroke=parseFloat(css.webkitTextStrokeWidth)||0;
    if(stroke){ctx.lineWidth=stroke;ctx.strokeStyle=css.webkitTextStrokeColor;ctx.lineJoin='round';ctx.strokeText(text,padding,baseline);}
    ctx.fillText(text,padding,baseline);
    const texture = `monster-text-${++monsterTextureId}`; scene.textures.addImage(texture, canvas);
    monsterTextTextures.set(key, entry = { key, texture, width, height, padding, users: 0 });
  }
  entry.users++; releaseMonsterText(layer.textEntry, scene); layer.textEntry = entry;
  if (!layer.image) layer.image = scene.add.image(0, 0, entry.texture).setOrigin(0);
  else layer.image.setTexture(entry.texture);
}
// Panel recipes contain only native Phaser parts: backgrounds, icons and text.
// The CSS theme is sampled when a component is created/changed. No HTML is cloned,
// serialized, embedded in SVG or painted into a screenshot texture.
const monsterDecorations = new Map();
const monsterPanelSelector = '.hud-ingame,.attaque-timers,.combat-popup-life,.target-search-indicator,.runaway-info,.order-exclamation,.melee-motion-trail,.shield-sweep-layer';
const monsterBars = '.health-bar,.armor-bar,.atb-fill,.attack-bar-fill';
const monsterTexts = '.HP-counter,.armor-text,.current-shift,.timer-activeattack';
const monsterDynamic = `${monsterBars},${monsterTexts},.attaque-timers`;
const monsterPaintKeys = ['backgroundColor','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor',
  'borderTopStyle','borderRadius','boxShadow','clipPath','filter','fontStyle','fontWeight','fontSize','fontFamily','textShadow',
  'webkitTextStrokeWidth','webkitTextStrokeColor','maskImage','color','opacity','display','zIndex','transform','transformOrigin'];
const monsterPaintStyle = css => Object.fromEntries(monsterPaintKeys.map(key => [key, css[key]]));
function monsterCommaList(value) {
  const result = []; let start = 0, depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && !depth) { result.push(value.slice(start,i).trim()); start=i+1; }
  }
  result.push(value.slice(start).trim()); return result;
}
const monsterColorVisible = color => color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)/.test(color);
const monsterLength = (value, total) => parseFloat(value) * (String(value).includes('%') ? total / 100 : 1) || 0;
function monsterShape(ctx, css, w, h) {
  ctx.beginPath();
  if (css.clipPath?.startsWith('polygon(')) {
    monsterCommaList(css.clipPath.slice(8,-1)).forEach((point,i) => {
      const [x,y]=point.split(/\s+/); ctx[i?'lineTo':'moveTo'](monsterLength(x,w),monsterLength(y,h));
    }); ctx.closePath();
  } else {
    const radius=css.borderRadius?.split(/[ /]/)[0] || '0';
    ctx.roundRect(0,0,w,h,Math.min(w/2,h/2,monsterLength(radius,Math.min(w,h))));
  }
}
function monsterGradient(ctx, source, w, h) {
  const radial=source.startsWith('radial'), content=source.slice(source.indexOf('(')+1,-1), args=monsterCommaList(content);
  let direction=args[0], gradient;
  if (/^(?:rgb|hsl|#|transparent)/.test(direction)) direction=radial?'circle':'180deg'; else args.shift();
  if (radial) gradient=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)/2);
  else {
    const degrees=direction.includes('deg')?parseFloat(direction):direction.includes('right')?90:direction.includes('left')?270:direction.includes('top')?0:180;
    const dx=Math.sin(degrees*Math.PI/180),dy=-Math.cos(degrees*Math.PI/180),length=Math.abs(w*dx)+Math.abs(h*dy);
    gradient=ctx.createLinearGradient(w/2-dx*length/2,h/2-dy*length/2,w/2+dx*length/2,h/2+dy*length/2);
  }
  args.forEach((stop,i)=>{
    const match=stop.match(/^(rgba?\([^)]+\)|hsla?\([^)]+\)|#[\da-f]+|[a-z]+)(?:\s+([\d.]+)(%|px))?/i);
    if(match)gradient.addColorStop(monsterClamp(match[2]===undefined?i/Math.max(1,args.length-1):Number(match[2])/(match[3]==='%'?100:Math.max(w,h))),match[1]);
  }); return gradient;
}
function monsterShadow(value) {
  const color=value.match(/rgba?\([^)]+\)|#[\da-f]+/i)?.[0] || 'black';
  const numbers=[...value.replace(color,'').matchAll(/(-?[\d.]+)px/g)].map(m=>Number(m[1]));
  return {color,x:numbers[0]||0,y:numbers[1]||0,blur:numbers[2]||0,spread:numbers[3]||0,inset:value.includes('inset')};
}
async function monsterMediaImage(source) {
  const key=persistentMediaMarkup(source);
  if(!monsterResources.has(key))monsterResources.set(key,loadResource(key).then(async resource=>{
    if(resource.image)return resource.image;
    if(!resource.blob.type.startsWith('image/'))return null;
    const image=new Image();image.src=resource.url;await image.decode();return image;
  }));
  return monsterResources.get(key);
}
async function monsterDecoration(scene, css, width, height, imageSource = '') {
  const w=Math.max(1,Math.ceil(width)),h=Math.max(1,Math.ceil(height));
  const borders=['Top','Right','Bottom','Left'].map(side=>({width:parseFloat(css[`border${side}Width`])||0,color:css[`border${side}Color`]}));
  const hasBorder=borders.some(b=>b.width&&monsterColorVisible(b.color));
  if(!imageSource&&!hasBorder&&!monsterColorVisible(css.backgroundColor)&&css.backgroundImage==='none'&&css.boxShadow==='none')return null;
  const key=JSON.stringify([w,h,imageSource,css.maskImage,...monsterPaintKeys.slice(0,19).map(k=>persistentMediaMarkup(css[k]||''))]);
  if(!monsterDecorations.has(key))monsterDecorations.set(key,(async()=>{
    const epoch=monsterCacheEpoch, shadows=monsterCommaList(css.boxShadow||'none').filter(v=>v!=='none').map(monsterShadow);
    const filterPadding=css.filter?.includes('drop-shadow')||css.filter?.includes('blur')?24:0;
    const padding=Math.ceil(Math.max(2,filterPadding,...shadows.map(s=>Math.abs(s.x)+Math.abs(s.y)+s.blur*2+Math.abs(s.spread))));
    const canvas=document.createElement('canvas');canvas.width=(w+padding*2)*2;canvas.height=(h+padding*2)*2;
    const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.translate(padding,padding);ctx.filter=css.filter||'none';
    for(const shadow of shadows.filter(s=>!s.inset)) {
      ctx.save();ctx.shadowColor=shadow.color;ctx.shadowOffsetX=shadow.x*2;ctx.shadowOffsetY=shadow.y*2;ctx.shadowBlur=shadow.blur*2;
      monsterShape(ctx,css,w,h);ctx.fillStyle=shadow.color;ctx.fill();ctx.restore();
      // Box shadows occupy only the outside; transparent badges stay hollow.
      ctx.save();ctx.filter='none';ctx.globalCompositeOperation='destination-out';monsterShape(ctx,css,w,h);ctx.fill();ctx.restore();
    }
    ctx.save();monsterShape(ctx,css,w,h);ctx.clip();
    if(monsterColorVisible(css.backgroundColor)){ctx.fillStyle=css.backgroundColor;ctx.fillRect(0,0,w,h);}
    const backgrounds=monsterCommaList(css.backgroundImage||'none').reverse();
    for(const background of backgrounds) {
      if(background.includes('gradient(')){ctx.fillStyle=monsterGradient(ctx,background,w,h);ctx.fillRect(0,0,w,h);}
      else if(background.startsWith('url(')) {
        const source=background.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        if(source){const img=await monsterMediaImage(source);if(!img)continue;
          const size=css.backgroundSize?.split(' ')||[],pos=css.backgroundPosition?.split(' ')||[];
          let iw=w,ih=h;
          if(size[0]==='contain'||size[0]==='cover'){const scale=Math[size[0]==='contain'?'min':'max'](w/img.naturalWidth,h/img.naturalHeight);iw=img.naturalWidth*scale;ih=img.naturalHeight*scale;}
          else if(size[0]&&size[0]!=='auto'){iw=monsterLength(size[0],w);ih=size[1]&&size[1]!=='auto'?monsterLength(size[1],h):iw*img.naturalHeight/img.naturalWidth;}
          else if(/\.svg(?:[?#]|$)/i.test(persistentMediaMarkup(source))){const scale=Math.min(w/img.naturalWidth,h/img.naturalHeight);iw=img.naturalWidth*scale;ih=img.naturalHeight*scale;}
          else {iw=img.naturalWidth;ih=img.naturalHeight;}
          const x=monsterLength(pos[0]||'0',w-iw),y=monsterLength(pos[1]||'0',h-ih);
          if(['repeat','repeat-x','repeat-y'].includes(css.backgroundRepeat)&&iw>0&&ih>0){const rx=css.backgroundRepeat!=='repeat-y',ry=css.backgroundRepeat!=='repeat-x';for(let py=ry?y-Math.ceil(y/ih)*ih:y;py<h;py+=ih){for(let px=rx?x-Math.ceil(x/iw)*iw:x;px<w;px+=iw){ctx.drawImage(img,px,py,iw,ih);if(!rx)break;}if(!ry)break;}}
          else ctx.drawImage(img,x,y,iw,ih);
        }
      }
    }
    if(imageSource){const image=await monsterMediaImage(imageSource);if(image)ctx.drawImage(image,0,0,w,h);}
    // Individual sides also preserve the triangular cooldown/hourglass markers.
    borders.forEach((border,i)=>{
      if(!border.width||!monsterColorVisible(border.color))return;
      ctx.fillStyle=border.color;ctx.beginPath();
      const [t,r,b,l]=borders.map(v=>v.width);
      const points=[[[0,0],[w,0],[w-r,t],[l,t]],[[w,0],[w,h],[w-r,h-b],[w-r,t]],[[w,h],[0,h],[l,h-b],[w-r,h-b]],[[0,h],[0,0],[l,t],[l,h-b]]][i];
      points.forEach(([x,y],n)=>ctx[n?'lineTo':'moveTo'](x,y));ctx.closePath();ctx.fill();
    });
    ctx.restore();
    if(css.maskImage&&css.maskImage!=='none'){const source=css.maskImage.match(/url\(["']?(.*?)["']?\)/)?.[1];if(source){const mask=await monsterMediaImage(source);if(mask){ctx.save();ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0,w,h);ctx.restore();}}}
    if(epoch!==monsterCacheEpoch)throw new DOMException('Scene disposed','AbortError');
    const texture=`monster-primitive-${++monsterTextureId}`;scene.textures.addImage(texture,canvas);
    return {texture,width:w,height:h,padding,w:w+padding*2,h:h+padding*2};
  })());
  return monsterDecorations.get(key);
}
function monsterPanelKey(node, entity) {
  if(node.matches(monsterBars)) {
    const css=monsterStyle(node),fill=node.querySelector('.health-fill,.armor-fill');
    return `bar:${node.className}:${css.backgroundColor}:${css.backgroundImage}:${fill?monsterStyle(fill).backgroundColor:''}`;
  }
  if(node.classList.contains('hud-ingame'))return `hud:${entity.side}:${entity.type}:${entity.role}:${entity.level?.current??entity.level}:`+
    [node.querySelector('[id^="Targetrole-img_"]')?.className,node.querySelector('.target-picto-hud')?.className,
      ...[...node.querySelectorAll('.extraLife-counter,.fadedLife-counter,.eternalLife-counter,.hudbattletexte')].map(n=>n.textContent)].join('|');
  const elements=[node,...node.querySelectorAll('*')];
  return `${node.parentElement.className}:${node.parentElement.dataset.priority||''}:`+elements.map(n=>
    `${n.className}:${n.tagName==='IMG'?persistentMediaMarkup(n.currentSrc||n.src):''}:${n.children.length?'':n.textContent}`).join('|');
}
async function monsterPanelParts(scene, root) {
  const bounds=root.getBoundingClientRect(),width=root.matches(monsterBars)?256:Math.max(1,root.offsetWidth),height=Math.max(1,root.offsetHeight);
  const sx=width/(bounds.width||1),sy=height/(bounds.height||1),parts=[],jobs=[];
  const roleIcons=[...root.querySelectorAll('.role-img')];
  const local=rect=>({x:(rect.left-bounds.left)*sx,y:(rect.top-bounds.top)*sy,w:rect.width*sx,h:rect.height*sy});
  const boxPart=(css,rect,source='',alpha=1,angle=0)=>{
    const part={...rect,alpha,angle};parts.push(part);
    jobs.push(monsterDecoration(scene,css,rect.w,rect.h,source).then(texture=>part.decoration=texture));
    return part;
  };
  const textPart=(css,text,rect,alpha)=>{
    if(!text.trim())return;
    const part={...rect,alpha,angle:0};parts.push(part);
    // Explicit texture keys keep cosmetic text independent of combat RNG.
    updateMonsterText(part,scene,css,text);part.image.destroy();part.image=null;
  };
  const visit=(node,alpha=1,parentFilter='')=>{
    if(node!==root&&node.matches(monsterDynamic))return;
    const computed=getComputedStyle(node),css=monsterPaintStyle(computed);
    if(css.display==='none')return;
    css.filter=[parentFilter,css.filter].filter(v=>v&&v!=='none').join(' ')||'none';
    if(node!==root)alpha*=Number(css.opacity);
    const rect=local(node.getBoundingClientRect()),introIndex=roleIcons.indexOf(node);
    let introScale;
    if(introIndex>=0){
      // GrowHexIcon begins at scale(0). Compile its final box, then run its
      // original keyframes on the Phaser part with each icon's own epoch.
      const parent=node.parentElement,pr=parent.getBoundingClientRect();
      const animation=node.getAnimations().find(animation=>animation.animationName==='GrowHexIcon');
      const end=monsterValue('transform',animation?.effect.getKeyframes().at(-1).transform||css.transform,{width:node.offsetWidth,height:node.offsetHeight});
      introScale=[Math.hypot(end[0],end[1])||1,Math.hypot(end[2],end[3])||1];
      const w=node.offsetWidth*introScale[0]*(pr.width/(parent.offsetWidth||1)||1/sx)*sx;
      const h=node.offsetHeight*introScale[1]*(pr.height/(parent.offsetHeight||1)||1/sy)*sy;
      rect.x+=(rect.w-w)/2;rect.y+=(rect.h-h)/2;rect.w=w;rect.h=h;
    }
    if(rect.w>0&&rect.h>0){
      const part=boxPart(css,rect,node.tagName==='IMG'&&node.getAttribute('src')?node.currentSrc||node.src:'',alpha);
      if(introIndex>=0){part.introIndex=introIndex;part.introScale=introScale;}
    }
    const pseudo=which=>{
      const style=getComputedStyle(node,which);
      if(style.content==='none'||style.content==='normal'||style.display==='none')return;
      const paint=monsterPaintStyle(style),bw=['Left','Right'].reduce((n,k)=>n+(parseFloat(style[`border${k}Width`])||0),0),bh=['Top','Bottom'].reduce((n,k)=>n+(parseFloat(style[`border${k}Width`])||0),0);
      const pw=monsterLength(style.width,rect.w)+bw,ph=monsterLength(style.height,rect.h)+bh;
      const x=style.left!=='auto'?monsterLength(style.left,rect.w):style.right!=='auto'?rect.w-monsterLength(style.right,rect.w)-pw:0;
      const y=style.top!=='auto'?monsterLength(style.top,rect.h):style.bottom!=='auto'?rect.h-monsterLength(style.bottom,rect.h)-ph:0;
      const m=monsterValue('transform',style.transform,{width:pw,height:ph});
      const p={x:rect.x+x+m[4],y:rect.y+y+m[5],w:pw,h:ph};
      boxPart(paint,p,'',alpha*Number(style.opacity),Math.atan2(m[1],m[0]));
      if(style.content!=='""'&&style.content!=="''")textPart(paint,style.content.replace(/^["']|["']$/g,''),p,alpha);
    };
    pseudo('::before');
    const children=[...node.childNodes];
    for(const child of children)if(child.nodeType===3&&child.textContent.trim()){
      const range=document.createRange();range.selectNodeContents(child);textPart(css,child.textContent,local(range.getBoundingClientRect()),alpha);
    }
    [...node.children].sort((a,b)=>(parseInt(getComputedStyle(a).zIndex)||0)-(parseInt(getComputedStyle(b).zIndex)||0)).forEach(child=>visit(child,alpha,css.filter));
    pseudo('::after');
  };
  visit(root);
  try { await Promise.all(jobs); } catch(error) {
    for(const part of parts)releaseMonsterText(part.textEntry,scene);
    throw error;
  }
  return {width,height,parts:parts.filter(part=>part.decoration||part.textEntry)};
}
async function acquireMonsterPanel(scene,node,signature) {
  let entry=monsterPanels.get(signature);
  if(!entry){entry={users:0,signature};entry.ready=monsterPanelParts(scene,node).then(recipe=>entry.recipe=recipe);monsterPanels.set(signature,entry);}
  entry.users++;
  try{await entry.ready;return entry;}catch(error){entry.users--;monsterPanels.delete(signature);throw error;}
}
function releaseMonsterPanel(entry,scene) {
  if(!entry)return;entry.users--;
  for(const [key,cached] of monsterPanels){
    if(monsterPanels.size<=128)break;
    if(cached.users||!cached.recipe)continue;
    for(const part of cached.recipe.parts)releaseMonsterText(part.textEntry,scene);
    monsterPanels.delete(key);
  }
}
function createMonsterPanel(scene,recipe,root) {
  const roleIcons=[...root.querySelectorAll('.role-img')];
  const group=scene.add.container(0,0).setSize(recipe.width,recipe.height).setVisible(false);
  group.setDisplaySize=function(w,h){return this.setScale(w/recipe.width,h/recipe.height);};
  for(const part of recipe.parts){
    const texture=part.decoration||part.textEntry;
    const w=part.decoration?texture.w:part.w+texture.padding*2,h=part.decoration?texture.h:part.h+texture.padding*2;
    const image=scene.add.image(part.x+part.w/2-recipe.width/2,part.y+part.h/2-recipe.height/2,texture.texture)
      .setDisplaySize(w,h).setAlpha(part.alpha).setRotation(part.angle);
    if(part.introIndex!==undefined){
      const node=roleIcons[part.introIndex],binding={width:node.offsetWidth,height:node.offsetHeight,
        values:{transform:[part.introScale[0],0,0,part.introScale[1],0,0]},tweens:new Map(),animations:[]};
      binding.animations=node.getAnimations().map(animation=>monsterAnimation(animation,binding));
      const scaleX=image.scaleX,scaleY=image.scaleY;
      image.updateMonsterIntro=now=>{
        const value=monsterAnimatedValues(binding,now).transform;
        image.setScale(scaleX*Math.abs(value[0])/part.introScale[0],scaleY*Math.abs(value[3])/part.introScale[1]);
      };
    }
    group.add(image);
  }
  return group;
}
const monsterWebGLRequested = () => !globalThis.__combatSimulation
  && new URLSearchParams(location.search).get('monsters') === 'webgl';

async function monsterAsset(scene, source, filter = 'none', body = false) {
  const resourceSource = persistentMediaMarkup(source), key = `${resourceSource}|${filter}|${body}`;
  let entry = monsterImages.get(key);
  if (!entry) {
    const epoch = monsterCacheEpoch;
    entry = (async () => {
      if(new URL(resourceSource,document.baseURI).pathname.endsWith('/effects/ambidextry.gif')
        && new URLSearchParams(location.search).get('ambidextry')!=='gif'){
        const packed=await loadEffectAtlas(resourceSource);
        if(epoch!==monsterCacheEpoch)throw new DOMException('Scene disposed','AbortError');
        const name=`monster-asset-${++monsterTextureId}`;
        scene.textures.addAtlasJSONHash(name,packed.image,packed.data);
        return {name,packed:true,frameNames:packed.names,count:packed.names.length,nativeDurations:packed.durations,total:packed.total,
          width:packed.width,height:packed.height,contentWidth:packed.width,contentHeight:packed.height,padding:0};
      }
      const resource = await loadResource(resourceSource);
      const width = Math.min(body ? 256 : 512, resource.image.naturalWidth), height = Math.round(width * resource.image.naturalHeight / resource.image.naturalWidth);
      const frames = resource.decodedFrames || await resource.sharedFrames;
      let atlas;
      if (frames) {
        const columns = Math.max(1, Math.floor(2048 / width)), canvas = document.createElement('canvas');
        canvas.width = columns * width; canvas.height = Math.ceil(frames.images.length / columns) * height;
        const ctx = canvas.getContext('2d');
        frames.images.forEach((frame, i) => ctx.drawImage(frame, i % columns * width, Math.floor(i / columns) * height, width, height));
        atlas = { canvas, width, height, columns, count: frames.images.length, nativeDurations: frames.durations };
      } else atlas = await loadSpriteAtlas(resourceSource, width, height);
      const padding = filter === 'none' ? 0 : 48;
      if (padding) {
        const w = width + padding * 2, h = height + padding * 2, canvas = document.createElement('canvas');
        const columns = Math.max(1, Math.floor(2048 / w)); canvas.width = columns * w; canvas.height = Math.ceil(atlas.count / columns) * h;
        const ctx = canvas.getContext('2d'); ctx.filter = filter;
        // Crop first: filtering a source atlas can rasterize every frame for
        // each drawImage, blocking the main thread for seconds after F5.
        const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
        const frameContext = frame.getContext('2d');
        for (let i = 0; i < atlas.count; i++) {
          frameContext.clearRect(0, 0, width, height);
          frameContext.drawImage(atlas.canvas, i % atlas.columns * width, Math.floor(i / atlas.columns) * height, width, height, 0, 0, width, height);
          ctx.drawImage(frame, i % columns * w + padding, Math.floor(i / columns) * h + padding);
        }
        atlas = { ...atlas, canvas, width: w, height: h, columns };
      }
      if (epoch !== monsterCacheEpoch) throw new DOMException('Scene disposed', 'AbortError');
      const name = `monster-asset-${++monsterTextureId}`;
      const texture = scene.textures.addImage(name, atlas.canvas);
      for (let frame = 0; frame < atlas.count; frame++) texture.add(frame, 0,
        frame % atlas.columns * atlas.width, Math.floor(frame / atlas.columns) * atlas.height, atlas.width, atlas.height);
      return { ...atlas, name, padding, contentWidth: width, contentHeight: height, total: atlas.nativeDurations.reduce((sum, delay) => sum + delay, 0) };
    })();
    monsterImages.set(key, entry);
    entry.catch(() => monsterImages.delete(key));
  }
  return entry;
}
function disposeMonsterLayer(layer, scene) {
  layer.cancelled = true; layer.image?.destroy(); layer.overlay?.destroy(); layer.tint?.destroy(); layer.brightness?.destroy();
  releaseMonsterPanel(layer.panelEntry, scene); releaseMonsterText(layer.textEntry, scene);
  if (layer.node instanceof HTMLCanvasElement) {
    delete layer.node._phaserMonsterTint;
    if (layer.node.isConnected) renderEntityTint(layer.node);
  }
}

// Native transient presentation. CSS is sampled once per theme, then hits carry
// only data. Lifetimes use the combat clock; GIF frames retain their own epoch.
const combatPopupThemes=new Map(), combatGifThemes=new Map();
function popupThemeKey(content) {
  if('text' in content)return '#text';
  return [content.tag,content.classes,content.style,content.src,(content.children||[]).map(popupThemeKey)].join('|');
}
function buildPopupTemplate(content) {
  if('text' in content)return document.createTextNode(content.text);
  const node=document.createElement(content.tag||'span');node.className=content.classes||'';
  if(content.style)node.setAttribute('style',content.style);
  if(content.src)node.setAttribute('src',content.src);
  for(const child of content.children||[])node.append(buildPopupTemplate(child));
  return node;
}
const popupStrings=content=>'text' in content?[content.text]:(content.children||[]).flatMap(popupStrings);
async function combatPopupTheme(scene,host,data,history=false) {
  const key=`${data.channel}|${data.priority||0}|${history}|${popupThemeKey(data.content)}`;
  if(!combatPopupThemes.has(key))combatPopupThemes.set(key,(async()=>{
    const card=document.createElement('div');card.dataset.phaserTheme='';
    card.className=`combat-popup-card ${data.channel==='damage'?'combat-popup-flight':history?'combat-popup-history-row':'combat-popup-front'}`;
    card.dataset.priority=String(data.priority||0);card.style.visibility='hidden';
    const body=document.createElement('div');body.className='combat-popup-life';body.append(buildPopupTemplate(data.content));card.append(body);host.append(card);
    const parts=[],jobs=[];let textIndex=0;
    const visit=node=>{
      if(node.nodeType===3){
        if(node.textContent.trim())parts.push({textIndex,css:monsterPaintStyle(getComputedStyle(node.parentElement))});
        textIndex++;return;
      }
      const css=monsterPaintStyle(getComputedStyle(node));
      if(css.display==='none')return;
      const source=node.tagName==='IMG'?node.getAttribute('src'):'';
      if(source||css.backgroundImage!=='none'){
        const part={width:node.offsetWidth,height:node.offsetHeight};parts.push(part);
        jobs.push(monsterDecoration(scene,css,part.width,part.height,source).then(texture=>part.decoration=texture));
      }
      for(const child of node.childNodes)visit(child);
    };
    try {visit(body);}finally{card.remove();}
    await Promise.all(jobs);return {parts};
  })());
  return combatPopupThemes.get(key);
}
const statusFrontFrames=[
  {transform:'translateY(3px) scale(.9)',opacity:0,offset:0,easing:'cubic-bezier(.16,1,.3,1)'},
  {transform:'translateY(0px) scale(1.06)',opacity:1,offset:.05,easing:'ease-out'},
  {transform:'translateY(-2px) scale(1)',opacity:1,offset:.13,easing:'ease-out'},
  {transform:'translateY(-5px) scale(1)',opacity:1,offset:.21},
  {transform:'translateY(-13.44px) scale(1)',opacity:1,offset:.38},
  {transform:'translateY(-30.24px) scale(1)',opacity:1,offset:.72},
  {transform:'translateY(-42px) scale(.96)',opacity:0,offset:1}
];
const statusHistoryFrames=[
  {transform:'translateY(3px) scale(.86)',opacity:0,offset:0,easing:'cubic-bezier(.16,1,.3,1)'},
  {transform:'translateY(0px) scale(1.14)',opacity:1,offset:.06,easing:'ease-out'},
  {transform:'translateY(-1px) scale(.94)',opacity:1,offset:.2},
  {transform:'translateY(-4px) scale(.6)',opacity:1,offset:.55},
  {transform:'translateY(-6px) scale(.35)',opacity:.65,offset:.8},
  {transform:'translateY(-8px) scale(.16)',opacity:0,offset:1}
];
function popupAnimation(record) {
  const frames=record.channel==='damage'?fountainFrames(record.lane,record.priority):record.history?statusHistoryFrames:statusFrontFrames;
  const animation=monsterAnimation({effect:{getTiming:()=>({duration:record.duration,iterations:1,fill:'forwards',easing:'linear'}),getKeyframes:()=>frames},
    currentTime:0,addEventListener(){}},{width:1,height:1});animation.start=record.start;
  return {values:{transform:[1,0,0,1,0,0],opacity:[1]},tweens:new Map(),animations:[animation]};
}
function createCombatPresentation(scene,box,entity,anchors,setPose) {
  const records=[],pool=[];
  let sequence=0,damageCursor=0,laneCursor=0,disposed=false;
  const takeImage=texture=>{
    const image=pool.pop()||scene.add.image(0,0,texture);
    return image.setTexture(texture).setOrigin(.5).setVisible(false).setAlpha(1).setRotation(0).setScale(1).setTint(0xffffff).setFlip(false,false).setBlendMode(0);
  };
  const release=record=>{
    record.cancelled=true;
    for(const part of record.parts||[]){releaseMonsterText(part.textEntry,scene);part.image.setVisible(false);if(pool.length<32)pool.push(part.image);else part.image.destroy();}
    if(record.extra){record.extra.setVisible(false);if(pool.length<32)pool.push(record.extra);else record.extra.destroy();}
    if(record.image){record.image.preFX?.clear();record.image.setVisible(false);if(pool.length<32)pool.push(record.image);else record.image.destroy();}
    const i=records.indexOf(record);if(i>=0)records.splice(i,1);
  };
  const preparePopup=async record=>{
    const theme=await combatPopupTheme(scene,anchors[record.channel].node,record,record.history);
    if(disposed||record.cancelled)return;
    const strings=popupStrings(record.content);record.parts=[];let width=0,height=0;
    for(const definition of theme.parts){
      const part={};
      if(definition.textIndex!==undefined){
        part.image=takeImage('monster-bar-base');updateMonsterText(part,scene,definition.css,strings[definition.textIndex]||'');
        const text=part.textEntry;Object.assign(part,{width:text.width,height:text.height,padding:text.padding});
      }else{
        const d=definition.decoration;if(!d)continue;
        part.image=takeImage(d.texture);Object.assign(part,{width:definition.width,height:definition.height,padding:d.padding});
      }
      part.left=width;width+=part.width+3;height=Math.max(height,part.height);record.parts.push(part);
    }
    record.width=Math.max(0,width-3);record.height=height;
  };
  const prepareGif=async record=>{
    const host=anchors[record.anchor||'effects'].node,key=`${record.parentClass||''}|${record.className}|${record.src}|${box.dataset.spriteWidth}|${box.dataset.spriteHeight}|${JSON.stringify(record.style||{})}`;
    record.asset=await monsterAsset(scene,record.src);
    if(disposed||record.cancelled)return;
    let theme=combatGifThemes.get(key);
    if(!theme){
      // A dimension-only probe preserves CSS auto sizing without decoding a GIF
      // for each effect. Its image has the original aspect ratio.
      const node=document.createElement('img');node.className=record.className;node.dataset.phaserTheme='';
      node.src=`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${record.asset.contentWidth}" height="${record.asset.contentHeight}"/>`)}`;
      await node.decode();if(disposed||record.cancelled)return;
      Object.assign(node.style,record.style||{});
      let root=node;
      if(record.parentClass){root=document.createElement('div');root.className=record.parentClass;root.dataset.phaserTheme='';root.append(node);}
      root.style.animation='none';node.style.animation='none';host.append(root);
      const css=getComputedStyle(node),rect=node.getBoundingClientRect(),hr=host.getBoundingClientRect();
      const sx=hr.width/(host.offsetWidth||1)||anchors[record.anchor||'effects'].scale.x,sy=hr.height/(host.offsetHeight||1)||anchors[record.anchor||'effects'].scale.y;
      theme={w:parseFloat(css.width)||1,h:parseFloat(css.height)||1,x:(rect.left-hr.left)/sx,y:(rect.top-hr.top)/sy,
        filter:css.filter,opacity:Number(css.opacity)};
      root.remove();combatGifThemes.set(key,theme);
    }
    record.theme=theme;
    if(theme.filter&&theme.filter!=='none')record.asset=await monsterAsset(scene,record.src,theme.filter);
    if(disposed||record.cancelled)return;
    record.image=takeImage(record.asset.name);
    if(record.asset.packed){record.image.preFX.addGlow(0xebedff,.3,0);record.image.preFX.setPadding(12);}
  };
  const add=saved=>{
    const record={...saved,id:++sequence};records.push(record);
    if(record.kind==='popup'){record.animation=popupAnimation(record);void preparePopup(record).catch(error=>{release(record);console.warn('[CanvasPopup]',error);});}
    else void prepareGif(record).catch(error=>{release(record);console.warn('[CanvasEffect]',error);});
    return record;
  };
  const command=(kind,data)=>{
    if(disposed)return false;
    const now=clockNow();
    if(kind==='clear'){for(const r of [...records])release(r);damageCursor=laneCursor=0;return true;}
    if(kind==='clearPopups'){for(const record of [...records])if(record.kind==='popup')release(record);damageCursor=laneCursor=0;return true;}
    if(kind==='endRecovery'){for(const r of records)if(r.key==='recovery'){r.motion=null;r.duration=Math.min(r.duration,now-r.start+300);}return true;}
    if(kind==='removeGif'){for(const record of [...records])if(record.key===data.key)release(record);return true;}
    if(kind==='gif'){
      if(data.keepExisting&&records.some(record=>record.key===data.key))return true;
      if(data.key)for(const record of [...records])if(record.key===data.key)release(record);
      add({...data,kind,start:data.start??now,duration:data.lifetime??800,gifEpoch:performance.now()});return true;
    }
    if(kind!=='popup')return false;
    if(data.channel==='damage'){
      const alive=records.filter(r=>r.channel==='damage');if(!alive.length)damageCursor=0;
      if(alive.length>=POPUP_LIMITS.damage)release(alive[0]);
      add({...data,kind,start:now,lane:['center','left','right'][damageCursor++%3],duration:data.priority===3?1750:data.priority===1?1550:1350});
    }else{
      const history=records.filter(r=>r.history);if(history.length>=POPUP_LIMITS.history)release(history.shift());
      for(let i=history.length-1,rank=1;i>=0;i--,rank++){
        const r=history[i];r.previousDepth=r.depth||0;r.depth=Math.max(r.depth||0,rank);r.depthAt=now;
      }
      add({...data,kind,start:now,duration:1700,history:true,depth:0});
      const central=records.find(r=>r.channel==='status'&&!r.history&&!r.outgoing&&r.lane==='center');
      const lane=!central||now-central.start>=240?'center':['left','right'][laneCursor++%2];if(lane==='center')laneCursor=0;
      for(const r of [...records])if(r.channel==='status'&&!r.history&&r.lane===lane){if(r.outgoing)release(r);else r.outgoing=now;}
      add({...data,kind,start:now,duration:1350,lane});
    }
    return true;
  };
  const update=(now,resolve,hidden)=>{
    for(const record of [...records]){
      if(now>=record.start+record.duration||record.outgoing&&now>=record.outgoing+280){release(record);continue;}
      if(record.motion==='preparation'&&now>=(record.nextMotionAt||0)){
        const progress=monsterClamp(Number(entity.preparationProgressRatio)||0);record.nextMotionAt=now+1000/30;
        if(progress>=.85&&record.finalStart===undefined)record.finalStart=now;
        if(progress>=1){setPose({transform:entity._preparationVisual?.previousTransform||''});record.completeAt??=now;
          if(now>=record.completeAt+2000){entity.stopPreparationAnimation?.();continue;}}
        else {
          const phase=record.phase||0,backward=record.backward??-6,direction=record.direction??1;
          const x=direction*Math.sin(progress*Math.PI)*(.3+progress*1.5)+backward*progress**1.8;
          if(progress>(phase+1)/5){record.phase=phase+1;record.backward=backward*1.4;}
          record.direction=-direction;setPose({transform:`translateX(${x}px)`});
        }
      }else if(record.motion==='recovery'&&now>=(record.nextMotionAt||0)){
        const elapsed=now-record.start;record.nextMotionAt=now+1000/30;
        if(elapsed>=record.motionDuration){entity.stopRecoveryAnimation?.();}
        else setPose({transform:`translate(${(Math.sin(elapsed*.002*Math.PI)*1.5).toFixed(2)}px, ${(Math.sin(elapsed*.002*Math.PI*2)*3).toFixed(2)}px)`,scale:(.8+(Math.cos(elapsed*.002*Math.PI*2)+1)*.1).toFixed(3)});
      }
      const anchor=resolve(record.kind==='gif'?record.anchor||'effects':record.channel),sx=anchor.sx,sy=anchor.sy;
      if(record.kind==='gif'){
        if(!record.image)continue;
        const {image,asset:a,theme:t}=record;
        let time=(performance.now()-record.gifEpoch)%a.total,index=0;
        while(index<a.count-1&&time>=a.nativeDurations[index])time-=a.nativeDurations[index++];
        let fade=record.fade?Math.min(monsterClamp((now-record.start)/record.fade),monsterClamp((record.start+record.duration-now)/record.fade)):1;
        let scale=1,brightness=1;
        if(record.parentClass?.includes('boulassefeu')&&now-record.start<500){const t=(now-record.start)/500;scale=t<.5?t*2*1.2:1.2-(t-.5)*.4;}
        if(record.finalStart!==undefined){const elapsed=now-record.finalStart;
          if(elapsed<1000){scale=1+elapsed/1000*.2;brightness=1+elapsed/1000;}
          else if(elapsed<1350){const p=monsterEase(monsterClamp((elapsed-1000)/300),'ease-in-out');scale=1+.5*p;fade*=1-p;}
        }
        image.setFrame(a.frameNames?.[index]??index).setPosition(anchor.x+(t.x+t.w/2)*sx,anchor.y+(t.y+t.h/2)*sy)
          .setDisplaySize(t.w*a.width/a.contentWidth*sx*scale,t.h*a.height/a.contentHeight*sy*scale)
          .setAlpha(fade*t.opacity*anchor.alpha).setDepth(-97).setVisible(!hidden&&anchor.visible);
        if(brightness>1&&!record.extra)record.extra=takeImage(a.name).setBlendMode('ADD');
        if(record.extra)record.extra.setFrame(a.frameNames?.[index]??index).setPosition(image.x,image.y).setDisplaySize(image.displayWidth,image.displayHeight)
          .setAlpha(image.alpha*Math.min(1,brightness-1)).setDepth(-96.999).setVisible(image.visible&&brightness>1);
        continue;
      }
      const value=monsterAnimatedValues(record.animation,now),m=value.transform;let scale=m[0],x=m[4],y=m[5],alpha=value.opacity[0];
      if(record.history){
        const t=monsterEase(monsterClamp((now-(record.depthAt||now))/300),'cubic-bezier(.22,.61,.36,1)'),d=(record.previousDepth??record.depth)+(record.depth-(record.previousDepth??record.depth))*t;
        const step=[0,16,28,37,44,49],lo=Math.floor(d),hi=Math.min(5,Math.ceil(d));
        y-=24+step[lo]+(step[hi]-step[lo])*(d-lo);scale*=Math.max(.2,.78**d);alpha*=Math.max(.24,.96-d*.09);
      }else if(record.lane==='left'){if(record.channel==='status'){x-=18;y-=23;}}
      else if(record.lane==='right'&&record.channel==='status'){x+=18;y-=46;}
      if(record.outgoing){const t=monsterEase(monsterClamp((now-record.outgoing)/280),'ease-out');alpha*=1-t;y-=14*t;scale*=1-.04*t;}
      for(const part of record.parts||[]){
        const cx=part.left+part.width/2-(record.channel==='damage'?record.width/2:0),cy=-record.height/2;
        part.image.setPosition(anchor.x+(x+cx*scale)*sx,anchor.y+(y+cy*scale)*sy)
          .setDisplaySize((part.width+part.padding*2)*scale*sx,(part.height+part.padding*2)*scale*sy)
          .setAlpha(alpha*anchor.alpha).setDepth(-90+(record.history?0:record.outgoing?1:record.channel==='damage'?4:3)+record.id*.000001).setVisible(!hidden&&anchor.visible);
      }
    }
  };
  const capture=()=>({damageCursor,laneCursor,records:records.map(({parts,image,extra,asset,theme,animation,cancelled,id,...data})=>({...data,gifElapsed:data.gifEpoch?performance.now()-data.gifEpoch:undefined,gifEpoch:undefined}))});
  const restore=state=>{for(const r of [...records])release(r);damageCursor=state?.damageCursor||0;laneCursor=state?.laneCursor||0;
    for(const r of state?.records||[])add({...r,gifEpoch:performance.now()-(r.gifElapsed||0)});};
  const destroy=()=>{disposed=true;for(const r of [...records])release(r);for(const image of pool)image.destroy();pool.length=0;};
  return {command,update,capture,restore,destroy};
}

// Project the sprite quad inside Phaser's existing texture batch. Camera
// perspective must also move its corners, not just stretch an axis-aligned box.
function setMonsterQuadProjection(image, project) {
  if (!image) return;
  if (image.list) { for (const child of image.list) setMonsterQuadProjection(child, project); return; }
  image._combatQuadProjection = image.preFX?.list?.length ? null : project;
  const pipeline = image.pipeline;
  if (!project || !pipeline?.batchQuad || pipeline._combatQuadProjection) return;
  const batch = pipeline.batchQuad;
  pipeline._combatQuadProjection = true;
  pipeline.batchQuad = function(object,x0,y0,x1,y1,x2,y2,x3,y3,u0,v0,u1,v1,t0,t1,t2,t3,effect,texture,unit) {
    const map = object?._combatQuadProjection;
    if (!map) return batch.apply(this, arguments);
    // Four sub-quads keep perspective interpolation close to the CSS plane,
    // while sharing the same GPU batch and texture as the original sprite.
    for(let row=0;row<2;row++) for(let col=0;col<2;col++) {
      const left=col/2,right=(col+1)/2,top=row/2,bottom=(row+1)/2;
      const point=(u,v)=>map(x0+(x3-x0)*u+(x1-x0)*v,y0+(y3-y0)*u+(y1-y0)*v);
      const a=point(left,top),b=point(left,bottom),c=point(right,bottom),d=point(right,top);
      batch.call(this,object,a.x,a.y,b.x,b.y,c.x,c.y,d.x,d.y,u0+(u1-u0)*left,v0+(v1-v0)*top,
        u0+(u1-u0)*right,v0+(v1-v0)*bottom,t0,t1,t2,t3,effect,texture,unit);
    }
    return false;
  };
}

function releaseMonsterScene(scene) {
  if(--activeMonsterViews===0){monsterCacheEpoch++;for(const key of Object.keys(scene.textures.list))if(key.startsWith('monster-'))scene.textures.remove(key);monsterPanels.clear();monsterImages.clear();monsterResources.clear();monsterTextTextures.clear();monsterDecorations.clear();combatPopupThemes.clear();combatGifThemes.clear();monsterClassStyles.clear();monsterClassAnimations.clear();}
}
function mountWebGLMonster(entity, box) {
  if (!monsterWebGLRequested() || !box.isConnected || !box.closest('#hexGrid') || monsterViews.has(box)) return;
  mountCanvasBoard();monsterViews.add(box);
  void attachPhaserMonster(box, async scene => {
    activeMonsterViews++;
    const layers=new Map(), bindings=new Map(), presentationAnchors={}, projections=new Map();
    let presentation,healthBinding,armorPulseStart=null;
    const grid=box.closest('#hexGrid');
    let cells=new Map(), originCell, originPosition, boardScale={x:1,y:1}, destroyed=false, suspended=false, queued=false, geometryQueued=false;
    const cssCopy=css=>Object.fromEntries(['opacity','display','transform','scale','left','top','right','fontStyle','fontWeight','fontSize','fontFamily','textShadow','textAlign','color','backgroundColor','backgroundImage','transitionProperty','transitionDuration','transitionTimingFunction','transformOrigin','filter','animationName','animationDuration','animationDelay'].map(key=>[key,css[key]]));
    const layoutOffset=()=>{const cell=cells.get(String(entity.position))||originCell,move=getMonsterPlacementOffset(entity);
      return {x:cell.x-originCell.x+move.x*boardScale.x,y:cell.y-originCell.y+move.y*boardScale.y};};
    const projectionFor = node => {
      const anchor = node.closest('.hud-ingame,.drag-box');
      if (!anchor) return null;
      if (!projections.has(anchor)) projections.set(anchor, compileBoardProjection(anchor, grid,
        () => ({position:entity.position, offset:getMonsterPlacementOffset(entity)})));
      return projections.get(anchor);
    };
    const bind = node => {
      if(bindings.has(node))return bindings.get(node);
      const css=cssCopy(getComputedStyle(node)), rect=node.getBoundingClientRect();
      const width=node.offsetWidth||rect.width/boardScale.x||1, height=node.offsetHeight||rect.height/boardScale.y||1;
      const origin=css.transformOrigin.split(' ').map(parseFloat), values={},offset=layoutOffset();
      for(const key of ['transform','scale','opacity','left','top','right','filter'])values[key]=monsterValue(key,css[key],{width,height});
      const b={node,css,rect:{x:rect.left-offset.x,y:rect.top-offset.y,w:rect.width,h:rect.height},width,height,
        cameraControlled:node.matches('.hud-ingame,.drag-box'),
        origin:{x:rect.left-offset.x+(origin[0]||0)*boardScale.x,y:rect.top-offset.y+(origin[1]||0)*boardScale.y},
        values,base:{...values},tweens:new Map(),animations:[]};
      b.animations=readCombatAnimations(node,css).map(animation=>monsterAnimation(animation,b));
      bindings.set(node,b);
      node._monsterStyleChanged=(changes,now)=>{
        try {
        const direct=node.matches('canvas,.sprite,.health-bar,.armor-bar,.health-fill,.armor-fill,.atb-fill,.attack-bar-fill,.timer-activeattack')
          &&Object.keys(changes).every(key=>['transform','scale','opacity','left','top','right','display','filter','width','animationDuration'].includes(key));
        b.commanded=!direct;if(direct)Object.assign(b.overrides||={},changes);
        for(const [key,value] of Object.entries(changes)) {
          if(['transform','scale','opacity','left','top','right','filter'].includes(key)) {
            const to=monsterValue(key,value,b), from=monsterAnimatedValues(b,now)[key];
            const props=b.css.transitionProperty.split(',').map(s=>s.trim()), index=Math.max(0,props.indexOf(key));
            const duration=parseFloat(b.css.transitionDuration.split(',')[index]||b.css.transitionDuration)*1000;
            b.values[key]=to;
            if(key==='filter'){
              const changed=monsterColorFilter(b.css.filter)!==monsterColorFilter(value);b.css.filter=value;
              if(changed){for(const layer of layers.values())if(layer.asset&&layer.chain.includes(b))layer.dirty=true;schedule();}
            }
            if(duration>0 && (props.includes(key)||props.includes('all')))b.tweens.set(key,{from,to,start:now,duration,easing:b.css.transitionTimingFunction});
          } else if(key==='display'){if(b.css.display==='none'&&value!=='none')invalidateGeometry(false,node);b.css.display=value;}
          else if(key==='width')b.fill=monsterClamp(parseFloat(value)/100);
          else if(key==='animation') { b.css=cssCopy(getComputedStyle(node));b.animations=readCombatAnimations(node,b.css).map(animation=>monsterAnimation(animation,b)); }
          else if(key==='animationDuration')for(const animation of b.animations)animation.duration=parseFloat(value)*(String(value).endsWith('ms')?1:1000);
        }
        return direct;
      } catch(error){fail(error);}
      };
      node._monsterAnimationStarted=animation=>{try{b.animations.push(monsterAnimation(animation,b));}catch(error){fail(error);}};
      return b;
    };
    const chainFor=node=>{const chain=[];for(let n=node;n&&n!==grid;n=n.parentElement)chain.push(bind(n));return chain;};
    const calibrateBoard=()=>{
      cells=readBoardScreenGeometry(grid);
      originPosition=String(entity.position);originCell=cells.get(originPosition)||{x:0,y:0,w:1,h:1,localW:1,localH:1};
      boardScale={x:originCell.w/originCell.localW,y:originCell.h/originCell.localH};
    };
    calibrateBoard();
    const install=(node,kind)=>{
      if(layers.has(node))return layers.get(node);
      const css=cssCopy(getComputedStyle(node)), rect=node.getBoundingClientRect();
      const layer={node,kind,css,projection:projectionFor(node),rect:{x:rect.left,y:rect.top,w:rect.width,h:rect.height},chain:chainFor(node),dirty:true,startedAt:performance.now(),fallbackText:node.textContent,textScaleX:rect.width/(node.offsetWidth||1),textScaleY:rect.height/(node.offsetHeight||1)};
      if(kind==='text'&&(node.classList.contains('preparation')||node.classList.contains('execution'))){
        const parent=node.parentElement,r=parent.getBoundingClientRect(),css=getComputedStyle(parent);
        const x=r.width/(parent.offsetWidth||1)||boardScale.x,y=r.height/(parent.offsetHeight||1)||boardScale.y;
        layer.rect={x:r.left,y:r.top+r.height/2,w:Math.max(1,r.width),h:(parseFloat(css.fontSize)||12)*1.3*y};
        layer.textScaleX=x;layer.textScaleY=y;
      }
      if(kind==='bar') {
        const parent=node.parentElement, r=parent.getBoundingClientRect();
        layer.rect={x:r.left+parent.clientLeft*boardScale.x,y:r.top+parent.clientTop*boardScale.y,w:parent.clientWidth*boardScale.x,h:parent.clientHeight*boardScale.y};
        layer.bar=node.classList.contains('health-bar')?'hp':node.classList.contains('armor-bar')?'armor':node.classList.contains('atb-fill')?'atb':'attack';
        layer.fill=0;layer.fillTarget=-1;
        const r0=node.getBoundingClientRect(), scaleX=r.width/(parent.offsetWidth||1), scaleY=r.height/(parent.offsetHeight||1);
        layer.rect={x:r.left+parent.clientLeft*scaleX,y:r.top+parent.clientTop*scaleY,w:parent.clientWidth*scaleX,h:parent.clientHeight*scaleY};
        if((layer.bar==='hp'||layer.bar==='armor')&&r0.height)layer.rect.y=r0.top;
        if(layer.bar==='armor')layer.lastArmor=Number(entity.stats.armor?.current)||0;
        layer.barBinding=bind(node);
        if(layer.bar==='hp')healthBinding=layer.barBinding;
        const fill=node.querySelector('.health-fill,.armor-fill');if(fill)layer.chain.unshift(bind(fill));
      }
      layer.maxShift=node.classList.contains('max');
      if(kind==='text')layer.textRole=node.classList.contains('HP-counter')?'hp':node.classList.contains('armor-text')?'armor':node.classList.contains('current-shift')?'shift':node.classList.contains('preparation')?'prep':node.classList.contains('execution')?'exec':node.classList.contains('attackname')?'attackName':'label';
      layer.flipX=layer.chain.reduce((flip,b)=>b.values.transform[0]<0?!flip:flip,false);
      const offset=layoutOffset();layer.rect.x-=offset.x;layer.rect.y-=offset.y;
      layers.set(node,layer);return layer;
    };
    const calibratePresentation=()=>{
      for(const [key,id] of [['damage','PopUp_'],['status','PopDow_'],['effects','effectsContainer_'],['cast','Cast_Animation_']]){
        const node=box.querySelector(`[id="${id}${entity.id}"]`);if(!node)continue;
        const chain=chainFor(node),r=node.getBoundingClientRect(),offset=layoutOffset();
        const probe=document.createElement('span');probe.dataset.phaserTheme='';
        probe.style.cssText='position:absolute;left:0;top:0;width:100px;height:100px;visibility:hidden;pointer-events:none;transform:none;';
        node.append(probe);const measured=probe.getBoundingClientRect();probe.remove();
        const scale={x:measured.width/100||boardScale.x,y:measured.height/100||boardScale.y};
        presentationAnchors[key]={node,chain,projection:projectionFor(node),rect:{x:r.left-offset.x,y:r.top-offset.y,w:0,h:0},scale};
      }
    };
    const refreshList=()=>{
      for(const node of box.querySelectorAll('canvas'))install(node,'body');
      for(const node of box.querySelectorAll(monsterPanelSelector))install(node,'panel');
      for(const node of box.querySelectorAll('img'))if(!node.closest('.hud-ingame,.combat-popup-life'))install(node,'asset');
      for(const node of box.querySelectorAll(monsterBars))install(node,'bar');
      for(const node of box.querySelectorAll(monsterTexts))install(node,'text');
      for(const [node,layer] of layers)if(!box.contains(node)){disposeMonsterLayer(layer,scene);layers.delete(node);}
      const used=new Set([...layers.values(),...Object.values(presentationAnchors)].flatMap(layer=>layer.chain));
      for(const [node,b] of bindings)if(!used.has(b)){
        delete node._monsterStyleChanged;delete node._monsterAnimationStarted;bindings.delete(node);
      }
    };
    const prepare=async layer=>{
      if(layer.busy||layer.cancelled||layer.kind==='text'||layer.kind==='bar'&&layer.bar==='hp')return;
      layer.busy=true;layer.dirty=false;
      try {
        let texture,panel;
        if(layer.kind==='panel'||layer.kind==='bar') {
          if(layer.bar!=='armor'&&(!layer.node.offsetWidth||!layer.node.offsetHeight))return;
          const signature=monsterPanelKey(layer.node,entity);if(signature===layer.signature)return;
          let theme=layer.node,temporary;
          if(layer.bar==='armor'&&!monsterPanels.has(signature)){
            // A zero-width initial armor bar still needs its full native theme.
            temporary=layer.node.cloneNode(true);temporary.dataset.phaserTheme='';
            temporary.removeAttribute('id');temporary.removeAttribute('data-entity-id');temporary.removeAttribute('data-stat');
            temporary.style.cssText=`position:fixed;left:-2000px;top:0;width:256px;height:${layer.node.parentElement.clientHeight||12}px;display:flex;visibility:hidden;flex:none;`;
            document.body.append(temporary);theme=temporary;
          }
          let cached;try{cached=await acquireMonsterPanel(scene,theme,signature);}finally{temporary?.remove();}
          if(destroyed||layer.cancelled){releaseMonsterPanel(cached,scene);return;}
          layer.image?.destroy();releaseMonsterPanel(layer.panelEntry,scene);
          layer.panelEntry=cached;layer.signature=signature;
          layer.image=createMonsterPanel(scene,cached.recipe,layer.node);layer.panel=null;
          return;
        } else {
          const source=layer.kind==='body'?getEntitySpriteSource(entity):getAnimatedImageState(layer.node)?.key||layer.node.currentSrc||layer.node.src;
          if(!source)return;
          layer.source=source;
          const filters=layer.chain.map(b=>b.css.filter).filter(filter=>filter&&filter!=='none');
          // Changing brightness/pose is sampled from commands, never baked into
          // hundreds of nearly identical GIF atlases during the battle.
          const filter=filters.join(' ').replace(/brightness\([^)]+\)/g,'').trim()||'none';
          layer.asset=await monsterAsset(scene,source,filter,layer.kind==='body');texture=layer.asset.name;
        }
        if(destroyed||layer.cancelled)return;
        if(!layer.image)layer.image=scene.add.image(0,0,texture,layer.asset?.frameNames?.[0]??0).setOrigin(.5).setVisible(false);else layer.image.setTexture(texture,layer.asset?.frameNames?.[0]??0);
        // The packed PNG keeps its trimmed frame geometry; its pale halo is
        // composed by Phaser instead of baking the CSS effect into GIF frames.
        if(layer.asset?.packed&&!layer.atlasGlow){
          layer.atlasGlow=layer.image.preFX.addGlow(0xebedff,.3,0);
          layer.image.preFX.setPadding(12);
        }
        layer.panel=panel;
        if(layer.kind==='body') {
          const neutral=await monsterAsset(scene,layer.source,'none',true);if(destroyed||layer.cancelled)return;
          layer.tint ||= scene.add.image(0,0,neutral.name).setOrigin(.5).setVisible(false);layer.tint.setTexture(neutral.name);
          layer.tintHandler=layer.node._phaserMonsterTint=store=>{layer.tone=[...(store?.values()||[])].sort((a,b)=>b.priority-a.priority||b.updatedAt-a.updatedAt)[0];};
          renderEntityTint(layer.node);
        }
      } catch(error){fail(error);} finally{layer.busy=false;if(layer.dirty&&!destroyed)schedule();}
    };
    let structureDirty=false;
    const schedule=(structureChanged=false)=>{
      structureDirty ||= structureChanged;
      if(queued||destroyed)return;queued=true;
      globalThis.requestAnimationFrame(()=>{
        queued=false;if(destroyed)return;
        if(structureDirty){structureDirty=false;refreshList();}
        for(const layer of layers.values())if(layer.dirty)void prepare(layer);
        wakePhaserMonsters();
      });
    };
    const updateBinding=(node,attribute)=>{
      const b=bindings.get(node);if(!b)return;
      if(attribute==='style'){
        const changes={};for(const key of ['transform','scale','opacity','left','top','right','display','filter'])if(node.style[key])changes[key]=node.style[key];
        node._monsterStyleChanged(changes,clockNow());return;
      }
      const previousDisplay=b.css.display, previousFilter=monsterColorFilter(b.css.filter);
      const previousAnimation=[b.css.animationName,b.css.animationDuration,b.css.animationDelay].join('|');
      const classes=[];for(let parent=node;parent&&parent!==grid;parent=parent.parentElement)classes.push(parent.className);
      const key=[...classes,node.style.cssText,entity.class,entity.side,entity.sizeInCells,box.dataset.spriteWidth,box.dataset.spriteHeight,
        entity.preparationTime>0,entity.executionTime>0,entity.recoveryTime>0,entity.currentPhase,entity.orderPhase,
        ...[...layers.values()].filter(l=>l.bar==='attack').map(l=>l.node.className)].join('|');
      let css=monsterClassStyles.get(key);
      if(!css){css=cssCopy(getComputedStyle(node));monsterClassStyles.set(key,css);if(monsterClassStyles.size>1024)monsterClassStyles.delete(monsterClassStyles.keys().next().value);}
      b.css={...css};
      const layer=layers.get(node);if(layer)layer.css=b.css;
      if(previousFilter!==monsterColorFilter(b.css.filter)){
        for(const candidate of layers.values())if(candidate.asset&&candidate.chain.includes(b))candidate.dirty=true;
        schedule();
      }
      if(previousDisplay==='none'&&b.css.display!=='none')invalidateGeometry(false,node);
      for(const key of ['transform','scale','opacity','left','top','right','filter'])b.values[key]=monsterValue(key,b.overrides?.[key]??b.css[key],b);
      if(previousAnimation!==[b.css.animationName,b.css.animationDuration,b.css.animationDelay].join('|')){
        let templates=monsterClassAnimations.get(key);
        if(!templates){
          b.animations=readCombatAnimations(node,b.css).map(animation=>monsterAnimation(animation,b));
          templates=b.animations.map(({start,cancelled,...animation})=>animation);monsterClassAnimations.set(key,templates);
          if(monsterClassAnimations.size>1024)monsterClassAnimations.delete(monsterClassAnimations.keys().next().value);
        }else b.animations=templates.map(animation=>({...animation,start:clockNow(),cancelled:false}));
      }
    };
    const consumeMutations=records=>{
      if(destroyed)return;
      const commanded=new Set([...bindings.values()].filter(b=>b.commanded).map(b=>b.node));
      const changed=new Map();
      for(const record of records) {
        const node=record.target.nodeType===1?record.target:record.target.parentElement;
        if(record.type==='childList' && [...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1&&!n.dataset?.phaserTheme)){schedule(true);continue;}
        if(record.type==='attributes') {
          if(record.attributeName==='style'&&(commanded.has(node)||node===box||node.matches(monsterBars)))continue;
          const b=bindings.get(node), signature=node.getAttribute(record.attributeName);
          if(b && b[record.attributeName+'Signature']===signature)continue;
          if(b)b[record.attributeName+'Signature']=signature;
          changed.set(node,record.attributeName);
        } else if(node) {
          const layer=layers.get(node.closest(monsterTexts));
          if(layer)layer.fallbackText=layer.node.textContent;
          else {const panel=node.closest(monsterPanelSelector);if(panel&&layers.has(panel)){layers.get(panel).dirty=true;schedule();}}
        }
      }
      for(const [node,attribute] of changed){
        updateBinding(node,attribute);
        const layer=layers.get(node);if(layer&&(attribute==='src'||layer.kind==='bar')){layer.dirty=true;schedule();}
        if(attribute==='class')for(const candidate of layers.values())if(candidate.kind==='bar'&&node.contains(candidate.node)){candidate.dirty=true;schedule();}
        if(attribute==='class' && node.matches('.dead-sprite'))invalidateGeometry();
        const panel=node.closest(monsterPanelSelector);
        if(panel&&layers.has(panel)&&!node.closest(monsterBars+','+monsterTexts)){layers.get(panel).dirty=true;schedule();}
      }
      for(const node of commanded)if(bindings.has(node))bindings.get(node).commanded=false;
    };
    const pendingMutations=[];
    const flushMutations=()=>consumeMutations(pendingMutations.splice(0));
    const observer=new MutationObserver(records=>{pendingMutations.push(...records);queueCombatPresentationUpdate(flushMutations);});
    const geometryRoots=new Set();let boardGeometryDirty=false;
    const invalidateGeometry=(refreshBoard=false,changedNode=null)=>{
      if(destroyed)return;boardGeometryDirty ||= refreshBoard;geometryRoots.add(refreshBoard?null:changedNode);
      if(geometryQueued)return;geometryQueued=true;
      // Geometry is only rebuilt for viewport/board sizing, never for a frame.
      queueMicrotask(()=>{
        geometryQueued=false;if(destroyed||!box.isConnected)return;
        if(boardGeometryDirty)calibrateBoard();
        const whole=geometryRoots.has(null),affected=node=>whole||[...geometryRoots].some(root=>root.contains(node));
        for(const [anchor,projection] of projections)if(affected(anchor)){projection.dispose();projections.delete(anchor);}
        const previousBindings=new Map([...bindings].filter(([node])=>affected(node)));
        for(const node of previousBindings.keys()){delete node._monsterStyleChanged;delete node._monsterAnimationStarted;bindings.delete(node);}
        for(const [node,layer] of [...layers]) { if(!affected(node))continue;
          layers.delete(node);const fresh=install(node,layer.kind);
          Object.assign(layer,{rect:fresh.rect,chain:fresh.chain,css:fresh.css,projection:fresh.projection,barBinding:fresh.barBinding,flipX:fresh.flipX,textScaleX:fresh.textScaleX,textScaleY:fresh.textScaleY});layers.set(node,layer);
          if(!layer.image)layer.dirty=true;
        }
        calibratePresentation();
        // Recalibrate coordinates without discarding poses that now live only
        // in Phaser, especially when rotating a phone during tactical pause.
        for(const [node,previous] of previousBindings){
          const current=bindings.get(node);if(!current)continue;
          current.overrides={...previous.overrides};current.tweens=new Map(previous.tweens);
          if(current.css.animationName===previous.css.animationName)current.animations=previous.animations;
          for(const [key,value] of Object.entries(current.overrides)){
            if(key in current.values)current.values[key]=monsterValue(key,value,current);
            else if(key==='width')current.fill=previous.fill;
            else if(key==='display')current.css.display=value;
          }
        }
        geometryRoots.clear();boardGeometryDirty=false;schedule();
      });
    };
    const destroy=()=>{
      if(destroyed)return;destroyed=true;observer.disconnect();box.removeAttribute('data-monster-webgl');delete box._monsterView;
      for(const node of bindings.keys()){delete node._monsterStyleChanged;delete node._monsterAnimationStarted;}bindings.clear();
      presentation?.destroy();for(const projection of projections.values())projection.dispose();projections.clear();for(const layer of layers.values())disposeMonsterLayer(layer,scene);layers.clear();
      releaseMonsterScene(scene);
    };
    const fail=error=>{if(!destroyed){destroy();console.warn('[MonsterWebGL] HTML restored:',error);}};
    const barTexture=(kind)=>{
      const key=`monster-bar-${kind}`;if(scene.textures.exists(key))return key;
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=16;const ctx=canvas.getContext('2d');
      if(kind==='overlay') {
        for(const [x,y,a,b] of [[256,0,.23,.23],[0,16,.2,.3]]){const g=ctx.createLinearGradient(0,0,x,y);g.addColorStop(0,`rgba(255,255,255,${a})`);g.addColorStop(1,`rgba(0,0,0,${b})`);ctx.fillStyle=g;ctx.fillRect(0,0,256,16);}
      } else {ctx.fillStyle='white';ctx.fillRect(0,0,256,16);}
      scene.textures.addImage(key,canvas);return key;
    };
    barTexture('base');barTexture('overlay');
    const settledPoses=new WeakMap(),identityPose={a:1,b:0,c:0,d:1,tx:0,ty:0,sx:1,sy:1,angle:0,alpha:1,brightness:1,visible:true};
    const pose=(rect,chain,frame,projection)=>{
      // Sibling layers share their ancestors. Compose each ancestor once per
      // frame instead of repeating trigonometry for every icon, bar and glyph.
      const cache=frame.poses ||= new Map();
      let parent=identityPose;
      for(let i=chain.length-1;i>=0;i--){
        const binding=chain[i];
        if(cache.has(binding)){parent=cache.get(binding);continue;}
        const value=frame.get(binding),base=binding.base,m=value.transform,b=base.transform;
        const previous=settledPoses.get(binding),ancestor=parent;
        // Reuse an unchanged pose across frames as well. Values use immutable
        // numeric arrays; commands, interpolation and restore replace them.
        if(previous&&previous.parent===parent&&previous.base===base&&previous.display===binding.css.display
          &&previous.transform===m&&previous.scale===value.scale&&previous.opacity===value.opacity
          &&previous.filter===value.filter&&previous.left===value.left&&previous.top===value.top&&previous.right===value.right){
          parent=previous.result;cache.set(binding,parent);continue;
        }
        let sx=1,sy=1,angle=0,dx=0,dy=0;
        if(binding.node!==box && !(projection && binding.cameraControlled)){
          sx=Math.hypot(m[0],m[1])/(Math.hypot(b[0],b[1])||1)*value.scale[0]/base.scale[0];
          sy=Math.hypot(m[2],m[3])/(Math.hypot(b[2],b[3])||1)*value.scale[1]/base.scale[1];
          angle=Math.atan2(m[1],m[0])-Math.atan2(b[1],b[0]);
          dx=(m[4]-b[4]+value.left[0]-base.left[0]-value.right[0]+base.right[0])*boardScale.x;
          dy=(m[5]-b[5]+value.top[0]-base.top[0])*boardScale.y;
        }
        const cos=Math.cos(angle),sin=Math.sin(angle),a=cos*sx,bv=sin*sx,c=-sin*sy,d=cos*sy;
        const ox=binding.origin.x,oy=binding.origin.y,tx=ox-a*ox-c*oy+dx,ty=oy-bv*ox-d*oy+dy;
        parent={a:parent.a*a+parent.c*bv,b:parent.b*a+parent.d*bv,c:parent.a*c+parent.c*d,d:parent.b*c+parent.d*d,
          tx:parent.a*tx+parent.c*ty+parent.tx,ty:parent.b*tx+parent.d*ty+parent.ty,
          sx:parent.sx*sx,sy:parent.sy*sy,angle:parent.angle+angle,alpha:parent.alpha*value.opacity[0],
          brightness:parent.brightness*value.filter[0],visible:parent.visible&&binding.css.display!=='none'};
        settledPoses.set(binding,{...value,parent:ancestor,base,display:binding.css.display,result:parent});
        cache.set(binding,parent);
      }
      const x=rect.x+rect.w/2,y=rect.y+rect.h/2;
      const result={x:parent.a*x+parent.c*y+parent.tx,y:parent.b*x+parent.d*y+parent.ty,
        w:rect.w*parent.sx,h:rect.h*parent.sy,angle:parent.angle,alpha:parent.alpha,brightness:parent.brightness,visible:parent.visible};
      if(projection){
        const map=projection(frame.projections ||= new Map());result.projected=true;
        if(map.identity){result.projectionScaleX=1;result.projectionScaleY=1;return result;}
        const original={...result},center=map(result.x,result.y),cos=Math.cos(result.angle),sin=Math.sin(result.angle);
        const horizontal=map(result.x+cos,result.y+sin),vertical=map(result.x-sin,result.y+cos);
        result.projectionScaleX=Math.hypot(horizontal.x-center.x,horizontal.y-center.y);
        result.projectionScaleY=Math.hypot(vertical.x-center.x,vertical.y-center.y);
        result.x=center.x;result.y=center.y;result.w*=result.projectionScaleX;result.h*=result.projectionScaleY;
        result.angle=Math.atan2(horizontal.y-center.y,horizontal.x-center.x);
        if(map.perspective&&original.w>0&&original.h>0){
          const points=[[-.5,-.5],[-.5,.5],[.5,.5],[.5,-.5]].map(([u,v])=>map(original.x+cos*u*original.w-sin*v*original.h,original.y+sin*u*original.w+cos*v*original.h));
          const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
          result.x=(left+right)/2;result.y=(top+bottom)/2;result.w=right-left;result.h=bottom-top;result.angle=0;
          result.quadProjection=(x,y)=>{
            const u=(x-result.x)*original.w/result.w,v=(y-result.y)*original.h/result.h;
            return map(original.x+cos*u-sin*v,original.y+sin*u+cos*v);
          };
        }
      }
      return result;
    };
    const update=(now,showHTML=false)=>{
      if(destroyed)return;
      if(suspended!==showHTML){suspended=showHTML;box.dataset.monsterWebgl=suspended?'suspended':'ready';for(const layer of layers.values())if(layer.tintHandler){if(suspended)delete layer.node._phaserMonsterTint;else layer.node._phaserMonsterTint=layer.tintHandler;renderEntityTint(layer.node);}}
      if(suspended){presentation?.update(now,()=>({sx:1,sy:1,x:0,y:0,alpha:0,visible:false}),true);for(const layer of layers.values()){layer.image?.setVisible(false);layer.overlay?.setVisible(false);layer.tint?.setVisible(false);layer.brightness?.setVisible(false);}return;}
      const hpRatio=monsterClamp(entity.stats.HP.current/Math.max(1,entity.stats.HP.max));
      if(healthBinding&&healthBinding.vitalRatio!==hpRatio){
        const b=healthBinding;b.vitalRatio=hpRatio;
        // Same blink as the HP theme, driven by state and saved with the other
        // native bindings. Repeated damage changes its speed, not its epoch.
        let blink=b.animations.find(a=>a.vitalBlink||b.css.animationName==='blink'&&a.tracks.opacity);
        if(blink)b.animations=b.animations.filter(a=>a!==blink);
        if(hpRatio<=.3){
          blink ||= {tracks:{opacity:[{at:0,value:[1],easing:'ease-in-out'},{at:.5,value:[.1],easing:'ease-in-out'},{at:1,value:[1]}]},start:now,delay:0,iterations:Infinity,direction:'normal',easing:'linear',fill:'none',rate:1};
          blink.vitalBlink=true;blink.duration=40+Math.pow(hpRatio/.3,1.5)*960;b.animations.push(blink);
        }
        b.values.opacity=[1];(b.overrides||={}).opacity='1';
      }
      const frame=new Map([...bindings.values()].map(binding=>[binding,monsterAnimatedValues(binding,now)]));
      const cell=cells.get(String(entity.position))||originCell, ratio=cell.w/originCell.w, move=getMonsterPlacementOffset(entity);
      presentation?.update(now,key=>{
        const a=presentationAnchors[key],p=pose(a.rect,a.chain,frame,a.projection);
        const scale=a.chain.reduce((v,b)=>{const value=frame.get(b),base=b.base;if(a.projection&&b.cameraControlled)return v;return {x:v.x*Math.hypot(value.transform[0],value.transform[1])/(Math.hypot(base.transform[0],base.transform[1])||1)*value.scale[0]/base.scale[0],y:v.y*Math.hypot(value.transform[2],value.transform[3])/(Math.hypot(base.transform[2],base.transform[3])||1)*value.scale[1]/base.scale[1]};},{...a.scale});
        return {x:p.projected?p.x:cell.x+(p.x-originCell.x)*ratio+move.x*boardScale.x*ratio,y:p.projected?p.y:cell.y+(p.y-originCell.y)*ratio+move.y*boardScale.y*ratio,sx:scale.x*(p.projectionScaleX??ratio),sy:scale.y*(p.projectionScaleY??ratio),alpha:p.alpha,visible:p.visible};
      },false);
      const hp=Math.max(0,Math.min(entity.stats.HP.current,entity.stats.HP.max)),armor=Math.max(0,entity.stats.armor?.current||0),den=Math.max(entity.stats.HP.max,hp+armor)||1;
      if(armor>0)armorPulseStart??=now;else armorPulseStart=null;
      let atb=1;
      if(entity.orderPhase==='orderDecision')atb=entity.recoveryTime/Math.max(1,entity.maxRecoveryTime)*(entity.ATBfillBeforeOrder||100)/100;
      else if(entity.orderPhase==='orderExecution')atb=1-entity.orderExecutionTime/Math.max(1,entity.maxOrderExecutionTime);
      else if(entity.recoveryTime>0)atb=entity.recoveryTime/Math.max(1,entity.maxRecoveryTime||entity.recoveryTime);
      else if(entity.speedTimer>0 && !(entity.preparationTime>0||entity.executionTime>0))atb=1-entity.speedTimer/(Number(entity.stats.speed?.current)||1000);
      const prep=Number(entity.preparationTime)||0,exec=Number(entity.executionTime)||0;
      const attackNameKey=entity.currentAttackId||entity.attacks?.[0];
      if(attackNameKey!==update.attackNameKey||now>=(update.attackNameAt||0)){update.attackNameKey=attackNameKey;update.attackNameAt=now+100;update.attackName=resolveEntityAttackDisplayName(entity,attackNameKey,attackDetails);}
      for(const layer of layers.values()) {
        let rect={...layer.rect},visible=true,color=0xffffff;
        if(layer.kind==='body'&&getEntitySpriteSource(entity)!==layer.source){layer.dirty=true;schedule();}
        if(layer.kind==='text') {
          const value=layer.textRole==='hp'?`HP : ${hp} / ${entity.stats.HP.max}`:layer.textRole==='armor'?`🛡️ ${armor}`:layer.textRole==='shift'?String(Math.round(Number(entity.stats.shift?.[layer.maxShift?'max':'current'])||0)):layer.textRole==='prep'?`${(prep/1000).toFixed(1)}s`:layer.textRole==='exec'?`${(exec/1000).toFixed(1)}s`:layer.textRole==='attackName'?update.attackName:layer.fallbackText;
          updateMonsterText(layer,scene,layer.css,value);
          if(layer.textRole==='prep')visible=prep>0;if(layer.textRole==='exec')visible=prep<=0&&exec>0;
          const entry=layer.textEntry,scaleX=layer.textScaleX,scaleY=layer.textScaleY;
          const align=layer.css.textAlign,offset=align==='center'?(rect.w-entry.width*scaleX)/2:align==='right'?rect.w-entry.width*scaleX:0;
          rect={x:rect.x+offset-entry.padding*scaleX,y:rect.y+(rect.h-entry.height*scaleY)/2-entry.padding*scaleY,w:(entry.width+entry.padding*2)*scaleX,h:(entry.height+entry.padding*2)*scaleY};
        } else if(layer.kind==='bar') {
          let target=layer.bar==='hp'?hp/den:layer.bar==='armor'?armor/den:layer.bar==='atb'?(layer.barBinding.fill??atb):(layer.barBinding.fill??(prep>0?1-prep/Math.max(1,entity.currentAttack?.preparationTime||1):exec>0||entity.recoveryTime>0?1:0));
          target=monsterClamp(target);
          if(target!==layer.fillTarget){if(layer.fillTarget===-1)layer.fill=target;layer.fillFrom=layer.fill;layer.fillTarget=target;layer.fillAt=now;}
          layer.fill=layer.fillFrom+(target-layer.fillFrom)*monsterEase(monsterClamp((now-layer.fillAt)/(layer.bar==='hp'||layer.bar==='armor'?300:100)),'ease-out');
          if(layer.bar==='armor'){rect.x+=rect.w*(hp/den);color=0x4f70b3;visible=armor>0;}
          else if(layer.bar==='hp'){const t=hp/Math.max(1,entity.stats.HP.max);color=entity.side==='B'?(Math.round(255-t*173)<<16):(Math.round(255-t*255)<<16)|(Math.round(t*255)<<8);}
          else if(layer.bar==='atb')color=exec>0?0xff0000:entity.recoveryTime>0?0x0000ff:0xffd700;
          else color=prep>0?0xa300ff:exec>0?0xf74b4b:0x4caf50;
          rect.w*=layer.fill;visible&&=rect.w>0;
          if(!layer.image&&layer.bar==='hp'){layer.image=scene.add.image(0,0,barTexture('base')).setOrigin(.5);layer.overlay=scene.add.image(0,0,barTexture('overlay')).setOrigin(.5);}
          if(layer.bar==='hp')layer.image.setTint(color);
        }
        if(!layer.image)continue;
        const p=pose(rect,layer.chain,frame,layer.projection),image=layer.image;
        if(layer.textRole==='prep'||layer.textRole==='exec'||layer.bar==='armor')p.visible=layer.chain.every(b=>b.node===layer.node||b.css.display!=='none');
        if(layer.bar==='armor'&&layer.flashAt&&!layer.brightness)layer.brightness=scene.add.image(0,0,barTexture('base')).setOrigin(.5);
        if(image.list)for(const part of image.list)part.updateMonsterIntro?.(now);
        const ratio=p.projected?1:cell.w/originCell.w;
        const x=p.projected?p.x:cell.x+(p.x-originCell.x)*ratio+move.x*boardScale.x*ratio,y=p.projected?p.y:cell.y+(p.y-originCell.y)*ratio+move.y*boardScale.y*ratio;
        let w=p.w*ratio,h=p.h*ratio,px=x,py=y;
        if(layer.panel){const a=layer.panel;w*=a.w/a.width;h*=a.h/a.height;px+=(a.w-a.width-2*a.padding)/2/a.width*p.w*ratio;}
        else if(layer.asset){w*=layer.asset.width/layer.asset.contentWidth;h*=layer.asset.height/layer.asset.contentHeight;}
        const depth=-100+(layer.kind==='text'?5:layer.kind==='bar'?4:layer.kind==='body'?1:layer.kind==='asset'?2:3);
        image.setPosition(px,py).setDisplaySize(w,h).setRotation(p.angle).setAlpha(p.alpha).setVisible(visible&&p.visible&&w>0&&h>0).setDepth(depth);
        if(layer.kind==='asset'||layer.kind==='body'){
          image.setFlipX(layer.flipX);
          const shade=Math.round(255*Math.min(1,p.brightness));image.setTint((shade<<16)|(shade<<8)|shade);
          const a=layer.asset,playback=getAnimatedImageState(layer.node);let elapsed=(performance.now()-(playback?.startedAt??layer.startedAt))%a.total,idx=0;
          while(idx<a.count-1&&elapsed>=a.nativeDurations[idx])elapsed-=a.nativeDurations[idx++];image.setFrame(a.frameNames?.[idx]??idx);
          if(p.brightness>1&&!layer.brightness)layer.brightness=scene.add.image(0,0,a.name).setOrigin(.5).setBlendMode('ADD');
          if(layer.brightness)layer.brightness.setTexture(a.name,a.frameNames?.[idx]??idx).setPosition(px,py).setDisplaySize(w,h).setRotation(p.angle)
            .setFlipX(layer.flipX).setAlpha(p.alpha*Math.min(1,p.brightness-1)).setDepth(depth+.0000001).setVisible(image.visible&&p.brightness>1);
        }
        for(const part of [layer.image,layer.overlay,layer.tint,layer.brightness])setMonsterQuadProjection(part,p.quadProjection);
        if(layer.bar==='armor'&&layer.brightness)layer.brightness.setPosition(x,y).setDisplaySize(p.w*ratio,p.h*ratio).setRotation(p.angle).setAlpha(p.alpha*.7*Math.max(0,1-(now-layer.flashAt)/180)).setVisible(image.visible).setDepth(depth+.000001);
        if(layer.overlay)layer.overlay.setPosition(x,y).setDisplaySize(p.w*ratio,p.h*ratio).setRotation(p.angle).setAlpha(p.alpha).setVisible(image.visible).setDepth(depth+.000001);
        if(layer.tint){const tone=armor>0&&(!layer.tone||layer.tone.priority<ENTITY_TINTS.armorActive.priority)?{...ENTITY_TINTS.armorActive,opacity:.08+(Math.sin((now-armorPulseStart)/1800*Math.PI*2)+1)/2*.34}:layer.tone,rgb=tone?.color.split(',').map(Number)||[0,0,0];layer.tint.setPosition(x,y).setDisplaySize(p.w*ratio,p.h*ratio).setRotation(p.angle).setFlipX(layer.flipX).setDepth(depth+.000001).setVisible(image.visible&&Boolean(tone)).setAlpha(p.alpha*(tone?.opacity||0)).setTintFill((rgb[0]<<16)|(rgb[1]<<8)|rgb[2]);}
      }
    };
    calibratePresentation();const spritePoseNode=box.querySelector('.sprite');
    presentation=createCombatPresentation(scene,box,entity,presentationAnchors,values=>spritePoseNode?._monsterStyleChanged?.(values,clockNow()));
    refreshList();await Promise.all([...layers.values()].map(prepare));
    if(!destroyed){
      if(!document.getElementById('monster-webgl-style')){const css=document.createElement('style');css.id='monster-webgl-style';css.textContent='[data-monster-webgl="ready"] :is(canvas,img,.hud-ingame,.combat-popup-life,.target-search-indicator,.runaway-info,.order-exclamation,.melee-motion-trail,.shield-sweep-layer){visibility:hidden!important}[data-monster-webgl="ready"] *{animation-play-state:paused!important}';document.head.append(css);}
      box.dataset.monsterWebgl='ready';box._monsterView={invalidateGeometry};
      observer.observe(box,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','src']});update(clockNow());
    }
    const bounds=node=>{
      const binding=bindings.get(node);if(!binding)return null;
      const chain=[];for(let current=node;current&&current!==grid;current=current.parentElement){const b=bindings.get(current);if(b)chain.push(b);}
      const frame=new Map(chain.map(b=>[b,monsterAnimatedValues(b,clockNow())])),p=pose(binding.rect,chain,frame,projectionFor(node));
      const cell=cells.get(String(entity.position))||originCell,ratio=p.projected?1:cell.w/originCell.w,move=getMonsterPlacementOffset(entity);
      const width=Math.abs(p.w*Math.cos(p.angle))*ratio+Math.abs(p.h*Math.sin(p.angle))*ratio;
      const height=Math.abs(p.h*Math.cos(p.angle))*ratio+Math.abs(p.w*Math.sin(p.angle))*ratio;
      const left=(p.projected?p.x:cell.x+(p.x-originCell.x)*ratio+move.x*boardScale.x*ratio)-width/2,top=(p.projected?p.y:cell.y+(p.y-originCell.y)*ratio+move.y*boardScale.y*ratio)-height/2;
      return {x:left,y:top,left,top,width,height,right:left+width,bottom:top+height};
    };
    const pathFor=node=>{const path=[];for(let n=node;n&&n!==box;n=n.parentElement)path.unshift([...n.parentElement.children].indexOf(n));return path;};
    const capture=()=>({presentation:presentation.capture(),armorPulseStart,armorFlashAt:[...layers.values()].find(l=>l.bar==='armor')?.flashAt,bindings:[...bindings.values()].filter(b=>box.contains(b.node)).map(b=>({path:pathFor(b.node),overrides:b.overrides,values:b.values,base:b.base,animations:b.animations.map(a=>({...a,iterations:a.iterations===Infinity?'Infinity':a.iterations})),tweens:[...b.tweens]}))});
    const restore=state=>{armorPulseStart=state?.armorPulseStart??null;const armor=[...layers.values()].find(l=>l.bar==='armor');if(armor)armor.flashAt=state?.armorFlashAt;presentation.restore(state?.presentation);for(const saved of state?.bindings||[]){
      const node=saved.path.reduce((parent,index)=>parent?.children[index],box),b=bindings.get(node);if(!b)continue;
      b.overrides={...saved.overrides};b.values={...saved.values};b.base={...saved.base};b.animations=saved.animations.map(a=>({...a,iterations:a.iterations==='Infinity'?Infinity:a.iterations}));b.tweens=new Map(saved.tweens);
      if(b.overrides.display!==undefined)b.css.display=b.overrides.display;
      if(b.overrides.width!==undefined)b.fill=monsterClamp(parseFloat(b.overrides.width)/100);
    }};
    return {update,destroy,invalidateGeometry,bounds,command:(kind,data)=>{if(kind==='vitals'){const armor=[...layers.values()].find(l=>l.bar==='armor');if(armor&&Number(data.armor)<(armor.lastArmor??Number(data.armor)))armor.flashAt=clockNow();if(armor)armor.lastArmor=Number(data.armor);return true;}if(kind==='armorPulse'){armorPulseStart??=data.start;return true;}return presentation.command(kind,data);},capture,restore,accepts:()=>!destroyed,active:()=>!destroyed,connected:()=>box.isConnected};
  }).catch(error=>{monsterViews.delete(box);console.warn('[MonsterWebGL]',error);});
}

window.addEventListener('combatPauseRestored', () => {
  if (!monsterWebGLRequested()) return;
  for (const entity of entites) {
    const box = document.getElementById(`Box_Entite_${entity.id}`);
    if (box && !monsterViews.has(box)) { box.removeAttribute('data-monster-webgl'); mountWebGLMonster(entity, box); }
  }
});


// Compile passive board objects once, including their CSS keyframes. The
// returned parts keep textures/poses in memory; animation frames do not query DOM.
const boardAnimationData=new WeakMap();
async function canvasBoardComponent(scene,root) {
  const painted=root.hasAttribute('data-canvas-painted');if(painted)root.removeAttribute('data-canvas-painted');
  const parts=[],jobs=[],bindings=new Map();
  const bind=node=>{
    if(bindings.has(node))return bindings.get(node);
    const css=getComputedStyle(node),r=node.getBoundingClientRect(),width=node.offsetWidth||1,height=node.offsetHeight||1;
    const b={node,width,height,values:{},tweens:new Map(),animations:[],origin:{x:r.left+(parseFloat(css.transformOrigin)||0)*r.width/width,y:r.top+(parseFloat(css.transformOrigin.split(' ')[1])||0)*r.height/height},sx:r.width/width,sy:r.height/height,display:css.display};
    for(const key of ['transform','scale','opacity','left','top','right','filter'])b.values[key]=monsterValue(key,css[key],b);
    b.base={...b.values};b.animations=[...new Set([...node.getAnimations(),...readCombatAnimations(node,css)])].map(a=>{let data=boardAnimationData.get(a);if(!data){data=monsterAnimation(a,b);data.name=a.animationName||null;if(a.transitionProperty)data.fill='forwards';boardAnimationData.set(a,data);}return data;});bindings.set(node,b);return b;
  };
  const chainFor=node=>{const chain=[];for(let n=node;n&&n!==root.parentElement;n=n.parentElement)chain.push(bind(n));return chain;};
  const part=(node,rect,css,source='',text='')=>{
    const entry={node,...rect,alpha:1,chain:chainFor(node)};parts.push(entry);
    if(text){updateMonsterText(entry,scene,css,text);entry.image.destroy();entry.image=null;}
    else jobs.push((async()=>{
      const playback=getAnimatedImageState(node);
      if(node.tagName==='CANVAS'||playback||/\.gif(?:[?#]|$)/i.test(persistentMediaMarkup(source))){
        const key=playback?.key||node.dataset.canvasSource||node.dataset.gifSource||source;if(key){if(node.dataset.canvasDraw){const d=JSON.parse(node.dataset.canvasDraw);Object.assign(entry,{x:d.x,y:d.y,w:d.width,h:d.height});}entry.asset=await monsterAsset(scene,key,css.filter||'none');entry.epoch=playback?.startedAt??performance.now();}
      }else entry.decoration=await monsterDecoration(scene,css,rect.w,rect.h,source);
    })());
    return entry;
  };
  const visit=node=>{
    const computed=getComputedStyle(node),css=monsterPaintStyle(computed);if(css.display==='none')return;
    const w=node.offsetWidth||0,h=node.offsetHeight||0;
    if(w&&h)part(node,{x:0,y:0,w,h},css,node.tagName==='IMG'?node.currentSrc||node.src:'');
    if(node.tagName==='IMG'||node.tagName==='CANVAS')return;
    const bounds=node.getBoundingClientRect();
    for(const child of node.childNodes)if(child.nodeType===3&&child.textContent.trim()){
      const range=document.createRange();range.selectNodeContents(child);const r=range.getBoundingClientRect();
      part(node,{x:(r.left-bounds.left)*w/(bounds.width||1),y:(r.top-bounds.top)*h/(bounds.height||1),w:r.width*w/(bounds.width||1),h:r.height*h/(bounds.height||1)},css,'',child.textContent);
    }
    for(const which of ['::before','::after']){const p=getComputedStyle(node,which);if(p.content==='none'||p.content==='normal'||p.display==='none')continue;
      const pw=monsterLength(p.width,w),ph=monsterLength(p.height,h);if(!pw||!ph)continue;
      const entry=part(node,{x:monsterLength(p.left,w),y:monsterLength(p.top,h),w:pw,h:ph},monsterPaintStyle(p));entry.alpha=Number(p.opacity);
    }
    [...node.children].forEach(visit);
  };
  try{visit(root);}finally{if(painted)root.dataset.canvasPainted='';}
  await Promise.all(jobs);
  let lastTime,frame;
  const motion=(part,now)=>{
    if(lastTime!==now){lastTime=now;frame=new Map([...bindings.values()].map(b=>{
      for(const a of b.animations)if(a.name&&!a.ended&&!a.cancelled&&Number.isFinite(a.iterations)&&now>=a.start+a.delay+a.duration*a.iterations/a.rate){
        a.ended=true;queueMicrotask(()=>{if(b.node.isConnected)b.node.dispatchEvent(new AnimationEvent('animationend',{animationName:a.name,elapsedTime:a.duration*a.iterations/1000,bubbles:true}));});
      }
      return [b,monsterAnimatedValues(b,now)];
    }));}
    let alpha=part.alpha,visible=true;
    const transforms=part.chain.map(b=>{const value=frame.get(b),base=b.base,m=value.transform,t=base.transform;
      alpha*=value.opacity[0];visible&&=b.display!=='none';
      const sx=Math.hypot(m[0],m[1])/(Math.hypot(t[0],t[1])||1)*value.scale[0]/(base.scale[0]||1),sy=Math.hypot(m[2],m[3])/(Math.hypot(t[2],t[3])||1)*value.scale[1]/(base.scale[1]||1),angle=Math.atan2(m[1],m[0])-Math.atan2(t[1],t[0]);
      return {sx,sy,cos:Math.cos(angle),sin:Math.sin(angle),x:b.origin.x,y:b.origin.y,dx:(m[4]-t[4]+value.left[0]-base.left[0])*b.sx,dy:(m[5]-t[5]+value.top[0]-base.top[0])*b.sy};
    });
    return {alpha,visible,point:p=>{let {x,y}=p;for(const t of transforms){const dx=(x-t.x)*t.sx,dy=(y-t.y)*t.sy;x=t.x+dx*t.cos-dy*t.sin+t.dx;y=t.y+dx*t.sin+dy*t.cos+t.dy;}return {x,y,w:p.w};}};
  };
  const pathFor=node=>{const path=[];for(let n=node;n!==root;n=n.parentElement)path.unshift([...n.parentElement.children].indexOf(n));return path;};
  const capture=()=>[...bindings.values()].map(b=>({path:pathFor(b.node),values:b.values,base:b.base,animations:b.animations.map(a=>({...a,iterations:a.iterations===Infinity?'Infinity':a.iterations}))}));
  const restore=saved=>{for(const value of saved||[]){const b=bindings.get(value.path.reduce((n,i)=>n?.children[i],root));if(b){b.values=value.values;b.base=value.base;b.animations=value.animations.map(a=>({...a,iterations:a.iterations==='Infinity'?Infinity:a.iterations}));}}lastTime=undefined;};
  return {parts:parts.filter(p=>p.decoration||p.textEntry||p.asset),motion,capture,restore};
}

// Terrain, cell decorations and foreground share the actors' WebGL context.
const mountedCanvasBoards=new WeakSet();
function mountCanvasBoard(){
  const grid=document.getElementById('hexGrid');
  if(!monsterWebGLRequested()||!grid||mountedCanvasBoards.has(grid))return;
  mountedCanvasBoards.add(grid);
  void attachPhaserBoard(grid,async (scene,cameraSettled)=>{
    activeMonsterViews++;
    try{return await createCanvasBoard(scene,grid,{
      now:clockNow,media:monsterMediaImage,cameraSettled,cameraChanged:positionPhaserLayer,
      component:node=>canvasBoardComponent(scene,node),
      release:recipe=>{for(const part of recipe?.parts||[])releaseMonsterText(part.textEntry,scene);},
      dispose:()=>releaseMonsterScene(scene),
    });}catch(error){releaseMonsterScene(scene);throw error;}
  }).catch(error=>{mountedCanvasBoards.delete(grid);console.warn('[CanvasBoard]',error);});
}
document.addEventListener('hexGridCreated',mountCanvasBoard);
window.addEventListener('combatPauseRestored',mountCanvasBoard);
queueMicrotask(mountCanvasBoard);
