import {
  updateRoleInDOM, getBattleTargetAttack, updateEntityAttackTargetDisplay, applyCombatProfileView,
  IngameListingFocus, renderMovementCounter, getLevelBattleStats,
} from "./hud.js";
import { attachPhaserMonster, wakePhaserMonsters, renderEntityTint, getMonsterPlacementOffset } from "./animations.js";
import { persistentMediaMarkup, loadResource, loadSpriteAtlas, getAnimatedImageState } from "../data/loaderList.js";
import { updateHealthBar } from "./vitalFeedback.js";
import { entitySizeInCells, applyEntitySizeVisual } from "../board/controller.js";
import { calibrateEntityVisuals } from "./popups.js";
import { setTimeout, requestAnimationFrame, clockNow } from "../combat/clock.js";
import { cachedResourceImage, cachedResourceUrl, playCachedGif } from "../data/loaderList.js";
import { determineClasse } from "../board/deployment.js";
import { AttackerSbireTargetPriority, AllySbireTargetPriority } from "../combat/roles.js";
import { createUmbraBlock } from "../ui/statistics/components.js";
import { createEntityAttackDisplay } from "../ui/attacks.js";
import { createStuffDom } from "../ui/codex/profile.js";
import { entites } from "../entities/runtime.js";
import { attackDetails } from "../data/attackList.js";
import { resolveAttackDefinitionForEntity } from "../combat/attackResolution.js";
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

// One species uses a compiled presentation: layout is sampled on creation/resize,
// while frames consume combat data and timed presentation commands. The existing
// HTML remains the input and paused-scene adapter.
const monsterViews = new WeakSet(), monsterImages = new Map(), monsterResources = new Map();
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
  const values={...binding.values};
  for(const [key,tween] of binding.tweens) {
    const t=monsterClamp((now-tween.start)/tween.duration);
    values[key]=monsterLerp(tween.from,tween.to,monsterEase(t,tween.easing));
    if(t===1)binding.tweens.delete(key);
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
  if (entry && --entry.users === 0) { scene.textures.remove(entry.texture); monsterTextTextures.delete(entry.key); }
}
function updateMonsterText(layer, scene, css, text) {
  if (layer.text === text && layer.color === css.color) return;
  layer.text = text; layer.color = css.color;
  const font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  const key = `${font}|${css.color}|${css.textShadow}|${text}`;
  if (layer.textEntry?.key === key) return;
  let entry = monsterTextTextures.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.font = font;
    const metrics = ctx.measureText(text), size = parseFloat(css.fontSize);
    const width = Math.max(1, Math.ceil(metrics.width)), height = Math.max(1, Math.ceil(size * 1.3));
    const padding = 4;
    canvas.width = (width + padding * 2) * 2; canvas.height = (height + padding * 2) * 2; ctx.scale(2, 2); ctx.font = font;
    const shadow = css.textShadow.match(/(rgba?\([^)]+\)) (-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px/);
    if (shadow) { ctx.shadowColor = shadow[1]; ctx.shadowOffsetX = +shadow[2]; ctx.shadowOffsetY = +shadow[3]; ctx.shadowBlur = +shadow[4]; }
    ctx.fillStyle = css.color; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, padding, padding + (height + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    const texture = `monster-text-${++monsterTextureId}`; scene.textures.addImage(texture, canvas);
    monsterTextTextures.set(key, entry = { key, texture, width, height, padding, users: 0 });
  }
  entry.users++; releaseMonsterText(layer.textEntry, scene); layer.textEntry = entry;
  if (!layer.image) layer.image = scene.add.image(0, 0, entry.texture).setOrigin(0);
  else layer.image.setTexture(entry.texture);
}
function monsterPanelKey(node, entity) {
  if (node.matches(monsterBars)) {
    const css = monsterStyle(node), fill = node.querySelector('.health-fill,.armor-fill');
    return `bar:${node.className}:${css.backgroundColor}:${css.backgroundImage}:${fill ? monsterStyle(fill).backgroundColor : ''}`;
  }
  if (node.classList.contains('hud-ingame')) return `hud:${entity.side}:${entity.type}:${entity.role}:${entity.level}:` +
    [node.querySelector('[id^="Targetrole-img_"]')?.className, node.querySelector('.target-picto-hud')?.className,
      ...[...node.querySelectorAll('.extraLife-counter,.fadedLife-counter,.eternalLife-counter,.hudbattletexte')].map(n => n.textContent)].join('|');
  if (node.classList.contains('attaque-timers')) return `attack:${node.querySelector('img')?.src}:${node.querySelector('img')?.className}:${node.firstElementChild?.className}`;
  return `${node.className}:${persistentMediaMarkup(node.innerHTML).replace(/ id="[^"]*"/g, '')}`;
}
async function acquireMonsterPanel(scene, node, signature) {
  let entry = monsterPanels.get(signature);
  if (!entry) {
    entry = { users: 0, signature };
    const epoch = monsterCacheEpoch;
    entry.ready = monsterPanelTexture(node).then(panel => {
      if (epoch !== monsterCacheEpoch) throw new DOMException('Scene disposed', 'AbortError');
      entry.texture = `monster-panel-${++monsterTextureId}`; scene.textures.addImage(entry.texture, panel.image);
      return entry.panel = panel;
    });
    monsterPanels.set(signature, entry);
  }
  entry.users++;
  try { await entry.ready; return entry; }
  catch (error) { entry.users--; monsterPanels.delete(signature); throw error; }
}
function releaseMonsterPanel(entry, scene) {
  if (!entry) return; entry.users--;
  for (const [key, cached] of monsterPanels) {
    if (monsterPanels.size <= 96) break;
    if (cached.users || !cached.texture) continue;
    scene.textures.remove(cached.texture); monsterPanels.delete(key);
  }
}
const monsterWebGLRequested = () => !globalThis.__combatSimulation
  && new URLSearchParams(location.search).get('monsters') === 'webgl';
const monsterPaintProperties = (`display position left top right bottom width height min-width min-height max-width max-height
 box-sizing box-shadow padding margin overflow border border-radius border-top border-right border-bottom border-left
 background background-size background-position background-repeat color opacity visibility z-index
 font-family font-size font-weight font-style line-height letter-spacing text-align text-shadow text-transform white-space
 align-items justify-content flex flex-direction flex-wrap gap order float vertical-align
 transform transform-origin filter clip-path object-fit object-position`).split(/\s+/).filter(Boolean);
function monsterResource(url) {
  const key = new URL(url, document.baseURI).href;
  if (!monsterResources.has(key)) monsterResources.set(key, fetch(key).then(response => {
    if (!response.ok) throw new Error(`Monster texture: ${response.status} ${key}`);
    return response.blob();
  }).then(async blob => {
    if (!/image\/svg\+xml/.test(blob.type)) return blob;
    const image = new Image(), url = URL.createObjectURL(blob);
    try {
      image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth || 128; canvas.height = image.naturalHeight || 128;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise(resolve => canvas.toBlob(resolve));
    } finally { URL.revokeObjectURL(url); }
  }).then(blob => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
  })));
  return monsterResources.get(key);
}
async function inlineMonsterUrls(value) {
  const urls = [...value.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
  for (const match of urls) value = value.replace(match[0], `url("${await monsterResource(match[1])}")`);
  return value;
}
const monsterPanelSelector = '.hud-ingame,.attaque-timers,.combat-popup-life,.target-search-indicator,.runaway-info,.order-exclamation,.melee-motion-trail,.shield-sweep-layer';
const monsterBars = '.health-bar,.armor-bar,.atb-fill,.attack-bar-fill';
const monsterTexts = '.HP-counter,.armor-text,.current-shift,.timer-activeattack';
const monsterDynamic = `${monsterBars},${monsterTexts},.attaque-timers`;
async function monsterMarkup(node, root = true) {
  const clone = node.cloneNode(false), css = getComputedStyle(node);
  clone.removeAttribute('id'); clone.removeAttribute('class'); clone.removeAttribute('style');
  for (const key of monsterPaintProperties) clone.style.setProperty(key, css.getPropertyValue(key));
  if (node.matches('.health-fill,.armor-fill')) clone.style.width = '100%';
  clone.style.animation = 'none'; clone.style.transition = 'none'; clone.style.visibility = 'visible';
  if (!root && node.matches(monsterDynamic)) { clone.style.visibility = 'hidden'; return clone; }
  const jobs = [];
  if (css.backgroundImage !== 'none') jobs.push(inlineMonsterUrls(css.backgroundImage).then(value => { clone.style.backgroundImage = value; }));
  if (node instanceof HTMLImageElement && node.currentSrc) jobs.push(monsterResource(node.currentSrc).then(value => { clone.src = value; }));
  for (const child of node.childNodes) {
    if (child.nodeType === 3) clone.append(child.cloneNode());
    else if (child.nodeType === 1) jobs.push(monsterMarkup(child, false).then(value => childClones.set(child, value)));
  }
  // Preserve child order even when embedded images finish in a different order.
  const childClones = new Map();
  for (const pseudo of ['::before', '::after']) {
    const style = getComputedStyle(node, pseudo);
    if (style.content === 'none' || style.content === 'normal' || style.display === 'none') continue;
    const part = document.createElement('span');
    for (const key of monsterPaintProperties) part.style.setProperty(key, style.getPropertyValue(key));
    part.textContent = style.content.replace(/^['"]|['"]$/g, '');
    if (style.backgroundImage !== 'none') jobs.push(inlineMonsterUrls(style.backgroundImage).then(value => { part.style.backgroundImage = value; }));
    childClones.set(pseudo, part);
  }
  await Promise.all(jobs);
  clone.replaceChildren();
  if (childClones.has('::before')) clone.append(childClones.get('::before'));
  for (const child of node.childNodes) clone.append(child.nodeType === 3 ? child.cloneNode() : childClones.get(child) || '');
  if (childClones.has('::after')) clone.append(childClones.get('::after'));
  return clone;
}
async function monsterPanelTexture(node) {
  const width = node.matches(monsterBars) ? 256 : Math.max(1, node.offsetWidth), height = Math.max(1, node.offsetHeight), padding = 48;
  const clone = await monsterMarkup(node);
  Object.assign(clone.style, { position: 'absolute', left: `${padding}px`, top: `${padding}px`, right: 'auto', bottom: 'auto',
    width: `${width}px`, height: `${height}px`, transform: 'none', margin: '0', opacity: '1', visibility: 'visible' });
  const font = await monsterResource('./media/typo/EBGaramond-Regular.ttf');
  const w = width + padding * 2 + (node.classList.contains('hud-ingame') ? 80 : 0), h = height + padding * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>@font-face{font-family:'EB Garamond';src:url('${font}')}</style>${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
  const image = new Image(); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return { image: canvas, width, height, padding, w, h };
}
async function monsterAsset(scene, source, filter = 'none', body = false) {
  const resourceSource = persistentMediaMarkup(source), key = `${resourceSource}|${filter}|${body}`;
  let entry = monsterImages.get(key);
  if (!entry) {
    const epoch = monsterCacheEpoch;
    entry = (async () => {
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
function mountWebGLMonster(entity, box) {
  if (!monsterWebGLRequested() || entity.class !== 'grouille-doigt' || !box.isConnected || !box.closest('#hexGrid') || monsterViews.has(box)) return;
  monsterViews.add(box);
  void attachPhaserMonster(box, async scene => {
    activeMonsterViews++;
    const layers=new Map(), bindings=new Map();
    const grid=box.closest('#hexGrid');
    let cells=new Map(), originCell, originPosition, boardScale={x:1,y:1}, destroyed=false, suspended=false, queued=false, geometryQueued=false;
    const cssCopy=css=>Object.fromEntries(['opacity','display','transform','scale','left','top','right','fontStyle','fontWeight','fontSize','fontFamily','textShadow','textAlign','color','backgroundColor','backgroundImage','transitionProperty','transitionDuration','transitionTimingFunction','transformOrigin','filter'].map(key=>[key,css[key]]));
    const bind = node => {
      if(bindings.has(node))return bindings.get(node);
      const css=cssCopy(getComputedStyle(node)), rect=node.getBoundingClientRect();
      const width=node.offsetWidth||rect.width/boardScale.x||1, height=node.offsetHeight||rect.height/boardScale.y||1;
      const origin=css.transformOrigin.split(' ').map(parseFloat), values={};
      for(const key of ['transform','scale','opacity','left','top','right','filter'])values[key]=monsterValue(key,css[key],{width,height});
      const b={node,css,rect:{x:rect.left,y:rect.top,w:rect.width,h:rect.height},width,height,
        origin:{x:rect.left+(origin[0]||0)*boardScale.x,y:rect.top+(origin[1]||0)*boardScale.y},
        values,base:{...values},tweens:new Map(),animations:[]};
      b.animations=node.getAnimations().map(animation=>monsterAnimation(animation,b));
      bindings.set(node,b);
      node._monsterStyleChanged=(changes,now)=>{
        try {
        b.commanded=true;
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
          } else if(key==='display'){if(b.css.display==='none'&&value!=='none')invalidateGeometry();b.css.display=value;}
          else if(key==='width')b.fill=monsterClamp(parseFloat(value)/100);
          else if(key==='animation')b.animations=node.getAnimations().map(animation=>monsterAnimation(animation,b));
          else if(key==='animationDuration')for(const animation of b.animations)animation.duration=parseFloat(value)*(String(value).endsWith('ms')?1:1000);
        }
      } catch(error){fail(error);}
      };
      node._monsterAnimationStarted=animation=>{try{b.animations.push(monsterAnimation(animation,b));}catch(error){fail(error);}};
      return b;
    };
    const chainFor=node=>{const chain=[];for(let n=node;n&&n!==grid;n=n.parentElement)chain.push(bind(n));return chain;};
    const calibrateBoard=()=>{
      cells=new Map([...grid.querySelectorAll('.hex[data-position]')].map(cell=>{
        const rect=cell.getBoundingClientRect();return [cell.dataset.position,{x:rect.left,y:rect.top,w:rect.width,h:rect.height,localW:cell.offsetWidth||1,localH:cell.offsetHeight||1}];
      }));
      originPosition=String(entity.position);originCell=cells.get(originPosition)||{x:0,y:0,w:1,h:1,localW:1,localH:1};
      boardScale={x:originCell.w/originCell.localW,y:originCell.h/originCell.localH};
    };
    calibrateBoard();
    const install=(node,kind)=>{
      if(layers.has(node))return layers.get(node);
      const css=cssCopy(getComputedStyle(node)), rect=node.getBoundingClientRect();
      const layer={node,kind,css,rect:{x:rect.left,y:rect.top,w:rect.width,h:rect.height},chain:chainFor(node),dirty:true,startedAt:performance.now(),fallbackText:node.textContent,textScaleX:rect.width/(node.offsetWidth||1),textScaleY:rect.height/(node.offsetHeight||1)};
      if(kind==='bar') {
        const parent=node.parentElement, r=parent.getBoundingClientRect();
        layer.rect={x:r.left+parent.clientLeft*boardScale.x,y:r.top+parent.clientTop*boardScale.y,w:parent.clientWidth*boardScale.x,h:parent.clientHeight*boardScale.y};
        layer.bar=node.classList.contains('health-bar')?'hp':node.classList.contains('armor-bar')?'armor':node.classList.contains('atb-fill')?'atb':'attack';
        layer.fill=0;layer.fillTarget=-1;
        const r0=node.getBoundingClientRect(), scaleX=r.width/(parent.offsetWidth||1), scaleY=r.height/(parent.offsetHeight||1);
        layer.rect={x:r.left+parent.clientLeft*scaleX,y:r.top+parent.clientTop*scaleY,w:parent.clientWidth*scaleX,h:parent.clientHeight*scaleY};
        if(layer.bar==='hp'||layer.bar==='armor')layer.rect.y=r0.top;
        layer.barBinding=bind(node);
        const fill=node.querySelector('.health-fill,.armor-fill');if(fill)layer.chain.unshift(bind(fill));
      }
      layer.maxShift=node.classList.contains('max');
      if(kind==='text')layer.textRole=node.classList.contains('HP-counter')?'hp':node.classList.contains('armor-text')?'armor':node.classList.contains('current-shift')?'shift':node.classList.contains('preparation')?'prep':node.classList.contains('execution')?'exec':'label';
      layer.flipX=layer.chain.reduce((flip,b)=>b.values.transform[0]<0?!flip:flip,false);
      const moving=getMonsterPlacementOffset(entity);layer.rect.x-=moving.x*boardScale.x;layer.rect.y-=moving.y*boardScale.y;
      layers.set(node,layer);return layer;
    };
    const refreshList=()=>{
      for(const node of box.querySelectorAll('canvas'))install(node,'body');
      for(const node of box.querySelectorAll(monsterPanelSelector))install(node,'panel');
      for(const node of box.querySelectorAll('img'))if(!node.closest('.hud-ingame,.combat-popup-life'))install(node,'asset');
      for(const node of box.querySelectorAll(monsterBars))install(node,'bar');
      for(const node of box.querySelectorAll(monsterTexts))install(node,'text');
      for(const [node,layer] of layers)if(!box.contains(node)){disposeMonsterLayer(layer,scene);layers.delete(node);}
      const used=new Set([...layers.values()].flatMap(layer=>layer.chain));
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
          if(!layer.node.offsetWidth||!layer.node.offsetHeight)return;
          const signature=monsterPanelKey(layer.node,entity);if(signature===layer.signature)return;
          const cached=await acquireMonsterPanel(scene,layer.node,signature);
          if(destroyed||layer.cancelled){releaseMonsterPanel(cached,scene);return;}
          releaseMonsterPanel(layer.panelEntry,scene);layer.panelEntry=cached;layer.signature=signature;panel=cached.panel;texture=cached.texture;
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
        if(!layer.image)layer.image=scene.add.image(0,0,texture).setOrigin(.5).setVisible(false);else layer.image.setTexture(texture);
        layer.panel=panel;
        if(layer.kind==='body') {
          const neutral=await monsterAsset(scene,layer.source,'none',true);if(destroyed||layer.cancelled)return;
          layer.tint ||= scene.add.image(0,0,neutral.name).setOrigin(.5).setVisible(false);layer.tint.setTexture(neutral.name);
          layer.tintHandler=layer.node._phaserMonsterTint=store=>{layer.tone=[...(store?.values()||[])].sort((a,b)=>b.priority-a.priority||b.updatedAt-a.updatedAt)[0];};
          renderEntityTint(layer.node);
        }
      } catch(error){fail(error);} finally{layer.busy=false;if(layer.dirty&&!destroyed)schedule();}
    };
    const schedule=()=>{
      if(queued||destroyed)return;queued=true;
      globalThis.requestAnimationFrame(()=>{
        queued=false;if(destroyed)return;
        refreshList();for(const layer of layers.values())if(layer.dirty)void prepare(layer);
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
      b.css=cssCopy(getComputedStyle(node));
      const layer=layers.get(node);if(layer)layer.css=b.css;
      if(previousFilter!==monsterColorFilter(b.css.filter)){
        for(const candidate of layers.values())if(candidate.asset&&candidate.chain.includes(b))candidate.dirty=true;
        schedule();
      }
      if(previousDisplay==='none'&&b.css.display!=='none')invalidateGeometry();
      for(const key of ['transform','scale','opacity','left','top','right','filter'])b.values[key]=monsterValue(key,b.css[key],b);
      b.animations=node.getAnimations().map(animation=>monsterAnimation(animation,b));
    };
    const observer=new MutationObserver(records=>{
      const commanded=new Set([...bindings.values()].filter(b=>b.commanded).map(b=>b.node));
      const changed=new Map();
      for(const record of records) {
        const node=record.target.nodeType===1?record.target:record.target.parentElement;
        if(record.type==='childList' && [...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1)){schedule();continue;}
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
    });
    const invalidateGeometry=(refreshBoard=false)=>{
      if(destroyed||geometryQueued)return;geometryQueued=true;
      // Geometry is only rebuilt for viewport/board sizing, never for a frame.
      queueMicrotask(()=>{
        geometryQueued=false;if(destroyed||!box.isConnected)return;
        if(refreshBoard)calibrateBoard();
        else {originCell=cells.get(String(entity.position))||originCell;boardScale={x:originCell.w/originCell.localW,y:originCell.h/originCell.localH};}
        for(const node of bindings.keys()){delete node._monsterStyleChanged;delete node._monsterAnimationStarted;}
        bindings.clear();
        for(const [node,layer] of [...layers]) {
          layers.delete(node);const fresh=install(node,layer.kind);
          Object.assign(layer,{rect:fresh.rect,chain:fresh.chain,css:fresh.css,barBinding:fresh.barBinding,flipX:fresh.flipX,textScaleX:fresh.textScaleX,textScaleY:fresh.textScaleY});layers.set(node,layer);
          if(!layer.image)layer.dirty=true;
        }
        schedule();
      });
    };
    const destroy=()=>{
      if(destroyed)return;destroyed=true;observer.disconnect();resize.disconnect();box.removeAttribute('data-monster-webgl');delete box._monsterView;
      for(const node of bindings.keys()){delete node._monsterStyleChanged;delete node._monsterAnimationStarted;}bindings.clear();
      for(const layer of layers.values())disposeMonsterLayer(layer,scene);layers.clear();
      if(--activeMonsterViews===0){monsterCacheEpoch++;for(const key of Object.keys(scene.textures.list))if(key.startsWith('monster-'))scene.textures.remove(key);monsterPanels.clear();monsterImages.clear();monsterResources.clear();monsterTextTextures.clear();}
    };
    const fail=error=>{if(!destroyed){destroy();console.warn('[MonsterWebGL] HTML restored:',error);}};
    const resize=new ResizeObserver(()=>invalidateGeometry(true));resize.observe(grid);
    const barTexture=(kind)=>{
      const key=`monster-bar-${kind}`;if(scene.textures.exists(key))return key;
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=16;const ctx=canvas.getContext('2d');
      if(kind==='overlay') {
        for(const [x,y,a,b] of [[256,0,.23,.23],[0,16,.2,.3]]){const g=ctx.createLinearGradient(0,0,x,y);g.addColorStop(0,`rgba(255,255,255,${a})`);g.addColorStop(1,`rgba(0,0,0,${b})`);ctx.fillStyle=g;ctx.fillRect(0,0,256,16);}
      } else {ctx.fillStyle='white';ctx.fillRect(0,0,256,16);}
      scene.textures.addImage(key,canvas);return key;
    };
    barTexture('base');barTexture('overlay');
    const pose=(rect,chain,frame)=>{
      let x=rect.x+rect.w/2,y=rect.y+rect.h/2,w=rect.w,h=rect.h,angle=0,alpha=1,brightness=1,visible=true;
      for(const binding of chain) {
        const value=frame.get(binding), base=binding.base, m=value.transform, b=base.transform;
        alpha*=value.opacity[0];brightness*=value.filter[0];visible&&=binding.css.display!=='none';
        if(binding.node===box)continue; // placement comes from the logical board
        const sx=Math.hypot(m[0],m[1])/(Math.hypot(b[0],b[1])||1)*value.scale[0]/base.scale[0];
        const sy=Math.hypot(m[2],m[3])/(Math.hypot(b[2],b[3])||1)*value.scale[1]/base.scale[1];
        const a=Math.atan2(m[1],m[0])-Math.atan2(b[1],b[0]);
        const dx=(m[4]-b[4]+value.left[0]-base.left[0]-value.right[0]+base.right[0])*boardScale.x;
        const dy=(m[5]-b[5]+value.top[0]-base.top[0])*boardScale.y;
        const ox=binding.origin.x,oy=binding.origin.y,px=(x-ox)*sx,py=(y-oy)*sy;
        x=ox+px*Math.cos(a)-py*Math.sin(a)+dx;y=oy+px*Math.sin(a)+py*Math.cos(a)+dy;w*=sx;h*=sy;angle+=a;
      }
      return {x,y,w,h,angle,alpha,brightness,visible};
    };
    const update=(now,showHTML=false)=>{
      if(destroyed)return;
      if(suspended!==showHTML){suspended=showHTML;box.dataset.monsterWebgl=suspended?'suspended':'ready';for(const layer of layers.values())if(layer.tintHandler){if(suspended)delete layer.node._phaserMonsterTint;else layer.node._phaserMonsterTint=layer.tintHandler;renderEntityTint(layer.node);}}
      if(suspended){for(const layer of layers.values()){layer.image?.setVisible(false);layer.overlay?.setVisible(false);layer.tint?.setVisible(false);layer.brightness?.setVisible(false);}return;}
      const frame=new Map([...bindings.values()].map(binding=>[binding,monsterAnimatedValues(binding,now)]));
      const cell=cells.get(String(entity.position))||originCell, ratio=cell.w/originCell.w, move=getMonsterPlacementOffset(entity);
      const hp=Math.max(0,Math.min(entity.stats.HP.current,entity.stats.HP.max)),armor=Math.max(0,entity.stats.armor?.current||0),den=Math.max(entity.stats.HP.max,hp+armor)||1;
      let atb=1;
      if(entity.orderPhase==='orderDecision')atb=entity.recoveryTime/Math.max(1,entity.maxRecoveryTime)*(entity.ATBfillBeforeOrder||100)/100;
      else if(entity.orderPhase==='orderExecution')atb=1-entity.orderExecutionTime/Math.max(1,entity.maxOrderExecutionTime);
      else if(entity.recoveryTime>0)atb=entity.recoveryTime/Math.max(1,entity.maxRecoveryTime||entity.recoveryTime);
      else if(entity.speedTimer>0 && !(entity.preparationTime>0||entity.executionTime>0))atb=1-entity.speedTimer/(Number(entity.stats.speed?.current)||1000);
      const prep=Number(entity.preparationTime)||0,exec=Number(entity.executionTime)||0;
      for(const layer of layers.values()) {
        let rect={...layer.rect},visible=true,color=0xffffff;
        if(layer.kind==='body'&&getEntitySpriteSource(entity)!==layer.source){layer.dirty=true;schedule();}
        if(layer.kind==='text') {
          const value=layer.textRole==='hp'?`HP : ${hp} / ${entity.stats.HP.max}`:layer.textRole==='armor'?`🛡️ ${armor}`:layer.textRole==='shift'?String(Math.round(Number(entity.stats.shift?.[layer.maxShift?'max':'current'])||0)):layer.textRole==='prep'?`${(prep/1000).toFixed(1)}s`:layer.textRole==='exec'?`${(exec/1000).toFixed(1)}s`:layer.fallbackText;
          updateMonsterText(layer,scene,layer.css,value);
          if(layer.textRole==='prep')visible=prep>0;if(layer.textRole==='exec')visible=prep<=0&&exec>0;
          const entry=layer.textEntry,scaleX=layer.textScaleX,scaleY=layer.textScaleY;
          const align=layer.css.textAlign,offset=align==='center'?(rect.w-entry.width*scaleX)/2:align==='right'?rect.w-entry.width*scaleX:0;
          rect={x:rect.x+offset-entry.padding*scaleX,y:rect.y+(rect.h-entry.height*scaleY)/2-entry.padding*scaleY,w:(entry.width+entry.padding*2)*scaleX,h:(entry.height+entry.padding*2)*scaleY};
        } else if(layer.kind==='bar') {
          let target=layer.bar==='hp'?hp/den:layer.bar==='armor'?armor/den:layer.bar==='atb'?(layer.barBinding.fill??atb):prep>0?1-prep/Math.max(1,entity.currentAttack?.preparationTime||1):exec>0||entity.recoveryTime>0?1:0;
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
        const p=pose(rect,layer.chain,frame),image=layer.image;
        const x=cell.x+(p.x-originCell.x)*ratio+move.x*boardScale.x*ratio,y=cell.y+(p.y-originCell.y)*ratio+move.y*boardScale.y*ratio;
        let w=p.w*ratio,h=p.h*ratio,px=x,py=y;
        if(layer.panel){const a=layer.panel;w*=a.w/a.width;h*=a.h/a.height;px+=(a.w-a.width-2*a.padding)/2/a.width*p.w*ratio;}
        else if(layer.asset){w*=layer.asset.width/layer.asset.contentWidth;h*=layer.asset.height/layer.asset.contentHeight;}
        const depth=-100+(layer.kind==='text'?5:layer.kind==='bar'?4:layer.kind==='body'?1:layer.kind==='asset'?2:3);
        image.setPosition(px,py).setDisplaySize(w,h).setRotation(p.angle).setAlpha(p.alpha).setVisible(visible&&p.visible&&w>0&&h>0).setDepth(depth);
        if(layer.kind==='asset'||layer.kind==='body'){
          image.setFlipX(layer.flipX);
          const shade=Math.round(255*Math.min(1,p.brightness));image.setTint((shade<<16)|(shade<<8)|shade);
          const a=layer.asset,playback=getAnimatedImageState(layer.node);let elapsed=(performance.now()-(playback?.startedAt??layer.startedAt))%a.total,idx=0;
          while(idx<a.count-1&&elapsed>=a.nativeDurations[idx])elapsed-=a.nativeDurations[idx++];image.setFrame(idx);
          if(p.brightness>1&&!layer.brightness)layer.brightness=scene.add.image(0,0,a.name).setOrigin(.5).setBlendMode('ADD');
          if(layer.brightness)layer.brightness.setTexture(a.name,idx).setPosition(px,py).setDisplaySize(w,h).setRotation(p.angle)
            .setFlipX(layer.flipX).setAlpha(p.alpha*Math.min(1,p.brightness-1)).setDepth(depth+.0000001).setVisible(image.visible&&p.brightness>1);
        }
        if(layer.overlay)layer.overlay.setPosition(x,y).setDisplaySize(p.w*ratio,p.h*ratio).setRotation(p.angle).setAlpha(p.alpha).setVisible(image.visible).setDepth(depth+.000001);
        if(layer.tint){const tone=layer.tone,rgb=tone?.color.split(',').map(Number)||[0,0,0];layer.tint.setPosition(x,y).setDisplaySize(p.w*ratio,p.h*ratio).setRotation(p.angle).setFlipX(layer.flipX).setDepth(depth+.000001).setVisible(image.visible&&Boolean(tone)).setAlpha(p.alpha*(tone?.opacity||0)).setTintFill((rgb[0]<<16)|(rgb[1]<<8)|rgb[2]);}
      }
    };
    refreshList();await Promise.all([...layers.values()].map(prepare));
    if(!destroyed){
      if(!document.getElementById('monster-webgl-style')){const css=document.createElement('style');css.id='monster-webgl-style';css.textContent='[data-monster-webgl="ready"] :is(canvas,img,.hud-ingame,.combat-popup-life,.target-search-indicator,.runaway-info,.order-exclamation,.melee-motion-trail,.shield-sweep-layer){visibility:hidden!important}';document.head.append(css);}
      box.dataset.monsterWebgl='ready';box._monsterView={invalidateGeometry};
      observer.observe(box,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','src']});update(clockNow());
    }
    return {update,destroy,invalidateGeometry,active:()=>!destroyed};
  }).catch(error=>{monsterViews.delete(box);console.warn('[MonsterWebGL]',error);});
}

window.addEventListener('combatPauseRestored', () => {
  if (!monsterWebGLRequested()) return;
  for (const entity of entites) {
    const box = document.getElementById(`Box_Entite_${entity.id}`);
    if (box && !monsterViews.has(box)) { box.removeAttribute('data-monster-webgl'); mountWebGLMonster(entity, box); }
  }
});
