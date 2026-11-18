import { loadEquippedItems } from './GameStorage.js';
import { entitesNest } from './entite/entitesNest.js';
import { getUniqueId } from './entites.js';
import { isLord, isNonLordCombatant } from "./entite/entityRules.js";


export function generateArmyA(armyConfig, entitesNest) {
    if (!Array.isArray(armyConfig?.unitIds)) {
        throw new TypeError('armyConfig.unitIds doit être défini avant de générer l’armée A.');
    }
    const providedLordId = armyConfig.lordId;
    const providedLordNickname = armyConfig.lordNickname || null;
    const providedUnitIds = armyConfig.unitIds;
    const providedUnitNicknames = armyConfig.unitNicknames || {};

    const equippedItems = loadEquippedItems();

    console.log("🎯 Génération de l'armée A depuis armyConfig : ", armyConfig);
    console.log("📦 Items équipés retrouvés :", equippedItems);

    let selectedEntitiesA = [];

    function injectStuff(entiteBase, originalId) {
        const newId = getUniqueId();
        const entityStuffFromItems = equippedItems
            .filter(item => String(item?.equippedTo) === String(originalId))
            .reduce((stuff, item) => {
                const slotKey = String(item?.slot || '').split('-')[0];
                if (slotKey && item?.equippedId) stuff[slotKey] = [item.equippedId];
                return stuff;
            }, {});

        console.log(`🛠️ Injection du stuff pour entité ID ${originalId} → Nouveau ID ${newId}`);
        console.log(`   → Stuff détecté :`, entityStuffFromItems);

        return {
            ...entiteBase,
            id: newId,
            side: 'A',
            stuff: entityStuffFromItems,
            nickname: providedUnitNicknames[originalId] || null
        };
    }

    // LORD
    if (providedLordId != null) {
        const providedLord = entitesNest.find(entite => entite.id === providedLordId);
        if (providedLord) {
            if (!isLord(providedLord)) throw new TypeError(`${providedLord.name} n'est pas un lord.`);
            const newLordEntity = injectStuff(providedLord, providedLordId);
            newLordEntity.nickname = providedLordNickname;

            selectedEntitiesA.push(newLordEntity);
            console.log(`👑 LORD ajouté : ${newLordEntity.name} (Nickname : ${newLordEntity.nickname})`);
            console.log(`   ➤ ID unique : ${newLordEntity.id}`);
            console.log(`   ➤ Stuff :`, newLordEntity.stuff);
        } else {
            console.warn(`⚠️ Lord introuvable avec ID ${providedLordId} dans entitesNest`);
        }
    } else {
        console.log("ℹ️ Aucun Lord fourni pour l'armée A.");
    }

    // UNITÉ(S) NON-LORDS
    providedUnitIds.forEach(unitId => {
        const providedUnit = entitesNest.find(entite => entite.id === unitId);
        if (providedUnit) {
            if (!isNonLordCombatant(providedUnit)) {
                throw new TypeError(`${providedUnit.name} n'est pas un sbire.`);
            }
            const newUnitEntity = injectStuff(providedUnit, unitId);
            selectedEntitiesA.push(newUnitEntity);

            console.log(`Unité ${newUnitEntity.type} ajoutée : ${newUnitEntity.name} (Nickname : ${newUnitEntity.nickname})`);
            console.log(`   ➤ ID unique : ${newUnitEntity.id}`);
            console.log(`   ➤ Stuff :`, newUnitEntity.stuff);
        } else {
            throw new TypeError(`Aucune unité trouvée avec l'ID ${unitId} dans entitesNest.`);
        }
    });

    console.log("✅ Armée A finalisée :", selectedEntitiesA);
    return selectedEntitiesA;
}

