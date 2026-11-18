import { entityFootprint, planEntityPlacements, commitEntityPlacements, calculateHexes } from "./controller.js";
import { entites } from "../entities/runtime.js";
import { refreshStageAccess } from "../app/state.js";
import { attackDetails } from "../data/attackList.js";
import {
  resolveAttackDefinitionForEntity,
  readEntityCombatProfile,
  subscribeAttackSelection,
} from "../combat/attackResolution.js";
import {
  AttackerSbireTargetPriority,
  AllySbireTargetPriority,
  updateIngameListingFocus,
  listingFocusInvocateur,
  getRoleFromHex,
} from "../combat/roles.js";
import { acceptsSelectedTarget } from "../combat/targeting.js";
import { getBattleEntityElement, isNonLordCombatant } from "../entities/rules.js";


// COMPTAGE DES ROLES
export let GlobalCombatantRoles = {
    sideA: [],
    sideB: []
};

export function logPositionsAndAnalyze() {
    return positionnerEntites();
}

// UPDATE ROLE EN FONCTION DE LA POSITION
export function updateRoleInDOM(entite) {
    if (!isNonLordCombatant(entite)) {
        return;
    }

    const roleImg = document.getElementById(`role-img_${entite.id}`);
    const roleTitle = document.querySelector(`#entiteDetailsContainer_${entite.id} .entity-role-title`);
    const roleName = document.querySelector(`#entiteDetailsContainer_${entite.id} .entite-role-name`);
    const rolePicto = document.querySelector(`#entiteDetailsContainer_${entite.id} .entity-role-picto`);
    const entiteBox = document.getElementById(`Box_Entite_${entite.id}`);
    const rolePortrait = document.querySelector(`#rolePortrait_${entite.id}.hud-portrait-role`);
    
    if (roleImg) {
        roleImg.alt = `${entite.name} est un ${entite.role}`;
        roleImg.className = `role-img role-${entite.role}`;
    }
    
    if (roleTitle) {
        roleTitle.textContent = entite.role;
    }

    if (roleName) {
        roleName.textContent = entite.role;
    }
    
    if (rolePicto) {
        rolePicto.className = `entity-role-picto role-${entite.role}`;
    }

    if (rolePortrait) {
        rolePortrait.className = `hud-portrait-role role-${entite.role}`;
    }

    if (entiteBox) {
        for (const name of [...entiteBox.classList]) {
            if (name.startsWith('side-') || name.startsWith('role-')) entiteBox.classList.remove(name);
        }
        entiteBox.classList.add('entite-box', `side-${entite.side}`, `role-${entite.role}`);
    }
}


// POSITION DANS LE DOM
export function positionnerEntites(newEntite = null, { previousCoordinates = new Map() } = {}) {
    const hexes = [...document.querySelectorAll('#hexGrid .hex[data-position]')];
    if (!hexes.length) return [];
    const byPosition = new Map(hexes.map(hex => [hex.dataset.position, hex]));
    const entries = (newEntite ? [newEntite] : entites)
        .map(entity => ({ entity, element: document.getElementById(`Box_Entite_${entity.id}`) })).filter(e => e.element);
    const movingIds = new Set(entries.map(({entity}) => String(entity.id))), occupied = new Set(), assignments = new Map();
    const sideClass = entity => entity.side === 'A' ? 'SideA' : entity.side === 'B' ? 'SideB' : 'Neutral';
    const allowed = (entity, hex) => hex.classList.contains(sideClass(entity)) || hex.classList.contains('Neutral');
    for (const other of entites) {
        if (movingIds.has(String(other.id))) continue;
        entityFootprint(other).forEach(hex => occupied.add(hex));
    }
    for (const hex of hexes) if (hex.classList.contains('consommable-summoned') || hex.querySelector(':scope > .battle-element, :scope > [data-occupies-hex="true"]')) occupied.add(hex);
    const fits = (entity, hex) => {
        const cells = entityFootprint(entity, hex);
        return cells.length && cells.every(cell => !occupied.has(cell) && allowed(entity, cell));
    };
    const reserve = (entity, hex) => { assignments.set(entity, hex); entityFootprint(entity, hex).forEach(cell => occupied.add(cell)); };
    for (const {entity} of entries) {
        const hex = byPosition.get(entity.position);
        const canKeep = hex && (hex.classList.contains(sideClass(entity)) || (hex.classList.contains('Neutral') &&
            (newEntite || previousCoordinates.get(entity.position)?.side === 'Neutral' || document.getElementById(`Box_Entite_${entity.id}`)?.parentElement === hex)));
        if (canKeep && fits(entity, hex)) reserve(entity, hex);
    }
    for (const {entity} of entries) {
        if (assignments.has(entity)) continue;
        const current = byPosition.get(entity.position), own = hexes.filter(hex => hex.classList.contains(sideClass(entity)));
        const origin = previousCoordinates.get(entity.position) || (current && {row:Number(current.dataset.row), col:Number(current.dataset.col)}) || {
            row:own.reduce((n,h)=>n+Number(h.dataset.row),0)/(own.length||1), col:own.reduce((n,h)=>n+Number(h.dataset.col),0)/(own.length||1)
        };
        const distance = hex => (Number(hex.dataset.col)+(Number(hex.dataset.row)%2)/2-origin.col-(origin.row%2)/2)**2 + .75*(Number(hex.dataset.row)-origin.row)**2;
        const available = own.filter(hex => fits(entity,hex)).sort((a,b)=>distance(a)-distance(b));
        const roles = (Array.isArray(entity.role)?entity.role:[entity.role]).map(role=>role==='gueux'?'neutre':role);
        let target = roles.map(role=>available.find(hex=>hex.dataset.role===role)).find(Boolean) || available[0];
        target ||= hexes.filter(hex=>hex.classList.contains('Neutral')&&fits(entity,hex)).sort((a,b)=>distance(a)-distance(b))[0];
        if (!target) { console.warn('Aucun placement complet pour', entity.name || entity.id); return []; }
        reserve(entity,target);
    }
    if (!assignments.size) return [];
    const plan = planEntityPlacements([...assignments].map(([entity,hex])=>({entity,hex})));
    return commitEntityPlacements(plan) ? [...assignments.keys()] : [];
}


// POSITIONNEMENT ET CALCUL
export function handlePositionsAndLogs() {
    return positionnerEntites();
}


// ECOUTEUR DEVENEMENT POUR MODIFICATION DE ROLES
	// ACTUALISTATION DU STOCKAGE DANS LA VARIABLE POUR LES SBIRES
export function updateCombatantRoleIndex() {
GlobalCombatantRoles = {
    sideA: entites
        .filter(entite => 
            entite.side === 'A' && 
            (entite.stats.HP?.current > 0 || entite.life > 0) && 
            isNonLordCombatant(entite)
        )
        .map(entite => ({
            name: entite.name || entite.type,
            role: entite.role || 'aucun',
            id: entite.id || 'inconnue',
            classe: entite.classe || 'aucune',
            type: entite.type
        })),

    sideB: entites
        .filter(entite => 
            entite.side === 'B' && 
            (entite.stats.HP?.current > 0 || entite.life > 0) && 
            isNonLordCombatant(entite)
        )
        .map(entite => ({
            name: entite.name || entite.type,
            role: entite.role || 'aucun',
            id: entite.id || 'inconnue',
            classe: entite.classe || 'aucune',
            type: entite.type
        }))
};

    // console.log('Rôles des combattants pour chaque côté:', GlobalCombatantRoles);
}
export function determineClasse(entite) {
    const profile = readEntityCombatProfile(entite, attackDetails);
    entite.classe = profile.combatFunction;
    entite.canTargetDead = profile.domains.includes('necro');
}


// Mettre à jour les classes pour toutes les entités
export function updateEntiteClasses() {
    entites.forEach(entite => determineClasse(entite));
}


// TARGET ZONE SBIRE ATTAQUANT
const selectedTargetDisplays = new WeakMap();

export function clearBattleTargetDisplays(entities = entites) {
    for (const entity of entities || []) selectedTargetDisplays.delete(entity);
}

export function getBattleTargetAttack(entity) {
    const committedAttack = selectedTargetDisplays.get(entity)?.attack;
    if (committedAttack) return committedAttack;

    const profile = readEntityCombatProfile(entity, attackDetails);
    const hasAmbiguousInitialTarget = profile?.combatFunction === 'Arbitre'
        && (profile?.domains?.length || 0) > 1;
    if (hasAmbiguousInitialTarget) return null;

    return entity.currentAttack
        || resolveAttackDefinitionForEntity(entity, entity.attacks?.[0], attackDetails);
}

function displayNeutralAttackTarget(entity) {
    entity.targetZone = 'none';
    const element = getBattleEntityElement(entity);
    if (element) {
        element.dataset.targetzone = 'none';
        delete element.dataset.attackFunction;
        delete element.dataset.attackDomain;
    }

    const container = document.getElementById(`TargetroleContainer_${entity.id}`);
    if (container) {
        container.className = `target-role-img-container sbire ${entity.side} no-target`;
        delete container.dataset.attackKey;
        const picto = container.querySelector('.target-picto-hud');
        if (picto) picto.className = 'target-picto-hud no-target';
        const roleImg = container.querySelector('.role-img');
        if (roleImg) roleImg.className = 'role-img sbire role-none';
        const frame = container.querySelector('.targetrole-img-hud');
        if (frame) frame.className = 'targetrole-img-hud sbire';
    }

    const targetInfo = document.getElementById(`TargetInfos_${entity.id}`);
    if (targetInfo) {
        targetInfo.classList.remove('Attaquant', 'Support', 'Arbitre', 'Invocateur', 'Necro');
        targetInfo.classList.add('no-target');
    }

    const listing = document.getElementById(`listing_${entity.id}`);
    if (listing) {
        listing.classList.remove('Attaquant', 'Support', 'Arbitre', 'Invocateur', 'Necro');
        listing.classList.add('no-target');
        listing.querySelectorAll('.target-zone').forEach(node => node.classList.remove('target-zone'));
    }

    const zone = document.querySelector(`#ScanEntity_${entity.id} .target-zone-role-display`);
    if (zone) zone.textContent = 'Aucune attaque sélectionnée.';
}

function targetRoleForAttack(entity, attack) {
    if (attack.attackTarget.includes('hexa')) return 'hexa';
    const candidates = entites.filter(candidate => candidate !== entity && acceptsSelectedTarget(entity, attack, candidate));
    const priorityTable = attack.attackTarget.includes('enemy') ? AttackerSbireTargetPriority : AllySbireTargetPriority;
    const priorities = priorityTable[entity.role] || priorityTable.gueux;
    return priorities.find(role => candidates.some(candidate => isNonLordCombatant(candidate) && candidate.role === role))
        || (candidates.some(candidate => candidate.type === 'lord') ? 'lord' : 'none');
}

// Only a committed attack replaces the HUD's last selection. Candidate previews
// and cooldown predictions must not change the action shown above the entity.
export function updateEntityAttackTargetDisplay(entity, selectedAttack = null, selectedTarget = null) {
    if (!isNonLordCombatant(entity)) return;
    if (selectedAttack) selectedTargetDisplays.set(entity, { attack: selectedAttack, target: selectedTarget });
    const attack = getBattleTargetAttack(entity);
    if (!attack) {
        displayNeutralAttackTarget(entity);
        return;
    }
    const committedTarget = selectedTargetDisplays.get(entity)?.target;
    const isHex = committedTarget ? committedTarget.nodeType === 1 : attack.attackTarget[0] === 'hexa';
    const isNecro = attack.deadTarget?.includes('yes');
    const role = isHex ? 'Invocateur' : committedTarget?.type === 'lord' ? 'lord' : committedTarget?.role || targetRoleForAttack(entity, attack);
    const functionName = attack.combatFunction;
    const classes = [functionName, isNecro ? 'Necro' : '', isHex ? 'domain-invocateur' : isNecro ? 'domain-necro' : 'domain-combattant'].filter(Boolean).join(' ');
    entity.targetZone = isHex ? 'hexa' : role;
    const element = getBattleEntityElement(entity);
    if (element) {
        element.dataset.targetzone = entity.targetZone;
        element.dataset.attackFunction = functionName;
        element.dataset.attackDomain = isHex ? 'invocateur' : isNecro ? 'necro' : 'combattant';
    }
    const container = document.getElementById(`TargetroleContainer_${entity.id}`);
    if (container) {
        container.className = `target-role-img-container sbire ${entity.side} ${classes}`;
        container.dataset.attackKey = attack.attackKey || attack.functionName;
        const picto = container.querySelector('.target-picto-hud');
        if (picto) picto.className = `target-picto-hud ${functionName} ${isNecro ? 'Necro' : ''}`;
        const roleImg = container.querySelector('.role-img');
        if (roleImg) roleImg.className = `role-img sbire role-${role}`;
        const frame = container.querySelector('.targetrole-img-hud');
        if (frame) frame.className = 'targetrole-img-hud sbire';
    }
    const targetInfo = document.getElementById(`TargetInfos_${entity.id}`);
    if (targetInfo) {
        targetInfo.classList.remove('Attaquant', 'Support', 'Arbitre', 'Invocateur', 'Necro');
        targetInfo.classList.add(functionName);
        if (isHex) targetInfo.classList.add('Invocateur');
        if (isNecro) targetInfo.classList.add('Necro');
    }
    const listing = document.getElementById(`listing_${entity.id}`);
    if (listing) {
        listing.className = `flisting-sbire focus-listing ${classes} focus-${isHex ? 'invocateur' : role === 'lord' ? 'lord' : 'sbire'}`;
        if (isHex) {
            listingFocusInvocateur(entity.id, entity.side, calculateHexes(entity.side).availableHexes);
        } else {
            const table = attack.attackTarget.includes('enemy') ? AttackerSbireTargetPriority : AllySbireTargetPriority;
            updateIngameListingFocus(entity.id, entity.role, table);
            if (role === 'lord') listing.innerHTML = '<div class="entity-role-listing role-lord target-zone"></div>';
            else listing.querySelector(`.role-${role}`)?.classList.add('target-zone');
        }
    }
    const zone = document.querySelector(`#ScanEntity_${entity.id} .target-zone-role-display`);
    if (zone) zone.textContent = isHex ? 'Ciblage des cases du terrain.' : `Cibles : ${isNecro ? 'cadavres' : 'entités'} ${attack.attackTarget.includes('enemy') ? 'ennemis' : 'alliés'} (${role}).`;
}

export function updateCombatantTargetZones() {
    refreshStageAccess();
    const roleCounts = { sideA: {}, sideB: {} };
    for (const entity of entites) {
        if (entity.isDEAD) continue;
        const counts = roleCounts[`side${entity.side}`];
        if (counts && isNonLordCombatant(entity)) counts[entity.role] = (counts[entity.role] || 0) + 1;
        updateEntityAttackTargetDisplay(entity);
    }
    return roleCounts;
}

export function observeRoleChanges() {
    const observer = new MutationObserver(mutations => {
        let roleChanged = false;

        mutations.forEach(mutation => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                const newRoleClass = Array.from(target.classList).find(cls => cls.startsWith('role-'));
                if (newRoleClass) {
                    const roleName = newRoleClass.split('-')[1];
                    const entityId = target.id.slice(target.id.lastIndexOf('_') + 1);

                    // Utiliser les priorités correctes en fonction du rôle et de la classe
                    const entite = entites.find(entite => entite.id == entityId);
                    if (entite) {
                        entite.role = roleName;
                        roleChanged = true;
                    }

                    // Mettre à jour la classe de l'élément ScanEntity
                    const entityScan = document.getElementById(`ScanEntity_${entityId}`);
                    if (entityScan) {
                        entityScan.classList.add('entite-details', roleName);

                    }
                }
            }
        });

        // Mettre à jour l'index des combattants une seule fois après toutes les mutations.
        if (roleChanged) {
            updateCombatantRoleIndex();
            updateCombatantTargetZones();
        }
    });

    const boxes = document.querySelectorAll('.entite-box');
    boxes.forEach(box => observer.observe(box, { attributes: true }));
}


export function applyCombatProfileView(element, entity, { text = false, helper = false } = {}) {
    const profile = readEntityCombatProfile(entity, attackDetails);
    const previous = (element.dataset.combatProfileClasses || '').split(' ').filter(Boolean);
    element.classList.remove(...previous);
    element.classList.add(...profile.classes);
    element.dataset.combatProfileClasses = profile.classes.join(' ');
    element.dataset.combatProfileEntity = entity.id;
    element.dataset.combatProfileText = String(text);
    element.dataset.combatProfileHelper = String(helper);
    if (text) element.textContent = profile.label;
    if (element.classList.contains('entity-role-BadgeContainer')) {
        let icons = element.querySelector('.entity-domain-icons');
        if (!icons) {
            icons = document.createElement('div');
            icons.className = 'entity-domain-icons';
            element.appendChild(icons);
        }
        icons.replaceChildren(...profile.domains.map(domain => {
            const icon = document.createElement('span');
            icon.className = `entity-domain-picto domain-${domain}`;
            icon.title = { necro: 'Nécro', invocateur: 'Invocateur', combattant: 'Combattant' }[domain];
            icon.setAttribute('aria-label', icon.title);
            return icon;
        }));
    }
    if (helper) {
        element.dataset.stat = 'battlefieldRole';
        element.dataset.hover = 'true';
        element.dataset.entityId = entity.id;
        element.dataset.helperText = profile.helper;
    }
    return profile;
}

subscribeAttackSelection(entity => {
    if (!entity || typeof document === 'undefined') return;
    for (const element of document.querySelectorAll('[data-combat-profile-entity]')) {
        if (element.dataset.combatProfileEntity !== String(entity.id)) continue;
        applyCombatProfileView(element, entity, {
            text: element.dataset.combatProfileText === 'true',
            helper: element.dataset.combatProfileHelper === 'true',
        });
    }
});

window.addEventListener('entityCombatSideChanged', () => {
    clearBattleTargetDisplays();
    updateCombatantRoleIndex();
    updateCombatantTargetZones();
});
