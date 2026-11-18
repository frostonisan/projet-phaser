import { loadFromLocalStorage, saveToLocalStorage, armyAConfig, isAdminMode } from './GameStorage.js';
import { entitesNestUp, generateUniqueID, enrichEntityStats, registerEntityAcquisition } from "./entites.js";
import { assertEntityType, isLord, isNonLordCombatant } from "./entite/entityRules.js";

export function canRecruitEntity(entity, acquisition = {}) {
    return isNonLordCombatant(entity)
        || (isLord(entity) && acquisition.source === 'shop' && isAdminMode());
}

export function addEntityToArmyA(entity, level = 1, acquisition = {}) {
    if (!canRecruitEntity(entity, acquisition)) {
        throw new TypeError(`Impossible d'ajouter ${entity?.type} comme unité recrutée.`);
    }
    const selectedArmyA = loadFromLocalStorage('selectedArmyA', []);

    const newEntity = {
        ...entity,
        id: generateUniqueID(),
        side: 'A',
        level,
        experience: 0
    };

    // Assurer que HP et autres stats sont enrichies
    const enriched = enrichEntityStats(newEntity);
    registerEntityAcquisition(enriched, acquisition);

    selectedArmyA.push(enriched);
    saveToLocalStorage('selectedArmyA', selectedArmyA);

    console.log(`✅ Entité ajoutée à l'Armée A : ${enriched.name}, ID : ${enriched.id}`);
    return enriched;
}

export function generateArmyA(
    armyConfig,
    entitesNestUp,
    acquisition = { source: 'initial' }
) {
    if (!Array.isArray(armyConfig?.unitIds)) {
        throw new TypeError('armyConfig.unitIds doit être défini avant de générer l’armée A.');
    }
    const providedLordId = armyConfig.lordId;
    const providedLordNickname = armyConfig.lordNickname || null; // Permet de fournir un surnom pour le Lord
    const providedUnitIds = armyConfig.unitIds;
    const providedUnitNicknames = armyConfig.unitNicknames || {};

    let selectedEntitiesA = [];
    const cloneTemplateLevel = (level) => {
        if (level && typeof level === 'object') return { ...level };
        if (typeof level === 'number' && level > 0) return level;
        return 1;
    };

    // Charger et valider le Lord
    if (providedLordId != null) {
        const providedLord = entitesNestUp.find(entite => entite.id === providedLordId);
        if (providedLord) {
            if (!isLord(providedLord)) throw new TypeError(`${providedLord.name} n'est pas un lord.`);
            let newLordEntity = { 
                ...providedLord, 
                id: generateUniqueID(), 
                side: 'A', 
                level: cloneTemplateLevel(providedLord.level),
                nickname: providedLordNickname // Ajout du nickname pour le Lord
            };

            // Application du bonus de vitalité aux HP
            newLordEntity = enrichEntityStats(newLordEntity);
            registerEntityAcquisition(newLordEntity, acquisition);

            selectedEntitiesA.push(newLordEntity);
            console.log(`Utilisé LORD pour Côté A : ${newLordEntity.name}, Nickname : ${newLordEntity.nickname}, Level : ${newLordEntity.level}, Power : ${newLordEntity.power}, HP : ${newLordEntity.stats.HP}, ID : ${newLordEntity.id}`);
        } else {
            console.warn(`Le Lord avec l'ID ${providedLordId} n'existe pas dans les données.`);
        }
    } else {
        console.log("Aucun Lord fourni pour le côté A.");
    }

    // Charger et valider les unités non-lords.
    providedUnitIds.forEach(unitId => {
        const providedUnit = entitesNestUp.find(entite => entite.id === unitId);
        if (providedUnit) {
            assertEntityType(providedUnit);
            if (!isNonLordCombatant(providedUnit)) {
                throw new TypeError(`${providedUnit.name} n'est pas un sbire.`);
            }
            let newUnitEntity = {
                ...providedUnit,
                id: generateUniqueID(), 
                side: 'A', 
                level: cloneTemplateLevel(providedUnit.level),
                nickname: providedUnitNicknames[unitId] || null
            };

            // Application du bonus de vitalité aux HP
            newUnitEntity = enrichEntityStats(newUnitEntity);
            registerEntityAcquisition(newUnitEntity, acquisition);

            selectedEntitiesA.push(newUnitEntity);
            console.log(`Utilisé ${newUnitEntity.type.toUpperCase()} pour Côté A : ${newUnitEntity.name}, Nickname : ${newUnitEntity.nickname}, Level : ${newUnitEntity.level}, Power : ${newUnitEntity.power}, ID : ${newUnitEntity.id}`);
        } else {
            throw new TypeError(`Aucune unité trouvée avec l'ID ${unitId}.`);
        }
    });

    return selectedEntitiesA;
}
